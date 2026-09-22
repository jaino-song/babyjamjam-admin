import { NextResponse } from "next/server";

import { NO_STORE_CACHE_CONTROL } from "@babyjamjam/shared/api";
import { createProblemDetails, type ProblemError } from "@babyjamjam/shared";

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function createLocalRequestId(): string {
    try {
        const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
        if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
            const requestId = cryptoObject.randomUUID();
            if (SAFE_REQUEST_ID_PATTERN.test(requestId)) {
                return requestId;
            }
        }
    } catch {
        // Runtime crypto can be unavailable in older Next.js test environments.
    }

    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Local 400 for schedule-change path/body validation. Mirrors the shared
 * `localValidationResponse` output contract (which stays private): a
 * VALIDATION_FAILED problem with the legacy English error and issue list
 * attached for clients that still read `error`.
 */
function localValidationResponse(
    legacyError: string,
    errors: ProblemError[],
): NextResponse {
    const problem = createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId: createLocalRequestId(),
        outcome: "NOT_APPLIED",
        errors,
    });
    const issues = problem.errors?.map(({ pointer, detail }) => `${pointer || "body"}: ${detail}`) ?? [];
    const response = NextResponse.json(
        { ...problem, error: legacyError, issues },
        { status: problem.status },
    );
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    response.headers.set("Content-Type", "application/problem+json");
    response.headers.set("Content-Language", "ko-KR");
    response.headers.set("X-Request-Id", problem.requestId);
    return response;
}

export function isValidScheduleChangeRequestId(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function invalidScheduleChangeRequestIdResponse(): NextResponse {
    return localValidationResponse("Invalid schedule change request id", [
        { pointer: "/id", code: "INVALID_FORMAT", detail: "요청 ID 형식이 올바르지 않아요.", location: "path" },
    ]);
}

export function isPositiveScheduleId(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

export function invalidScheduleIdResponse(): NextResponse {
    return localValidationResponse("Invalid schedule id", [
        { pointer: "/scheduleId", code: "INVALID_FORMAT", detail: "일정 ID 형식이 올바르지 않아요.", location: "path" },
    ]);
}

export function isValidIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function invalidScheduleDateResponse(): NextResponse {
    return localValidationResponse("Invalid schedule date", [
        { pointer: "/toDate", code: "INVALID_FORMAT", detail: "변경할 날짜 형식이 올바르지 않아요.", location: "body" },
    ]);
}
