import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
    createProblemDetails,
    normalizeApiError,
    parseProblemDetails,
    type ProblemDetails,
    type ProblemError,
    type ProblemErrorCode,
} from "../errors/problem-details";

import { sanitizeApiDisplayMessage } from "../errors/safe-api-error-message";
import { getUserErrorMessage } from "../errors/user-error-message";

export const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

class InvalidJsonBodyError extends Error {
    constructor() {
        super("Request body must be valid JSON");
        this.name = "InvalidJsonBodyError";
    }
}

interface UpstreamErrorPayload {
    error?: string;
    // Nest sends a string for `HttpException`s and a string[] for ValidationPipe failures.
    message?: string | string[];
}

interface UpstreamResponseLike {
    data?: unknown;
    status?: number;
}

interface UpstreamErrorLike {
    code?: unknown;
    response?: UpstreamResponseLike;
}

interface ServerApiClientLike {
    delete(
        url: string,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
    get(
        url: string,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
    post(
        url: string,
        data?: unknown,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
}

export interface RouteUtilsConfig {
    errorResponseMode?: "legacy-message" | "sanitized-fallback";
    secureCookies: boolean;
    serverAPIClient: ServerApiClientLike;
}

export type ParsedBody<T> =
    | { data: T; response: null }
    | { data: null; response: NextResponse };

export interface ProxyBodyOptions {
    additionalBody?: Record<string, unknown>;
    bodySchema?: z.ZodType<unknown>;
}

const RFC6901_POINTER_MAX_LENGTH = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
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

function toJsonPointer(path: readonly unknown[]): string {
    if (!Array.isArray(path)) {
        return "";
    }

    let pointer = "";
    for (const segment of path) {
        if (typeof segment !== "string" && typeof segment !== "number") {
            return "";
        }
        if (typeof segment === "number" && !Number.isInteger(segment)) {
            return "";
        }

        const rawToken = String(segment);
        if (CONTROL_CHARACTER_PATTERN.test(rawToken)) {
            return "";
        }
        const token = rawToken.replaceAll("~", "~0").replaceAll("/", "~1");
        pointer += `/${token}`;
        if (pointer.length > RFC6901_POINTER_MAX_LENGTH) {
            return "";
        }
    }

    return pointer;
}

function readBodyPath(
    body: Record<string, unknown>,
    path: readonly unknown[],
): { present: boolean; value?: unknown } {
    let current: unknown = body;
    for (const segment of path) {
        if ((typeof current !== "object" && typeof current !== "function") || current === null) {
            return { present: false };
        }
        if (typeof segment !== "string" && typeof segment !== "number") {
            return { present: false };
        }
        const key = String(segment);
        if (!Object.prototype.hasOwnProperty.call(current, key)) {
            return { present: false };
        }
        try {
            current = (current as Record<string, unknown>)[key];
        } catch {
            return { present: false };
        }
    }
    return { present: true, value: current };
}

function zodIssueCode(
    issue: { code?: unknown; origin?: unknown; minimum?: unknown },
    input: { present: boolean; value?: unknown },
): ProblemErrorCode {
    switch (issue.code) {
        case "unrecognized_keys":
            return "UNEXPECTED_FIELD";
        case "too_small":
            if (issue.origin === "string" && issue.minimum === 1 && input.value === "") {
                return "REQUIRED";
            }
            return "OUT_OF_RANGE";
        case "too_big":
        case "not_multiple_of":
            return "OUT_OF_RANGE";
        case "invalid_format":
        case "invalid_string":
            return "INVALID_FORMAT";
        case "invalid_type":
            return !input.present || input.value === undefined
                ? "REQUIRED"
                : "INVALID_FORMAT";
        case "invalid_value":
        case "invalid_union":
        case "invalid_key":
        case "invalid_element":
        case "custom":
        default:
            return "INVALID_VALUE";
    }
}

function toProblemErrors(
    issues: readonly { path?: unknown; code?: unknown; origin?: unknown; minimum?: unknown }[],
    body: Record<string, unknown>,
): ProblemError[] {
    return issues.map((issue) => {
        const path = Array.isArray(issue.path) ? issue.path : [];
        return {
            pointer: toJsonPointer(path),
            code: zodIssueCode(issue, readBodyPath(body, path)),
            detail: "Invalid input",
            location: "body",
        };
    });
}

function localValidationResponse(
    legacyError: "Request body must be valid JSON" | "Invalid request body",
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

export async function readJsonObjectBody(request: NextRequest): Promise<Record<string, unknown>> {
    const text = await request.text();

    if (!text.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        throw new InvalidJsonBodyError();
    }

    throw new InvalidJsonBodyError();
}

export function invalidJsonResponse(error: unknown): NextResponse | null {
    if (error instanceof InvalidJsonBodyError) {
        return localValidationResponse(
            "Request body must be valid JSON",
            [{ pointer: "", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" }],
        );
    }

    return null;
}

export async function parseBody<T>(
    schema: z.ZodType<T>,
    request: NextRequest,
): Promise<ParsedBody<T>> {
    let body: Record<string, unknown>;
    try {
        body = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        return {
            data: null,
            response:
                invalidJson ??
                localValidationResponse(
                    "Request body must be valid JSON",
                    [{ pointer: "", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" }],
                ),
        };
    }

    const validation = validateBodyWithSchema(schema, body);
    if (validation.response) {
        return { data: null, response: validation.response };
    }

    return { data: validation.data as T, response: null };
}

function validateBodyWithSchema<T>(
    schema: z.ZodType<T>,
    body: Record<string, unknown>,
): { data: T; response: null } | { data: null; response: NextResponse } {
    const result = schema.safeParse(body);
    if (!result.success) {
        return {
            data: null,
            response: localValidationResponse("Invalid request body", toProblemErrors(result.error.issues, body)),
        };
    }

    return { data: result.data, response: null };
}

export function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function getProxyGetParams(
    request: NextRequest,
    backendPathHasQuery: boolean,
): Record<string, string> {
    const params: Record<string, string> = {};

    // When the route handler pre-encoded its own query string into backendPath,
    // forwarding the incoming request's params again would duplicate keys —
    // the upstream then parses them as arrays and rejects them (e.g.
    // "limit must be an integer").
    if (backendPathHasQuery) {
        return params;
    }

    const { searchParams } = new URL(request.url);
    for (const [key, value] of searchParams.entries()) {
        if (isEformsignCredentialParam(key)) {
            continue;
        }
        params[key] = value;
    }

    return params;
}

function getLocalProxyGetParams(
    request: NextRequest,
    backendPathHasQuery: boolean,
): Record<string, string> {
    if (backendPathHasQuery) {
        return {};
    }

    const params: Record<string, string> = {};
    const { searchParams } = new URL(request.url);
    for (const [key, value] of searchParams.entries()) {
        if (!isEformsignCredentialParam(key)) {
            params[key] = value;
        }
    }
    return params;
}

function isEformsignCredentialParam(key: string): boolean {
    return new Set([
        "accesstoken",
        "apikey",
        "authorization",
        "externaltoken",
        "memberemail",
        "oauthtoken",
        "refreshtoken",
    ]).has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function stripProviderCredentialFields(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(body).filter(([key]) => !isEformsignCredentialParam(key)),
    );
}

export function backendJsonResponse(response: UpstreamResponseLike): NextResponse {
    const status = response.status ?? 200;

    if (status === 204) {
        return new NextResponse(null, { status });
    }

    return NextResponse.json(response.data ?? {}, { status });
}

export function withNoStore(response: NextResponse): NextResponse {
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    return response;
}

export function getUpstreamErrorStatus(error: unknown, fallbackStatus = 500): number {
    if (error && typeof error === "object" && "response" in error) {
        const status = (error as UpstreamErrorLike | null)?.response?.status;
        if (typeof status === "number" && status >= 400 && status <= 599) {
            return status;
        }
    }

    return fallbackStatus;
}

function getUpstreamErrorData(error: unknown): unknown {
    if (error && typeof error === "object" && "response" in error) {
        return (error as UpstreamErrorLike | null)?.response?.data;
    }

    return undefined;
}

function safeErrorCode(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    return /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value) ? value : undefined;
}

export function sanitizeUpstreamClientError(
    upstreamData: unknown,
    fallbackMessage: string,
    status?: number,
    operation: "read" | "mutation" = "mutation",
): ({ error: string; code?: string; field?: string; hasKakaoAccount?: boolean } & Partial<Omit<ProblemDetails, "code">>) {
    const problem = parseProblemDetails(upstreamData, status);
    if (problem) return { ...problem, error: problem.detail };
    if (upstreamData && typeof upstreamData === "object" && ("type" in upstreamData || "requestId" in upstreamData)) {
        return { error: normalizeApiError({ response: { status, data: upstreamData } }, { operation }).message };
    }
    const payload: { error: string; code?: string; field?: string; hasKakaoAccount?: boolean } = {
        error: getUserErrorMessage({ response: { status, data: upstreamData } }, fallbackMessage),
    };

    if (upstreamData && typeof upstreamData === "object") {
        const data = upstreamData as { code?: unknown; field?: unknown; hasKakaoAccount?: unknown };
        const code = safeErrorCode(data.code);
        if (code) {
            payload.code = code;
            if (/^P\d{4}$/.test(code) && typeof data.field === "string" && /^[A-Za-z][\w.-]{0,63}$/.test(data.field)) {
                payload.field = data.field;
            }
        }
        if (typeof data.hasKakaoAccount === "boolean") {
            payload.hasKakaoAccount = data.hasKakaoAccount;
        }
    }

    return payload;
}

export function logUpstreamError(
    context: string,
    error: unknown,
    upstreamBody?: string,
): void {
    const maxUpstreamBodyLength = 2_000;
    const sanitizedUpstreamBody = upstreamBody === undefined
        ? undefined
        : sanitizeApiDisplayMessage(upstreamBody);
    const loggedUpstreamBody = sanitizedUpstreamBody !== undefined && sanitizedUpstreamBody.length > maxUpstreamBodyLength
        ? `${sanitizedUpstreamBody.slice(0, maxUpstreamBodyLength)}…(truncated)`
        : sanitizedUpstreamBody;
    const data = getUpstreamErrorData(error);
    const upstreamCode = data && typeof data === "object"
        ? safeErrorCode((data as { code?: unknown }).code)
        : undefined;
    const transportCode = error && typeof error === "object"
        ? safeErrorCode((error as UpstreamErrorLike).code)
        : undefined;
    const errorName = error instanceof Error ? error.name : undefined;

    console.error(`[${context}] Error:`, {
        status: getUpstreamErrorStatus(error),
        code: upstreamCode ?? transportCode,
        name: errorName,
        ...(loggedUpstreamBody === undefined ? {} : { body: loggedUpstreamBody }),
    });
}

export function upstreamJsonErrorResponse(
    status = 502,
    fallbackMessage = "Backend request failed",
): NextResponse {
    return NextResponse.json(
        { error: fallbackMessage, code: "UPSTREAM_ERROR" },
        { status },
    );
}

export function upstreamSseErrorResponse(
    status = 502,
    fallbackMessage = "Streaming unavailable",
): Response {
    return new Response(
        `event: error\ndata: ${JSON.stringify({ type: "error", error: fallbackMessage })}\n\n`,
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

export async function upstreamStreamErrorResponse(
    upstream: Response,
    fallbackMessage = "Upstream stream request failed",
): Promise<Response> {
    const status = upstream.ok ? 502 : upstream.status;
    await upstream.text().catch(() => "");

    return upstreamJsonErrorResponse(status, fallbackMessage);
}

export function upstreamStreamTransportErrorResponse(
    error: unknown,
    fallbackMessage = "Upstream stream request failed",
): Response {
    void error;

    return upstreamJsonErrorResponse(502, fallbackMessage);
}

export function unauthorizedResponse(
    message = "Access token is required. Please authenticate first.",
): NextResponse {
    return NextResponse.json({ error: message }, { status: 401 });
}

export function errorResponse(error: unknown, context: string, operation: "read" | "mutation" = "mutation"): NextResponse {
    const upstreamData = (error as UpstreamErrorLike | null)?.response?.data as UpstreamErrorPayload | undefined;
    const status = (error as UpstreamErrorLike | null)?.response?.status || 500;

    logUpstreamError(context, error);
    const payload = sanitizeUpstreamClientError(upstreamData, `Failed to ${context}`, status, operation);
    return NextResponse.json(payload, {
        status,
        headers: {
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            ...(payload.type && payload.requestId ? {
                "Content-Type": "application/problem+json",
                "Content-Language": "ko-KR",
                "X-Request-Id": payload.requestId,
            } : {}),
        },
    });
}

function createLegacyErrorResponse(error: unknown, context: string, operation: "read" | "mutation" = "mutation"): NextResponse {
    return errorResponse(error, context, operation);
}

export function createRouteUtils({
    errorResponseMode = "sanitized-fallback",
    secureCookies,
    serverAPIClient,
}: RouteUtilsConfig) {
    void secureCookies;
    const boundErrorResponse = errorResponseMode === "legacy-message"
        ? createLegacyErrorResponse
        : errorResponse;

    async function proxyGetRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
    ): Promise<NextResponse> {
        const authToken = getAuthToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        try {
            const response = await serverAPIClient.get(backendPath, {
                params: getProxyGetParams(request, backendPath.includes("?")),
                headers: getAuthHeaders(authToken),
            });

            if ((response.status ?? 200) >= 400) {
                return boundErrorResponse({ response }, context, "read");
            }

            return NextResponse.json(response.data);
        } catch (error) {
            return boundErrorResponse(error, context, "read");
        }
    }

    /**
     * Proxies an application-authenticated read whose source of truth is local.
     * Unlike proxyGetRequest, this never reads or forwards an eformsign credential.
     */
    async function proxyLocalGetRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
    ): Promise<NextResponse> {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        try {
            const response = await serverAPIClient.get(backendPath, {
                params: getLocalProxyGetParams(request, backendPath.includes("?")),
                headers: getAuthHeaders(authToken),
            });

            if ((response.status ?? 200) >= 400) {
                return boundErrorResponse({ response }, context, "read");
            }

            return NextResponse.json(response.data);
        } catch (error) {
            return boundErrorResponse(error, context, "read");
        }
    }

    async function proxyPostRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
        options?: ProxyBodyOptions,
    ): Promise<NextResponse> {
        const { additionalBody, bodySchema } = options ?? {};
        const authToken = getAuthToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        try {
            const body = await readJsonObjectBody(request);

            if (bodySchema) {
                const validation = validateBodyWithSchema(bodySchema, body);
                if (validation.response) {
                    return validation.response;
                }
            }

            const response = await serverAPIClient.post(
                backendPath,
                {
                    ...stripProviderCredentialFields(body),
                    ...additionalBody,
                },
                {
                    headers: getAuthHeaders(authToken),
                },
            );

            if ((response.status ?? 200) >= 400) {
                return boundErrorResponse({ response }, context, "mutation");
            }

            return NextResponse.json(response.data);
        } catch (error) {
            const invalidJson = invalidJsonResponse(error);
            if (invalidJson) {
                return invalidJson;
            }

            return boundErrorResponse(error, context);
        }
    }

    async function proxyDeleteRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
        options?: ProxyBodyOptions,
    ): Promise<NextResponse> {
        const { additionalBody, bodySchema } = options ?? {};
        const authToken = getAuthToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        try {
            const body = await readJsonObjectBody(request);

            if (bodySchema) {
                const validation = validateBodyWithSchema(bodySchema, body);
                if (validation.response) {
                    return validation.response;
                }
            }

            const { searchParams } = new URL(request.url);

            const params: Record<string, string> = {};
            for (const [key, value] of searchParams.entries()) {
                if (!isEformsignCredentialParam(key)) {
                    params[key] = value;
                }
            }

            const response = await serverAPIClient.delete(backendPath, {
                params,
                data: {
                    ...stripProviderCredentialFields(body),
                    ...additionalBody,
                },
                headers: getAuthHeaders(authToken),
            });

            if ((response.status ?? 200) >= 400) {
                return boundErrorResponse({ response }, context, "mutation");
            }

            return NextResponse.json(response.data);
        } catch (error) {
            const invalidJson = invalidJsonResponse(error);
            if (invalidJson) {
                return invalidJson;
            }

            return boundErrorResponse(error, context);
        }
    }

    return {
        errorResponse: boundErrorResponse,
        proxyDeleteRequest,
        proxyGetRequest,
        proxyLocalGetRequest,
        proxyPostRequest,
    };
}
