import { BadRequestException, ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import * as Sentry from "@sentry/nestjs";
import type { ErrorEvent, EventHint } from "@sentry/nestjs";
import type { Request } from "express";
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

import { captureHttpAdvisory, sanitizeHttpAdvisory } from "./http-advisory";
import { filterAndSanitizeSentryEvent } from "./service-record-sentry";
import { ServiceRecordSentryExceptionFilter } from "./service-record-sentry-exception.filter";

jest.mock("@sentry/nestjs", () => ({
    captureEvent: jest.fn(() => "event-id"),
    withScope: jest.fn(),
}));

const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";
const problem = createProblemDetails({ code: "VALIDATION_FAILED", requestId: REQUEST_ID });
const request = (id: number): Request => ({
    method: "PATCH",
    route: { path: "/clients/:id" },
    originalUrl: `/clients/${id}?token=secret-query`,
    params: { id: String(id) },
    body: { name: "PRIVATE_CUSTOMER", phone: "01012345678" },
    headers: { authorization: "Bearer PRIVATE_TOKEN" },
}) as unknown as Request;

function emittedEvent(): ErrorEvent {
    return jest.mocked(Sentry.captureEvent).mock.calls.at(-1)![0] as ErrorEvent;
}

describe("HTTP 400 advisories", () => {
    beforeEach(() => jest.clearAllMocks());

    it("groups different customers by method, registered route and public code", () => {
        captureHttpAdvisory(request(118), REQUEST_ID, problem);
        const first = emittedEvent();
        captureHttpAdvisory(request(999), REQUEST_ID, problem);
        expect(emittedEvent().fingerprint).toEqual(first.fingerprint);
        expect(first.fingerprint).toEqual(["http-advisory", "PATCH", "/clients/:id", "VALIDATION_FAILED"]);
        expect(first.level).toBe("warning");
        expect(first.contexts?.["requestReference"]).toEqual({ requestId: REQUEST_ID });
    });

    it("survives the beforeSend 4xx filter and drops all scope-enriched private data", () => {
        captureHttpAdvisory(request(118), REQUEST_ID, problem);
        const event = emittedEvent();
        const privateData = "PRIVATE_SENTINEL";
        const enriched: ErrorEvent = {
            ...event,
            release: "release-sha",
            environment: "production",
            user: { id: privateData, email: privateData },
            message: privateData,
            request: { url: privateData, data: privateData, headers: { Authorization: privateData } },
            extra: { value: privateData },
            contexts: { ...event.contexts, arbitrary: { value: privateData } },
            breadcrumbs: [{ message: privateData }],
            exception: { values: [{ value: privateData }] },
            transaction: privateData,
            fingerprint: [privateData],
            tags: { ...event.tags, arbitrary: privateData },
        };
        const hint: EventHint = {
            originalException: new BadRequestException(privateData),
            attachments: [{ filename: "private.txt", data: privateData }],
        };
        const output = filterAndSanitizeSentryEvent(enriched, hint);
        expect(output).not.toBeNull();
        expect(output?.level).toBe("warning");
        expect(output?.release).toBe("release-sha");
        expect(JSON.stringify(output)).not.toContain(privateData);
        expect(output?.contexts?.["problem"]?.["reason"]).toBe(problem.detail);
        expect(hint.attachments).toEqual([]);
    });

    it("never falls back to a raw URL for unmatched routes or forwards an unregistered reason", () => {
        const req = request(118);
        req.route = undefined;
        captureHttpAdvisory(req, REQUEST_ID);
        expect(emittedEvent().tags?.["route"]).toBe("<unmatched>");
        expect(emittedEvent().tags?.["error.code"]).toBe("REQUEST_INVALID");
        const output = sanitizeHttpAdvisory({
            tags: { "error.code": "PRIVATE_CODE", route: "/PRIVATE CUSTOMER", "http.method": "PRIVATE" },
            contexts: {
                requestReference: { requestId: "PRIVATE_ID" },
                problem: { fieldCodes: ["INVALID_FORMAT", "PRIVATE_FIELD"], outcome: "PRIVATE_OUTCOME" },
            },
        });
        expect(JSON.stringify(output)).not.toContain("PRIVATE");
        expect(output.contexts?.["problem"]?.["fieldCodes"]).toEqual(["INVALID_FORMAT"]);
    });

    it("continues to exclude ordinary non-advisory 4xx while retaining 5xx errors", () => {
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "400" } })).toBeNull();
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "403" } })).toBeNull();
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "500" } })).not.toBeNull();
    });
});

describe("HTTP filter advisory integration", () => {
    const fixture = () => {
        const response = {
            locals: { errorRequestId: REQUEST_ID },
            setHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const adapter = { isHeadersSent: () => false, reply: jest.fn() };
        const filter = new ServiceRecordSentryExceptionFilter({ httpAdapter: adapter } as unknown as HttpAdapterHost);
        const host = {
            getType: () => "http",
            switchToHttp: () => ({ getRequest: () => request(118), getResponse: () => response }),
            getArgByIndex: () => response,
        } as unknown as ArgumentsHost;
        return { response, adapter, filter, host };
    };

    beforeEach(() => jest.clearAllMocks());

    it("captures a structured 400 once and keeps its public response and request reference", () => {
        const { filter, host, response } = fixture();
        filter.catch(new BadRequestException(problem), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "VALIDATION_FAILED", requestId: REQUEST_ID }));
        expect(response.setHeader).toHaveBeenCalledWith("X-Request-Id", REQUEST_ID);
    });

    it("maps the assignment-disabled code to the same safe public and Sentry reason", () => {
        const { filter, host, response } = fixture();
        filter.catch(new BadRequestException({ code: "EMPLOYEE_ASSIGNMENT_UNAVAILABLE", outcome: "NOT_APPLIED" }), host);
        expect(response.status).toHaveBeenCalledWith(400);
        const body = response.json.mock.calls[0]![0];
        expect(body.code).toBe("EMPLOYEE_ASSIGNMENT_UNAVAILABLE");
        expect(body.detail).toContain("다음 서비스 배정이 비활성화");
        expect(emittedEvent().contexts?.["problem"]?.["reason"]).toBe(body.detail);
    });

    it("preserves legacy 400 responses even when capture throws", () => {
        const { filter, host, adapter, response } = fixture();
        jest.mocked(Sentry.captureEvent).mockImplementationOnce(() => { throw new Error("offline"); });
        filter.catch(new BadRequestException("legacy rejection"), host);
        expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ message: "legacy rejection" }), 400);
    });

    it("does not create advisories for permission errors or server failures", () => {
        const { filter, host } = fixture();
        filter.catch(new ForbiddenException(), host);
        filter.catch(new InternalServerErrorException(), host);
        expect(Sentry.captureEvent).not.toHaveBeenCalled();
        expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });
});
