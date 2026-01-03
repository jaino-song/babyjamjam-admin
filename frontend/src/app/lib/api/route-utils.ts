import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
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
 * Proxy GET request to backend with access token
 */
export async function proxyGetRequest(
    request: NextRequest,
    backendPath: string,
    context: string
): Promise<NextResponse> {
    const accessToken = getAccessToken(request);
    
    if (!accessToken) {
        return unauthorizedResponse();
    }

    try {
        const response = await serverAPIClient.get(backendPath, {
            params: { accessToken },
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, context);
    }
}

/**
 * Proxy POST request to backend with access token
 */
export async function proxyPostRequest(
    request: NextRequest,
    backendPath: string,
    context: string,
    additionalBody?: Record<string, unknown>
): Promise<NextResponse> {
    const accessToken = getAccessToken(request);
    
    if (!accessToken) {
        return unauthorizedResponse();
    }

    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post(backendPath, {
            ...body,
            ...additionalBody,
            accessToken,
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, context);
    }
}

