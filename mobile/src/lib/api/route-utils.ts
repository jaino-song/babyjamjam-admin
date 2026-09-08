import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    getSafeApiDisplayMessage,
    sanitizeApiDisplayMessage,
} from "@/lib/errors/safe-api-error-message";
import {
    NO_STORE_CACHE_CONTROL,
    type ParsedBody,
    type ProxyBodyOptions,
    backendJsonResponse,
    createRouteUtils,
    getAuthHeaders,
    getAuthToken,
    getUpstreamErrorStatus,
    invalidJsonResponse,
    logUpstreamError,
    parseBody,
    readJsonObjectBody,
    sanitizeUpstreamClientError,
    unauthorizedResponse,
    upstreamJsonErrorResponse,
    upstreamSseErrorResponse,
    upstreamStreamErrorResponse,
    upstreamStreamTransportErrorResponse,
    withNoStore,
} from "@babyjamjam/shared/api";

const {
    errorResponse: sanitizedErrorResponse,
    proxyDeleteRequest,
    proxyGetRequest,
    proxyLocalGetRequest,
    proxyPostRequest,
} = createRouteUtils({
    secureCookies: getServerRuntimeConfig().isProductionNodeEnv,
    serverAPIClient,
});

const CONTROLLED_DISPLAY_STATUSES = new Set([400, 409, 422]);

function getUpstreamPayload(error: unknown): Record<string, unknown> | null {
    if (!error || typeof error !== "object") {
        return null;
    }

    const data = (error as { response?: { data?: unknown } }).response?.data;
    return data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
}

function getSafePrismaMetadata(payload: Record<string, unknown> | null): {
    code?: string;
    field?: string;
} {
    const code = typeof payload?.code === "string" && /^P\d{4}$/.test(payload.code)
        ? payload.code
        : undefined;
    const field = code && typeof payload?.field === "string" && /^[A-Za-z][\w.-]{0,63}$/.test(payload.field)
        ? payload.field
        : undefined;

    return { code, field };
}

function errorResponse(error: unknown, context: string): NextResponse {
    const status = getUpstreamErrorStatus(error);
    if (!CONTROLLED_DISPLAY_STATUSES.has(status)) {
        return sanitizedErrorResponse(error, context);
    }

    const metadata = getSafePrismaMetadata(getUpstreamPayload(error));
    const message = getSafeApiDisplayMessage(error);
    if (!message) {
        if (metadata.code) {
            return NextResponse.json(
                {
                    error: `Failed to ${context}`,
                    code: metadata.code,
                    ...(metadata.field ? { field: metadata.field } : {}),
                },
                { status },
            );
        }
        return sanitizedErrorResponse(error, context);
    }

    return NextResponse.json(
        {
            error: sanitizeApiDisplayMessage(message),
            ...(metadata.code ? { code: metadata.code } : {}),
            ...(metadata.field ? { field: metadata.field } : {}),
        },
        { status },
    );
}

export {
    NO_STORE_CACHE_CONTROL,
    type ParsedBody,
    type ProxyBodyOptions,
    backendJsonResponse,
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
    unauthorizedResponse,
    upstreamJsonErrorResponse,
    upstreamSseErrorResponse,
    upstreamStreamErrorResponse,
    upstreamStreamTransportErrorResponse,
    withNoStore,
};
