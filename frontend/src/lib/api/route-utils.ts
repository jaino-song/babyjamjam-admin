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
    const message = axiosError.response?.data?.error 
        || axiosError.response?.data?.message 
        || axiosError.message 
        || `Failed to ${context}`;
    const status = axiosError.response?.status || 500;
    
    console.error(`[${context}] Error:`, message);
    return NextResponse.json({ error: message }, { status });
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
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
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
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
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
