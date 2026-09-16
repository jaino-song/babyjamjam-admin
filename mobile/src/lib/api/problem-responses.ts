import { NextResponse } from "next/server";

import {
    createProblemDetails,
    parseProblemDetails,
    type ProblemCode,
    type ProblemDetails,
    type ProblemError,
} from "@babyjamjam/shared";
import { errorResponse, NO_STORE_CACHE_CONTROL, sanitizeUpstreamClientError } from "@babyjamjam/shared/api";

/**
 * Local problem responses for mobile BFF routes.
 *
 * Mirrors the shared `localValidationResponse` output contract (which stays
 * private to packages/shared): a registered-code RFC 9457 problem with the
 * legacy English `error` alias attached for clients that still read `error`.
 * Every code here must already exist in the shared catalog — this module
 * never registers or renames codes (BJJ-319 wave rule).
 *
 * Outcome semantics follow the backend guard convention:
 * - `NOT_APPLIED` + `recovery NONE/NEVER` when the local rejection is known
 *   to have prevented the operation (missing token, bad parameter, tombstone).
 * - `UNKNOWN` (createProblemDetails stamps `CHECK_STATUS`/`NEVER`) when a
 *   mutation may have reached the backend but its result is unconfirmable.
 */

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

function problemJsonResponse(problem: ProblemDetails, legacyError: string): NextResponse {
    const response = NextResponse.json(
        { ...problem, error: legacyError },
        { status: problem.status },
    );
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    response.headers.set("Content-Type", "application/problem+json");
    response.headers.set("Content-Language", "ko-KR");
    response.headers.set("X-Request-Id", problem.requestId);
    return response;
}

function localProblemResponse(
    code: ProblemCode,
    legacyError: string,
    options: { applied: "read" | "mutation"; errors?: ProblemError[] } = { applied: "read" },
): NextResponse {
    const problem = createProblemDetails({
        code,
        requestId: createLocalRequestId(),
        outcome: options.applied === "mutation" ? "UNKNOWN" : "NOT_APPLIED",
        recovery: options.applied === "mutation" ? undefined : { action: "NONE", retry: { mode: "NEVER" } },
        ...(options.errors ? { errors: options.errors } : {}),
    });
    return problemJsonResponse(problem, legacyError);
}

/** Missing/absent auth token: a registered AUTH_REQUIRED problem (401). */
export function unauthorizedProblemResponse(): NextResponse {
    return localProblemResponse("AUTH_REQUIRED", "Unauthorized");
}

/**
 * Local parameter/body rejection: a registered VALIDATION_FAILED problem
 * (400). `detail` values are re-stamped from the catalog locale copy by the
 * shared sanitizer, so callers only identify the failing field.
 */
export function validationProblemResponse(
    legacyError: string,
    errors: ProblemError[],
): NextResponse {
    return localProblemResponse("VALIDATION_FAILED", legacyError, { applied: "read", errors });
}

/**
 * Upstream transport failure while forwarding a request: a registered
 * UPSTREAM_INVALID_RESPONSE problem (502). A mutation whose result cannot be
 * confirmed is UNKNOWN; reads are NOT_APPLIED.
 */
export function upstreamUnavailableProblemResponse(applied: "read" | "mutation"): NextResponse {
    return localProblemResponse("UPSTREAM_INVALID_RESPONSE", "Upstream unavailable", { applied });
}

/** Backend unreachable before an exchange: a registered DEPENDENCY_UNAVAILABLE problem (503). */
export function dependencyUnavailableProblemResponse(applied: "read" | "mutation"): NextResponse {
    return localProblemResponse("DEPENDENCY_UNAVAILABLE", "Authentication service unavailable", { applied });
}

/** Retired endpoint: a registered REQUEST_EXPIRED problem (410). */
export function requestExpiredProblemResponse(legacyError: string): NextResponse {
    return localProblemResponse("REQUEST_EXPIRED", legacyError);
}

function sseHeaders(): HeadersInit {
    return {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    };
}

function sseErrorPayload(status: number, payload: object): Response {
    // The stream consumer classifies events by the payload `type` member, so
    // the legacy "error" discriminator wins over the problem type URI; `code`
    // stays the machine-readable problem identity.
    return new Response(
        `event: error\ndata: ${JSON.stringify({ ...payload, type: "error" })}\n\n`,
        { status, headers: sseHeaders() },
    );
}

/**
 * SSE-formatted transport failure for streaming proxies: the backend request
 * itself failed, so nothing was received. Upgrades the legacy error event to a
 * registered UPSTREAM_INVALID_RESPONSE problem (502) inside the legacy
 * `event: error` envelope.
 */
export function upstreamSseTransportErrorResponse(applied: "read" | "mutation"): Response {
    const problem = createProblemDetails({
        code: "UPSTREAM_INVALID_RESPONSE",
        requestId: createLocalRequestId(),
        outcome: applied === "mutation" ? "UNKNOWN" : "NOT_APPLIED",
        recovery: applied === "mutation" ? undefined : { action: "NONE", retry: { mode: "NEVER" } },
    });
    return sseErrorPayload(problem.status, { ...problem, error: problem.detail });
}

/**
 * SSE-formatted upstream rejection for streaming proxies. Forwards a verbatim
 * upstream problem body (with the legacy `error` alias the JSON boundary also
 * attaches); otherwise falls back to the same sanitized Korean message the
 * JSON BFF boundaries emit (`sanitizeUpstreamClientError`), with the upstream
 * HTTP status preserved and no invented code. `applied` follows the stream's
 * operation: a mutation whose result cannot be confirmed carries the
 * UNKNOWN/CHECK_STATUS semantics instead of the read failure copy.
 */
export function upstreamSseUpstreamErrorResponse(
    status: number,
    upstreamBodyText?: string,
    applied: "read" | "mutation" = "mutation",
): Response {
    const data = upstreamBodyText ? safeJsonParse(upstreamBodyText) : undefined;
    const upstreamProblem = parseProblemDetails(data, status);
    if (upstreamProblem) {
        return sseErrorPayload(status, { ...upstreamProblem, error: upstreamProblem.detail });
    }

    const sanitized = sanitizeUpstreamClientError(data, "Streaming unavailable", status, applied);
    return sseErrorPayload(status, sanitized);
}

/**
 * Non-ok upstream fetch response, converted through the shared `errorResponse`
 * boundary: forwards a verbatim upstream problem body (with problem headers),
 * otherwise emits the sanitized Korean fallback message. The upstream HTTP
 * status is always preserved; no code is invented for non-problem bodies.
 */
export function upstreamBodyErrorResponse(
    status: number,
    upstreamText: string | undefined,
    context: string,
    operation: "read" | "mutation" = "mutation",
): NextResponse {
    let data: unknown;
    if (upstreamText) {
        try {
            data = JSON.parse(upstreamText);
        } catch {
            data = upstreamText;
        }
    }

    return errorResponse({ response: { status, data } }, context, operation);
}

function safeJsonParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
