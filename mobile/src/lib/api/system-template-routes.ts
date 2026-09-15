import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
    buildSystemTemplatePath,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    invalidSystemTemplateKeyResponse,
    parseBody,
    readJsonObjectBody,
    systemTemplateBackendJsonResponse,
    systemTemplateUpstreamErrorResponse,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

async function requireAuthToken(request: NextRequest): Promise<string | NextResponse> {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }
    return token;
}

function resolveSystemTemplatePath(key: string, suffix = ""): string | NextResponse {
    const path = buildSystemTemplatePath(key, suffix);
    return path ?? invalidSystemTemplateKeyResponse();
}

export async function proxySystemTemplateGet(
    request: NextRequest,
    key: string,
    suffix: string,
    context: string,
): Promise<NextResponse> {
    const token = await requireAuthToken(request);
    if (typeof token !== "string") {
        return token;
    }

    const backendPath = resolveSystemTemplatePath(key, suffix);
    if (backendPath instanceof NextResponse) {
        return backendPath;
    }

    try {
        const response = await serverAPIClient.get(backendPath, {
            headers: getAuthHeaders(token),
        });

        return systemTemplateBackendJsonResponse(response, context);
    } catch (error) {
        return systemTemplateUpstreamErrorResponse(error, context);
    }
}

export async function proxySystemTemplatePost(
    request: NextRequest,
    key: string,
    suffix: string,
    context: string,
    bodySchema?: ZodType<unknown>,
): Promise<NextResponse> {
    const token = await requireAuthToken(request);
    if (typeof token !== "string") {
        return token;
    }

    const backendPath = resolveSystemTemplatePath(key, suffix);
    if (backendPath instanceof NextResponse) {
        return backendPath;
    }

    try {
        let body: unknown = {};
        if (bodySchema) {
            const parsed = await parseBody(bodySchema, request);
            if (parsed.response) {
                return parsed.response;
            }
            body = parsed.data;
        } else {
            body = await readJsonObjectBody(request);
        }

        const response = await serverAPIClient.post(backendPath, body, {
            headers: getAuthHeaders(token),
        });

        return systemTemplateBackendJsonResponse(response, context);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return systemTemplateUpstreamErrorResponse(error, context);
    }
}

export async function proxySystemTemplatePut(
    request: NextRequest,
    key: string,
    context: string,
    bodySchema: ZodType<unknown>,
): Promise<NextResponse> {
    const token = await requireAuthToken(request);
    if (typeof token !== "string") {
        return token;
    }

    const backendPath = resolveSystemTemplatePath(key);
    if (backendPath instanceof NextResponse) {
        return backendPath;
    }

    try {
        const parsed = await parseBody(bodySchema, request);
        if (parsed.response) {
            return parsed.response;
        }

        const response = await serverAPIClient.put(backendPath, parsed.data, {
            headers: getAuthHeaders(token),
        });

        return systemTemplateBackendJsonResponse(response, context);
    } catch (error) {
        return systemTemplateUpstreamErrorResponse(error, context);
    }
}
