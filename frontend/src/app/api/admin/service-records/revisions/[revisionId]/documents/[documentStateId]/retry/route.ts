import { NextRequest } from "next/server";

import type { ProblemError } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    localValidationProblemResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { jsonResponse } from "@/app/api/admin/service-records/_lib/proxy";

type RouteParams = { params: Promise<{ revisionId: string; documentStateId: string }> };

function isExactRetryBody(body: Record<string, unknown>): body is { expectedGeneration: string } {
    const keys = Object.keys(body);
    return keys.length === 1
        && keys[0] === "expectedGeneration"
        && typeof body.expectedGeneration === "string"
        && body.expectedGeneration.trim().length > 0
        && body.expectedGeneration.length <= 128;
}

function expectedGenerationProblem(body: Record<string, unknown>): ProblemError {
    const value = body.expectedGeneration;
    if (typeof value !== "string" || value.trim().length === 0) {
        return { pointer: "/expectedGeneration", code: "REQUIRED", detail: "Invalid input", location: "body" };
    }
    if (value.length > 128) {
        return { pointer: "/expectedGeneration", code: "OUT_OF_RANGE", detail: "Invalid input", location: "body" };
    }
    return { pointer: "/expectedGeneration", code: "INVALID_FORMAT", detail: "Invalid input", location: "body" };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { revisionId, documentStateId } = await params;

    try {
        const body = await readJsonObjectBody(request);
        if (!isExactRetryBody(body)) {
            return localValidationProblemResponse([expectedGenerationProblem(body)]);
        }

        const response = await serverAPIClient.post(
            `/admin/service-records/revisions/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(documentStateId)}/retry`,
            { expectedGeneration: body.expectedGeneration },
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        return errorResponse(error, "retry service-record document");
    }
}
