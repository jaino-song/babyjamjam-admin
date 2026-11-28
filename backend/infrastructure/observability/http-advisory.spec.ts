import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import * as Sentry from "@sentry/nestjs";
import type { ErrorEvent, EventHint } from "@sentry/nestjs";
import type { Request } from "express";
import { createProblemDetails, PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";

import { captureHttpAdvisory, isHttpAdvisory, resetHttpAdvisoryThrottle, sanitizeHttpAdvisory } from "./http-advisory";
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

beforeEach(() => {
    jest.clearAllMocks();
    resetHttpAdvisoryThrottle();
});

describe("HTTP 400 advisories", () => {
    it("groups different customers by method, registered route, status and public code", () => {
        captureHttpAdvisory(request(118), REQUEST_ID, 400, problem);
        const first = emittedEvent();
        captureHttpAdvisory(request(999), REQUEST_ID, 400, problem);
        expect(emittedEvent().fingerprint).toEqual(first.fingerprint);
        expect(first.fingerprint).toEqual(["http-advisory", "PATCH", "/clients/:id", "400", "VALIDATION_FAILED"]);
        expect(first.level).toBe("warning");
        expect(first.contexts?.["requestReference"]).toEqual({ requestId: REQUEST_ID });
    });

    it("survives the beforeSend 4xx filter and drops all scope-enriched private data", () => {
        captureHttpAdvisory(request(118), REQUEST_ID, 400, problem);
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
        captureHttpAdvisory(req, REQUEST_ID, 400);
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
        expect(output.tags).not.toHaveProperty("status_code");
        expect(output.message).toMatch(/^HTTP invalid:/);
        expect(output.fingerprint).toEqual(["http-advisory", "UNKNOWN", "<unmatched>", "invalid", "REQUEST_INVALID"]);
    });

    it("continues to exclude ordinary non-advisory 4xx while retaining 5xx errors", () => {
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "400" } })).toBeNull();
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "403" } })).toBeNull();
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "500" } })).not.toBeNull();
    });
});

describe("HTTP advisory status validation", () => {
    it("uses the status fallback when the diagnostic code is outside the Prisma allowlist", () => {
        captureHttpAdvisory(request(118), REQUEST_ID, 409, undefined, "ACCESS_DENIED");
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "409", "error.code": "REQUEST_CONFLICT" });
    });

    it.each([401, 500, 399, NaN, 409.5])("does not capture ineligible status %s", (status) => {
        expect(captureHttpAdvisory(request(118), REQUEST_ID, status)).toBeUndefined();
        expect(Sentry.captureEvent).not.toHaveBeenCalled();
    });

    it.each(["401", "500", "399", " 409", "409.0", "4e2", 409, undefined])(
        "does not recognize a tagged event with status %s",
        (status) => {
            const event = { tags: { feature: "http-advisory", status_code: status } };
            expect(isHttpAdvisory(event)).toBe(false);
            expect(sanitizeHttpAdvisory(event).tags).not.toHaveProperty("status_code");
        },
    );

    it("keeps advisory 409 events while dropping ordinary 409 events and advisory-tagged 401 events", () => {
        const advisory: ErrorEvent = { type: undefined, tags: { feature: "http-advisory", status_code: "409" } };
        expect(filterAndSanitizeSentryEvent(advisory)).toMatchObject({
            level: "warning",
            tags: { feature: "http-advisory", status_code: "409" },
        });
        expect(filterAndSanitizeSentryEvent({ type: undefined, tags: { status_code: "409" } })).toBeNull();
        expect(filterAndSanitizeSentryEvent({
            type: undefined,
            tags: { feature: "http-advisory", status_code: "401" },
        })).toBeNull();
    });

    it("strips private scope data from a 409 advisory", () => {
        const privateData = "PRIVATE_SENTINEL";
        const output = sanitizeHttpAdvisory({
            tags: { feature: "http-advisory", status_code: "409", "error.code": "REQUEST_CONFLICT" },
            user: { id: privateData, email: privateData },
            request: { url: privateData, data: privateData, headers: { Authorization: privateData } },
            extra: { value: privateData },
            breadcrumbs: [{ message: privateData }],
            exception: { values: [{ value: privateData }] },
            contexts: { arbitrary: { value: privateData } },
        });
        expect(output.message).toBe(`HTTP 409: REQUEST_CONFLICT — ${PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"]}`);
        expect(JSON.stringify(output)).not.toContain(privateData);
    });
});

