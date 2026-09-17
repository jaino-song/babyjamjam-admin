import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    createProblemDetails,
    parseProblemDetails,
    PROBLEM_CATALOG,
    type ProblemCode,
    type ProblemDetails,
    type ProblemError,
    type ProblemOutcome,
} from "@babyjamjam/shared";
import {
    NO_STORE_CACHE_CONTROL,
    type ParsedBody,
    type ProxyBodyOptions,
    backendJsonResponse,
    buildSystemTemplatePath,
    createRouteUtils,
    getAuthHeaders,
    getAuthToken,
    getUpstreamErrorStatus,
    invalidJsonResponse,
    logUpstreamError,
    parseBody,
    readJsonObjectBody,
    sanitizeUpstreamClientError,
    systemTemplateBackendJsonResponse,
    systemTemplateUpstreamErrorResponse,
    unauthorizedResponse,
    upstreamJsonErrorResponse,
    upstreamSseErrorResponse,
    upstreamStreamErrorResponse,
    upstreamStreamTransportErrorResponse,
    withNoStore,
    invalidSystemTemplateKeyResponse,
} from "@babyjamjam/shared/api";

const {
    errorResponse,
    proxyDeleteRequest,
    proxyGetRequest,
    proxyLocalGetRequest,
    proxyPostRequest,
} = createRouteUtils({
    errorResponseMode: "legacy-message",
    secureCookies: process.env.NODE_ENV === "production",
    serverAPIClient,
});

export {
    NO_STORE_CACHE_CONTROL,
    type ParsedBody,
    type ProxyBodyOptions,
    backendJsonResponse,
    buildSystemTemplatePath,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    getUpstreamErrorStatus,
    invalidJsonResponse,
    logUpstreamError,
    parseBody,
    proxyDeleteRequest,
    proxyGetRequest,
    proxyLocalGetRequest,
    proxyPostRequest,
    readJsonObjectBody,
    sanitizeUpstreamClientError,
    systemTemplateBackendJsonResponse,
    systemTemplateUpstreamErrorResponse,
    unauthorizedResponse,
    upstreamJsonErrorResponse,
    upstreamSseErrorResponse,
    upstreamStreamErrorResponse,
    upstreamStreamTransportErrorResponse,
    withNoStore,
    invalidSystemTemplateKeyResponse,
};

// ---------------------------------------------------------------------------
// BFF-authored problem bodies (frontend-local).
//
// The shared package owns the catalog and the upstream sanitization contract;
// these helpers only author *local* BFF responses so route handlers stop
// emitting raw English `{ error }` bodies. Every body carries a registered
// catalog code plus the legacy `error` alias that `errorResponse` uses when it
// propagates an upstream problem, so both shapes stay symmetric.
// ---------------------------------------------------------------------------

const SAFE_LOCAL_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function createLocalRequestId(): string {
    try {
        const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
        if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
            const requestId = cryptoObject.randomUUID();
            if (SAFE_LOCAL_REQUEST_ID_PATTERN.test(requestId)) {
                return requestId;
            }
        }
    } catch {
        // Runtime crypto can be unavailable in older Next.js test environments.
    }

    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function localProblemJsonResponse(
    problem: ProblemDetails,
    legacyExtras?: Record<string, unknown>,
): NextResponse {
    const response = NextResponse.json(
        { ...problem, error: problem.detail, ...legacyExtras },
        { status: problem.status },
    );
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    response.headers.set("Content-Type", "application/problem+json");
    response.headers.set("Content-Language", "ko-KR");
    response.headers.set("X-Request-Id", problem.requestId);
    return response;
}

/** Author a BFF-local problem body for a registered catalog code. */
export function localProblemResponse(
    code: ProblemCode,
    options: { status?: number; outcome?: ProblemOutcome } = {},
): NextResponse {
    const problem = createProblemDetails({
        code,
        requestId: createLocalRequestId(),
        outcome: options.outcome ?? "NOT_APPLIED",
        ...(options.status === undefined ? {} : { status: options.status }),
    });
    return localProblemJsonResponse(problem);
}

/** Local authentication gate: a registered 401 problem body. */
export function authRequiredResponse(): NextResponse {
    return localProblemResponse("AUTH_REQUIRED");
}

/** Local body-validation problem with explicit RFC 6901 field errors. */
export function localValidationProblemResponse(errors: readonly ProblemError[]): NextResponse {
    const problem = createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId: createLocalRequestId(),
        outcome: "NOT_APPLIED",
        errors: [...errors],
    });
    const issues = problem.errors?.map(({ pointer, detail }) => `${pointer || "body"}: ${detail}`) ?? [];
    return localProblemJsonResponse(problem, { issues });
}

