import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    buildSystemTemplatePath,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    invalidSystemTemplateKeyResponse,
    parseBody,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

async function requireAuthToken(request: NextRequest): Promise<string | NextResponse> {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
    }
    return token;
}

/**
 * The shared systemTemplateBackendJsonResponse authors a raw
 * `{error, code: "UPSTREAM_ERROR"}` body for every non-2xx; the mobile
 * system-template proxies answer with the problem contract instead: a
 * problem+json upstream body is propagated faithfully, anything else is
 * sanitized to the Korean catalog copy with the status preserved.
 */
function systemTemplateProxyBackendJsonResponse(
    response: { status?: number },
    context: string,
    operation: "read" | "mutation",
): NextResponse {
    if ((response.status ?? 200) >= 400) {
        return errorResponse({ response }, context, operation);
    }
    return backendJsonResponse(response);
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

        return systemTemplateProxyBackendJsonResponse(response, context, "read");
    } catch (error) {
        return errorResponse(error, context, "read");
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

        return systemTemplateProxyBackendJsonResponse(response, context, "mutation");
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, context, "mutation");
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

        return systemTemplateProxyBackendJsonResponse(response, context, "mutation");
    } catch (error) {
        return errorResponse(error, context, "mutation");
    }
}