describe("HTTP filter advisory integration", () => {
    const fixture = (req = request(118)) => {
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
            switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }),
            getArgByIndex: () => response,
        } as unknown as ArgumentsHost;
        return { response, adapter, filter, host };
    };

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

    it("captures a registered conflict with its route template and actual status", () => {
        const { filter, host } = fixture();
        filter.catch(new ConflictException({ code: "CLIENT_PHONE_ALREADY_REGISTERED" }), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({
            status_code: "409",
            "error.code": "CLIENT_PHONE_ALREADY_REGISTERED",
            route: "/clients/:id",
        });
        expect(emittedEvent().message).toMatch(/^HTTP 409:/);
    });

    it("captures a registered permission rejection", () => {
        const { filter, host } = fixture();
        filter.catch(new ForbiddenException({ code: "ACCESS_DENIED" }), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "403", "error.code": "ACCESS_DENIED" });
    });

    it("captures a permission rejection without a registered code", () => {
        const { filter, host } = fixture();
        filter.catch(new ForbiddenException(), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "403", "error.code": "ACCESS_DENIED" });
    });

    it("captures a matched 404", () => {
        const { filter, host } = fixture();
        filter.catch(new NotFoundException(), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "404", "error.code": "RESOURCE_NOT_FOUND" });
    });

    it("captures a legacy 409 with its fallback code and sets the response request id", () => {
        const { filter, host, response } = fixture();
        const privateText = "some private text 01012345678";
        filter.catch(new ConflictException(privateText), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "409", "error.code": "REQUEST_CONFLICT" });
        expect(JSON.stringify(emittedEvent())).not.toContain(privateText);
        expect(JSON.stringify(emittedEvent())).not.toContain("01012345678");
        expect(response.setHeader).toHaveBeenCalledWith("X-Request-Id", REQUEST_ID);
    });

    it.each([
        [402, "REQUEST_INVALID"],
        [405, "METHOD_NOT_ALLOWED"],
        [410, "REQUEST_EXPIRED"],
        [413, "PAYLOAD_TOO_LARGE"],
        [415, "MEDIA_TYPE_UNSUPPORTED"],
        [422, "VALIDATION_FAILED"],
        [429, "REQUEST_RATE_LIMITED"],
        [499, "REQUEST_INVALID"],
    ])("captures a legacy %i with fallback code %s", (status, code) => {
        const { filter, host } = fixture();
        filter.catch(new HttpException("legacy rejection", status), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: String(status), "error.code": code });
    });

    it("does not create an advisory for a 401", () => {
        const { filter, host } = fixture();
        filter.catch(new UnauthorizedException(), host);
        expect(Sentry.captureEvent).not.toHaveBeenCalled();
    });

    it("drops an unmatched 404 and captures an unmatched 400", () => {
        const req = request(118);
        req.route = undefined;
        const { filter, host } = fixture(req);
        filter.catch(new NotFoundException(), host);
        expect(Sentry.captureEvent).not.toHaveBeenCalled();
        filter.catch(new BadRequestException(), host);
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1);
        expect(emittedEvent().tags).toMatchObject({ status_code: "400", route: "<unmatched>" });
    });

    it("captures a server failure as an error", () => {
        const { filter, host } = fixture();
        filter.catch(new InternalServerErrorException(), host);
        expect(Sentry.captureEvent).not.toHaveBeenCalled();
        expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });
});

describe("HTTP advisory throttle", () => {
    const windowMs = 5 * 60_000;
    let warn: jest.SpyInstance;

    beforeEach(() => {
        jest.useFakeTimers();
        warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        jest.useRealTimers();
    });

    function fillWindow(): void {
        for (let call = 0; call < 30; call += 1) {
            expect(captureHttpAdvisory(request(118), REQUEST_ID, 400, problem)).toBe("event-id");
        }
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(30);
        expect(warn).not.toHaveBeenCalled();
    }

    it("sends 30 events and warns only on the first suppression for the key", () => {
        fillWindow();
        for (let call = 31; call <= 35; call += 1) {
            expect(captureHttpAdvisory(request(999), REQUEST_ID, 400, problem)).toBeUndefined();
        }
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(30);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith({
            method: "PATCH", route: "/clients/:id", status: "400", code: "VALIDATION_FAILED",
        });
    });

    it("counts a different status separately even when the method, route and code match", () => {
        fillWindow();
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 400, problem)).toBeUndefined();
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 422, problem)).toBe("event-id");
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(31);
        expect(emittedEvent().fingerprint).toEqual(["http-advisory", "PATCH", "/clients/:id", "422", "VALIDATION_FAILED"]);
    });

    it("resets the allowance after the fixed window elapses", () => {
        fillWindow();
        jest.advanceTimersByTime(windowMs - 1);
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 400, problem)).toBeUndefined();
        jest.advanceTimersByTime(1);
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 400, problem)).toBe("event-id");
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(31);
    });

    it("bounds the map to 1,000 live keys and admits new keys after expiry", () => {
        for (let index = 0; index < 1_000; index += 1) {
            const req = request(118);
            req.route = { path: `/probe-${index}/:id` };
            expect(captureHttpAdvisory(req, REQUEST_ID, 409)).toBe("event-id");
        }
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1_000);
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 409)).toBeUndefined();
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1_000);
        jest.advanceTimersByTime(windowMs);
        expect(captureHttpAdvisory(request(118), REQUEST_ID, 409)).toBe("event-id");
        expect(Sentry.captureEvent).toHaveBeenCalledTimes(1_001);
    });
});