/**
 * Registered catalog code for an upstream failure status whose body is
 * deliberately not propagated (dropped, transport failure, or SSE transport).
 * Only single-status catalog codes are mapped so the problem body always
 * validates against the contract; unmapped statuses fall back to the
 * sanitized legacy-shape response with the status preserved.
 */
const UPSTREAM_STATUS_PROBLEM_CODES: Readonly<Record<number, ProblemCode>> = Object.freeze({
    400: "REQUEST_INVALID",
    401: "AUTH_REQUIRED",
    403: "ACCESS_DENIED",
    404: "RESOURCE_NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "REQUEST_CONFLICT",
    410: "REQUEST_EXPIRED",
    413: "PAYLOAD_TOO_LARGE",
    415: "MEDIA_TYPE_UNSUPPORTED",
    422: "VALIDATION_FAILED",
    429: "REQUEST_RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "UPSTREAM_INVALID_RESPONSE",
    503: "DEPENDENCY_UNAVAILABLE",
    504: "UPSTREAM_TIMEOUT",
});

async function readUpstreamJsonBody(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => "");
    return parseUpstreamJsonObject(text);
}

/** Parse an upstream body string as JSON; anything non-JSON becomes undefined. */
export function parseUpstreamJsonObject(text: string): unknown {
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        // Non-JSON upstream bodies (HTML/text) are never reflected to clients.
        return undefined;
    }
}

/**
 * EM-STATE-01: an upstream 5xx cannot prove that a mutation was not applied —
 * the effect may exist upstream even though the response failed, so the only
 * honest default is UNKNOWN (which carries CHECK_STATUS recovery in the
 * problem contract). Reads may keep claiming NOT_APPLIED because they apply
 * no state, and an explicit upstream 4xx rejection is a known
 * non-application for both operations.
 */
function defaultOutcomeForUpstreamStatus(
    status: number,
    operation: "read" | "mutation",
): ProblemOutcome {
    if (status >= 500 && operation === "mutation") {
        return "UNKNOWN";
    }
    return "NOT_APPLIED";
}

/**
 * Convert a non-ok upstream status into the shared contract:
 * - a faithful upstream problem+json body (when one is supplied and it
 *   validates against the catalog) is propagated with its own registered
 *   code, status, outcome, and requestId;
 * - otherwise the status maps to a BFF-authored catalog problem whose outcome
 *   comes from the explicit caller value or, when omitted, from
 *   {@link defaultOutcomeForUpstreamStatus};
 * - unmapped statuses fall back to the sanitized legacy-shape response with
 *   the status preserved.
 */
export function upstreamStatusProblemResponse(
    status: number,
    context: string,
    outcome: ProblemOutcome | undefined,
    operation: "read" | "mutation" = "mutation",
    upstreamProblem?: unknown,
): NextResponse {
    const code = UPSTREAM_STATUS_PROBLEM_CODES[status];
    if (!code) {
        return errorResponse(
            {
                response: {
                    status,
                    ...(upstreamProblem === undefined ? {} : { data: upstreamProblem }),
                },
            },
            context,
            operation,
        );
    }

    const faithfulProblem = upstreamProblem === undefined
        ? null
        : parseProblemDetails(upstreamProblem, status);
    if (faithfulProblem) {
        return localProblemJsonResponse(faithfulProblem);
    }

    const catalogStatus = PROBLEM_CATALOG[code].status;
    return localProblemResponse(code, {
        outcome: outcome ?? defaultOutcomeForUpstreamStatus(status, operation),
        ...(status === catalogStatus ? {} : { status }),
    });
}

/**
 * Convert a non-ok upstream `fetch` Response into the shared contract:
 * a problem+json upstream body is propagated faithfully, anything else is
 * sanitized to the Korean catalog copy with the upstream status preserved.
 */
export async function upstreamFetchErrorResponse(
    response: Response,
    context: string,
    operation: "read" | "mutation" = "read",
): Promise<NextResponse> {
    const status = getUpstreamErrorStatus({ response: { status: response.status } });
    const data = await readUpstreamJsonBody(response);
    return errorResponse({ response: { status, data } }, context, operation);
}

export function upstreamSseProblemErrorResponse(status: number): Response {
    const code = UPSTREAM_STATUS_PROBLEM_CODES[status]
        ?? (status >= 500 ? "UPSTREAM_INVALID_RESPONSE" : "REQUEST_INVALID");
    const entry = PROBLEM_CATALOG[code];
    // SSE transports cannot carry problem+json; the event payload keeps the
    // established `{type:"error", error}` shape and adds the registered code.
    return new Response(
        `event: error\ndata: ${JSON.stringify({
            type: "error",
            code,
            title: entry.title["ko-KR"],
            error: entry.detail["ko-KR"],
        })}\n\n`,
        {
            status,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        },
    );
}
