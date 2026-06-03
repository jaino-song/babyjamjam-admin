import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";

// Cookie names for eformsign tokens
export const COOKIE_NAMES = {
    ACCESS_TOKEN: "eformsign_access_token",
    REFRESH_TOKEN: "eformsign_refresh_token",
} as const;

// Cookie options
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
};

class InvalidJsonBodyError extends Error {
    constructor() {
        super("Request body must be valid JSON");
        this.name = "InvalidJsonBodyError";
    }
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
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return null;
}

/**
 * Get access token from httpOnly cookie
 */
export function getAccessToken(request: NextRequest): string | null {
    return request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value || null;
}

/**
 * Get refresh token from httpOnly cookie
 */
export function getRefreshToken(request: NextRequest): string | null {
    return request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value || null;
}

/**
 * Get JWT auth token from httpOnly cookie (for backend authentication)
 */
export function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

/**
 * Create Authorization header for backend requests
 */
export function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export function backendJsonResponse(response: { data: unknown; status?: number }): NextResponse {
    const status = response.status ?? 200;

    if (status === 204) {
        return new NextResponse(null, { status });
    }

    return NextResponse.json(response.data ?? {}, { status });
}

export function getUpstreamErrorStatus(error: unknown, fallbackStatus = 500): number {
    if (error && typeof error === "object" && "response" in error) {
        const status = (error as { response?: { status?: unknown } }).response?.status;
        if (typeof status === "number" && status >= 400 && status <= 599) {
            return status;
        }
    }

    return fallbackStatus;
}

function getUpstreamErrorData(error: unknown): unknown {
    if (error && typeof error === "object" && "response" in error) {
        return (error as { response?: { data?: unknown } }).response?.data;
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
    fallbackMessage: string
): { error: string; code?: string; hasKakaoAccount?: boolean } {
    const payload: { error: string; code?: string; hasKakaoAccount?: boolean } = {
        error: fallbackMessage,
    };

    if (upstreamData && typeof upstreamData === "object") {
        const data = upstreamData as { code?: unknown; hasKakaoAccount?: unknown };
        const code = safeErrorCode(data.code);
        if (code) {
            payload.code = code;
        }
        if (typeof data.hasKakaoAccount === "boolean") {
            payload.hasKakaoAccount = data.hasKakaoAccount;
        }
    }

    return payload;
}

export function logUpstreamError(context: string, error: unknown): void {
    const data = getUpstreamErrorData(error);
    const upstreamCode = data && typeof data === "object"
        ? safeErrorCode((data as { code?: unknown }).code)
        : undefined;
    const transportCode = error && typeof error === "object"
        ? safeErrorCode((error as { code?: unknown }).code)
        : undefined;
    const errorName = error instanceof Error ? error.name : undefined;

    console.error(`[${context}] Error:`, {
        status: getUpstreamErrorStatus(error),
        code: upstreamCode ?? transportCode,
        name: errorName,
    });
}

export function upstreamJsonErrorResponse(
    status = 502,
    fallbackMessage = "Backend request failed"
): NextResponse {
    return NextResponse.json(
        { error: fallbackMessage, code: "UPSTREAM_ERROR" },
        { status }
    );
}

export function upstreamSseErrorResponse(
    status = 502,
    fallbackMessage = "Streaming unavailable"
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
        }
    );
}

export async function upstreamStreamErrorResponse(
    upstream: Response,
    fallbackMessage = "Upstream stream request failed"
): Promise<Response> {
    const status = upstream.ok ? 502 : upstream.status;
    await upstream.text().catch(() => "");

    return upstreamJsonErrorResponse(status, fallbackMessage);
}

export function upstreamStreamTransportErrorResponse(
    error: unknown,
    fallbackMessage = "Upstream stream request failed"
): Response {
    void error;

    return upstreamJsonErrorResponse(502, fallbackMessage);
}

/**
 * Set auth tokens in httpOnly cookies
 */
export function setAuthCookies(
    response: NextResponse,
    accessToken: string,
    refreshToken: string
): NextResponse {
    response.cookies.set(COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
        ...COOKIE_OPTIONS,
        maxAge: 60 * 60, // 1 hour
    });
    response.cookies.set(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
        ...COOKIE_OPTIONS,
        maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(message = "Access token is required. Please authenticate first.") {
    return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Create error response from caught error
 */
export function errorResponse(error: unknown, context: string) {
    const axiosError = error as AxiosError<{ error?: string; message?: string }>;
    const status = axiosError.response?.status || 500;

    logUpstreamError(context, error);
    return NextResponse.json(
        sanitizeUpstreamClientError(axiosError.response?.data, `Failed to ${context}`),
        { status }
    );
}

/**
 * Proxy GET request to backend with access token and JWT auth
 */
export async function proxyGetRequest(
    request: NextRequest,
    backendPath: string,
    context: string
): Promise<NextResponse> {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    try {
        const response = await serverAPIClient.get(backendPath, {
            params: { accessToken },
            headers: getAuthHeaders(authToken),
        });

        // Check for backend error responses
        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, context);
    }
}

/**
 * Proxy POST request to backend with access token and JWT auth
 */
export async function proxyPostRequest(
    request: NextRequest,
    backendPath: string,
    context: string,
    additionalBody?: Record<string, unknown>
): Promise<NextResponse> {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post(backendPath, {
            ...body,
            ...additionalBody,
            accessToken,
        }, {
            headers: getAuthHeaders(authToken),
        });

        // Check for backend error responses
        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, context);
    }
}

/**
 * Proxy DELETE request to backend with access token and JWT auth
 */
export async function proxyDeleteRequest(
    request: NextRequest,
    backendPath: string,
    context: string,
    additionalBody?: Record<string, unknown>
): Promise<NextResponse> {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    try {
        const body = await readJsonObjectBody(request);
        const { searchParams } = new URL(request.url);

        const params: Record<string, string> = { accessToken };
        for (const [key, value] of searchParams.entries()) {
            if (key !== "accessToken") {
                params[key] = value;
            }
        }

        const response = await serverAPIClient.delete(backendPath, {
            params,
            data: {
                ...body,
                ...additionalBody,
            },
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, context);
    }
}
