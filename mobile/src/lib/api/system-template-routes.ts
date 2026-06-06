import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

function buildSystemTemplatePath(key: string, suffix = ""): string {
    return `/system-templates/${encodeURIComponent(key)}${suffix}`;
}

async function requireAuthToken(request: NextRequest): Promise<string | NextResponse> {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }
    return token;
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

    try {
        const response = await serverAPIClient.get(buildSystemTemplatePath(key, suffix), {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, context);
    }
}

export async function proxySystemTemplatePost(
    request: NextRequest,
    key: string,
    suffix: string,
    context: string,
): Promise<NextResponse> {
    const token = await requireAuthToken(request);
    if (typeof token !== "string") {
        return token;
    }

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post(buildSystemTemplatePath(key, suffix), body, {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, context);
    }
}
