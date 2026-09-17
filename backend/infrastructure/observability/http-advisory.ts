import * as Sentry from "@sentry/nestjs";
import type { Event } from "@sentry/nestjs";
import type { Request } from "express";
import {
    PROBLEM_CATALOG,
    type ProblemCode,
    type ProblemDetails,
} from "@babyjamjam/shared/errors/problem-details";

export const HTTP_ADVISORY_FEATURE = "http-advisory";
const METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const FIELD_CODES = new Set(["REQUIRED", "INVALID_FORMAT", "OUT_OF_RANGE", "INVALID_VALUE", "UNEXPECTED_FIELD"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRISMA_REASONS = {
    P2003: "연결할 항목을 확인해 주세요.",
    P2011: "필수 입력 항목을 확인해 주세요.",
    P2006: "입력값의 형식을 확인해 주세요.",
} as const;
type AdvisoryCode = ProblemCode | keyof typeof PRISMA_REASONS;

function catalogCode(value: unknown): AdvisoryCode {
    if (typeof value === "string" && Object.prototype.hasOwnProperty.call(PRISMA_REASONS, value)) {
        return value as keyof typeof PRISMA_REASONS;
    }
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROBLEM_CATALOG, value)
        ? value as ProblemCode
        : "REQUEST_INVALID";
}

function reasonFor(code: AdvisoryCode): string {
    return Object.prototype.hasOwnProperty.call(PRISMA_REASONS, code)
        ? PRISMA_REASONS[code as keyof typeof PRISMA_REASONS]
        : PROBLEM_CATALOG[code as ProblemCode].detail["ko-KR"];
}

function routeTemplate(value: unknown): string {
    // Only the framework's registered template is accepted, never the URL or params.
    return typeof value === "string" && value.length <= 200 && /^\/[a-zA-Z0-9_/:.*{}?()-]*$/.test(value)
        ? value : "<unmatched>";
}

export function isHttpAdvisory(event: Event): boolean {
    return event.tags?.["feature"] === HTTP_ADVISORY_FEATURE
        && event.tags?.["status_code"] === "400";
}

/** Rebuild from an allowlist after SDK scope enrichment; no request/exception data survives. */
export function sanitizeHttpAdvisory(event: Event): Event {
    const code = catalogCode(event.tags?.["error.code"]);
    const route = routeTemplate(event.tags?.["route"]);
    const sourceMethod = event.tags?.["http.method"];
    const method = typeof sourceMethod === "string" && METHODS.has(sourceMethod) ? sourceMethod : "UNKNOWN";
    const reference = event.contexts?.["requestReference"]?.["requestId"];
    const fieldCodes = event.contexts?.["problem"]?.["fieldCodes"];
    const outcome = event.contexts?.["problem"]?.["outcome"];

    return {
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: "javascript",
        release: event.release,
        environment: event.environment,
        level: "warning",
        message: `HTTP 400: ${code} — ${reasonFor(code)}`,
        fingerprint: [HTTP_ADVISORY_FEATURE, method, route, code],
        tags: {
            app: "backend",
            runtime: "node",
            feature: HTTP_ADVISORY_FEATURE,
            operation: "http",
            handled: "true",
            status_code: "400",
            "error.code": code,
            "http.method": method,
            route,
        },
        contexts: {
            problem: {
                code,
                reason: reasonFor(code),
                ...(typeof outcome === "string" && ["NOT_APPLIED", "FAILED", "PARTIALLY_APPLIED", "UNKNOWN"].includes(outcome)
                    ? { outcome } : {}),
                fieldCodes: Array.isArray(fieldCodes)
                    ? [...new Set(fieldCodes.filter((value): value is string => typeof value === "string" && FIELD_CODES.has(value)))]
                    : [],
            },
            ...(typeof reference === "string" && UUID_PATTERN.test(reference)
                ? { requestReference: { requestId: reference } } : {}),
        },
    };
}

export function captureHttpAdvisory(
    request: Request,
    requestId: string,
    problem?: ProblemDetails | null,
    diagnosticCode?: string,
): string | undefined {
    const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
    return Sentry.captureEvent(sanitizeHttpAdvisory({
        tags: {
            feature: HTTP_ADVISORY_FEATURE,
            status_code: "400",
            "error.code": problem?.code ?? catalogCode(diagnosticCode),
            "http.method": request.method,
            route: routeTemplate(route),
        },
        contexts: {
            requestReference: { requestId },
            problem: {
                outcome: problem?.outcome,
                fieldCodes: problem?.errors?.map((error) => error.code),
            },
        },
    }));
}
