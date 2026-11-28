import { HttpStatus, Logger } from "@nestjs/common";
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
const FALLBACK_CODES: Readonly<Partial<Record<number, ProblemCode>>> = {
    400: "REQUEST_INVALID",
    403: "ACCESS_DENIED",
    404: "RESOURCE_NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "REQUEST_CONFLICT",
    410: "REQUEST_EXPIRED",
    413: "PAYLOAD_TOO_LARGE",
    415: "MEDIA_TYPE_UNSUPPORTED",
    422: "VALIDATION_FAILED",
    429: "REQUEST_RATE_LIMITED",
};
const ADVISORY_WINDOW_MS = 5 * 60_000;
const MAX_ADVISORIES_PER_WINDOW = 30;
const MAX_ADVISORY_KEYS = 1_000;
const logger = new Logger("HttpAdvisory");
const advisoryWindows = new Map<string, { expiresAt: number; count: number }>();

type AdvisoryCode = ProblemCode | keyof typeof PRISMA_REASONS;
type AdvisoryFingerprint = [
    feature: typeof HTTP_ADVISORY_FEATURE,
    method: string,
    route: string,
    status: string,
    code: AdvisoryCode,
];

function isPrismaAdvisoryCode(value: unknown): value is keyof typeof PRISMA_REASONS {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRISMA_REASONS, value);
}

function catalogCode(value: unknown): AdvisoryCode {
    if (isPrismaAdvisoryCode(value)) return value;
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROBLEM_CATALOG, value)
        ? value as ProblemCode
        : "REQUEST_INVALID";
}

function reasonFor(code: AdvisoryCode): string {
    return isPrismaAdvisoryCode(code)
        ? PRISMA_REASONS[code]
        : PROBLEM_CATALOG[code].detail["ko-KR"];
}

function routeTemplate(value: unknown): string {
    // Only the framework's registered template is accepted, never the URL or params.
    return typeof value === "string" && value.length <= 200 && /^\/[a-zA-Z0-9_/:.*{}?()-]*$/.test(value)
        ? value : "<unmatched>";
}

export function isEligibleHttpAdvisoryStatus(status: number): boolean {
    return Number.isInteger(status) && status >= 400 && status <= 499 && status !== HttpStatus.UNAUTHORIZED;
}

function advisoryStatusTag(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const status = Number(value);
    return isEligibleHttpAdvisoryStatus(status) && String(status) === value ? value : undefined;
}

export function isHttpAdvisory(event: Event): boolean {
    return event.tags?.["feature"] === HTTP_ADVISORY_FEATURE
        && advisoryStatusTag(event.tags?.["status_code"]) !== undefined;
}

/** Rebuild from an allowlist after SDK scope enrichment; no request/exception data survives. */
export function sanitizeHttpAdvisory(event: Event): Event & { fingerprint: AdvisoryFingerprint } {
    const code = catalogCode(event.tags?.["error.code"]);
    const route = routeTemplate(event.tags?.["route"]);
    const statusTag = advisoryStatusTag(event.tags?.["status_code"]);
    const status = statusTag ?? "invalid";
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
        message: `HTTP ${status}: ${code} — ${reasonFor(code)}`,
        fingerprint: [HTTP_ADVISORY_FEATURE, method, route, status, code],
        tags: {
            app: "backend",
            runtime: "node",
            feature: HTTP_ADVISORY_FEATURE,
            operation: "http",
            handled: "true",
            ...(statusTag === undefined ? {} : { status_code: statusTag }),
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

export function resetHttpAdvisoryThrottle(): void {
    advisoryWindows.clear();
}

function admitAdvisory([, method, route, status, code]: AdvisoryFingerprint): boolean {
    const key = JSON.stringify([method, route, status, code]);
    const now = Date.now();
    const window = advisoryWindows.get(key);
    if (window && now < window.expiresAt) {
        if (window.count < MAX_ADVISORIES_PER_WINDOW) {
            window.count += 1;
            return true;
        }
        if (window.count === MAX_ADVISORIES_PER_WINDOW) {
            // Count the first suppression to record that this window has already logged.
            window.count += 1;
            logger.warn({ method, route, status, code });
        }
        return false;
    }

    if (!window && advisoryWindows.size >= MAX_ADVISORY_KEYS) {
        for (const [storedKey, storedWindow] of advisoryWindows) {
            if (now >= storedWindow.expiresAt) advisoryWindows.delete(storedKey);
        }
        if (advisoryWindows.size >= MAX_ADVISORY_KEYS) return false;
    }

    advisoryWindows.set(key, { expiresAt: now + ADVISORY_WINDOW_MS, count: 1 });
    return true;
}

export function captureHttpAdvisory(
    request: Request,
    requestId: string,
    statusCode: number,
    problem?: ProblemDetails | null,
    diagnosticCode?: string,
): string | undefined {
    if (!isEligibleHttpAdvisoryStatus(statusCode)) return undefined;

    const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
    const fallbackCode = isPrismaAdvisoryCode(diagnosticCode)
        ? diagnosticCode : FALLBACK_CODES[statusCode] ?? "REQUEST_INVALID";
    const event = sanitizeHttpAdvisory({
        tags: {
            feature: HTTP_ADVISORY_FEATURE,
            status_code: String(statusCode),
            "error.code": problem?.code ?? fallbackCode,
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
    });
    if (!admitAdvisory(event.fingerprint)) return undefined;
    return Sentry.captureEvent(event);
}
