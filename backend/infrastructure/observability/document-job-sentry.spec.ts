import { BadRequestException } from "@nestjs/common";
import type { ErrorEvent } from "@sentry/nestjs";

const mockScope = {
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn((error: unknown) => {
    void error;
    return "event-id";
});

jest.mock("@sentry/nestjs", () => ({
    withScope: (callback: (scope: typeof mockScope) => unknown) => callback(mockScope),
    captureException: (error: unknown) => mockCaptureException(error),
}));

import {
    captureDocumentJobFailure,
    filterAndSanitizeSentryEvent,
    type DocumentJobFailureContext,
} from "./service-record-sentry";

let sequence = 0;
function failure(overrides: Partial<DocumentJobFailureContext> = {}): DocumentJobFailureContext {
    return {
        jobId: `00000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`,
        jobType: "create_document",
        status: "requires_attention",
        errorCode: "PROVIDER_STATE_UNAVAILABLE",
        attempts: 1,
        completedAt: new Date("2026-11-18T00:00:00Z"),
        ...overrides,
    };
}

function capturedEvent(): ErrorEvent {
    const error = mockCaptureException.mock.calls[0]?.[0] as Error;
    return {
        type: undefined,
        tags: Object.fromEntries(mockScope.setTag.mock.calls),
        fingerprint: mockScope.setFingerprint.mock.calls[0]?.[0],
        contexts: Object.fromEntries(mockScope.setContext.mock.calls),
        message: error.message,
        logentry: { message: error.message, params: ["private"] },
        exception: { values: [{
            type: error.name,
            value: error.message,
            stacktrace: { frames: [{
                filename: "/app/backend/dist/infrastructure/observability/service-record-sentry.js",
                function: "captureDocumentJobFailure",
                lineno: 600,
                in_app: true,
            }] },
        }] },
    };
}

describe("document-job Sentry reporting", () => {
    beforeEach(() => jest.clearAllMocks());

    it("keeps document-job taxonomy and context despite the service-record capture stack", () => {
        const context = failure();
        expect(captureDocumentJobFailure(context)).toBe("event-id");
        expect(mockScope.setLevel).toHaveBeenCalledWith("error");
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException.mock.calls[0]?.[0]).toMatchObject({ name: "DocumentJobFailure" });
        const result = filterAndSanitizeSentryEvent(capturedEvent());
        expect(result).toMatchObject({
            tags: {
                feature: "document-jobs", app: "backend", runtime: "node", handled: "true",
                operation: "create_document", "job.status": "requires_attention",
                "job.error_code": "PROVIDER_STATE_UNAVAILABLE",
            },
            fingerprint: ["document-jobs", "create_document", "requires_attention", "PROVIDER_STATE_UNAVAILABLE"],
            contexts: { job: {
                jobId: context.jobId, jobType: "create_document", status: "requires_attention",
                errorCode: "PROVIDER_STATE_UNAVAILABLE", attempts: 1,
            } },
            message: "Document job requires_attention: create_document PROVIDER_STATE_UNAVAILABLE",
            logentry: { message: "Document job requires_attention: create_document PROVIDER_STATE_UNAVAILABLE" },
            exception: { values: [{ value: "Document job requires_attention: create_document PROVIDER_STATE_UNAVAILABLE" }] },
        });
        expect(result?.logentry?.params).toBeUndefined();
        expect(filterAndSanitizeSentryEvent(capturedEvent(), {
            originalException: new BadRequestException(),
        })).not.toBeNull();
    });

    it.each([null, "홍길동 010-1234-5678", "A".repeat(65), "lowercase"])(
        "normalizes malformed error code %s before capture and sanitization", (errorCode) => {
            captureDocumentJobFailure(failure({ errorCode }));
            const event = capturedEvent();
            expect(event.tags?.["job.error_code"]).toBe("UNKNOWN");
            expect(event.fingerprint).toEqual(["document-jobs", "create_document", "requires_attention", "UNKNOWN"]);
            expect(event.message).toBe("Document job requires_attention: create_document UNKNOWN");
            const result = filterAndSanitizeSentryEvent(event);
            expect(result?.message).toBe(event.message);
            expect(result?.contexts?.["job"]?.["errorCode"]).toBe("UNKNOWN");
            expect(JSON.stringify(result)).not.toContain("홍길동");
        },
    );

    it("normalizes malformed job types before tags, message and fingerprint", () => {
        captureDocumentJobFailure(failure({ jobType: "홍길동 010-1234-5678" }));
        const event = capturedEvent();
        expect(event.tags?.["operation"]).toBe("unknown");
        expect(event.fingerprint).toEqual(["document-jobs", "unknown", "requires_attention", "PROVIDER_STATE_UNAVAILABLE"]);
        expect(event.message).toBe("Document job requires_attention: unknown PROVIDER_STATE_UNAVAILABLE");
        expect(event.contexts?.["job"]?.["jobType"]).toBe("unknown");
    });

    it("revalidates tag values when generating the sanitized message", () => {
        const result = filterAndSanitizeSentryEvent({
            type: undefined,
            tags: { feature: "document-jobs", "job.status": "private", operation: "bad value!", "job.error_code": "홍길동 010-1234-5678" },
            message: "private",
        });
        expect(result?.message).toBe("Document job unknown: unknown UNKNOWN");
    });

    it("dedupes one completed transition, but reports a failure after requeue even with the same attempts", () => {
        const context = failure();
        captureDocumentJobFailure(context);
        expect(captureDocumentJobFailure({ ...context, attempts: 2 })).toBeUndefined();
        captureDocumentJobFailure({ ...context, attempts: 1, completedAt: new Date("2026-11-18T00:01:00Z") });
        expect(mockCaptureException).toHaveBeenCalledTimes(2);
    });

    it("dedupes absent completion times and keeps distinct terminal statuses and codes", () => {
        const context = failure({ completedAt: null });
        captureDocumentJobFailure(context);
        captureDocumentJobFailure({ ...context, completedAt: undefined });
        captureDocumentJobFailure({ ...context, status: "failed" });
        captureDocumentJobFailure({ ...context, errorCode: "ADOPTION_FAILED" });
        expect(mockCaptureException).toHaveBeenCalledTimes(3);
    });

    it("evicts the oldest transition after 1,000 keys", () => {
        const oldest = failure();
        captureDocumentJobFailure(oldest);
        for (let index = 0; index < 999; index++) captureDocumentJobFailure(failure());
        expect(captureDocumentJobFailure(oldest)).toBeUndefined();
        captureDocumentJobFailure(failure());
        expect(captureDocumentJobFailure(oldest)).toBe("event-id");
        expect(mockCaptureException).toHaveBeenCalledTimes(1002);
    });

    it.each([
        ["document-job-tick", "Backend failure (document-job-tick)"],
        ["bad value!", "Backend failure"],
    ])("includes only a valid backend operation %s in every message field", (operation, message) => {
        expect(filterAndSanitizeSentryEvent({
            type: undefined, tags: { feature: "backend", operation },
            message: "private", logentry: { message: "private" },
            exception: { values: [{ value: "private" }] },
        })).toMatchObject({
            message, logentry: { message }, exception: { values: [{ value: message }] },
        });
    });
});
