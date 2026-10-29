import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    localValidationProblemResponse,
    NO_STORE_CACHE_CONTROL,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ jobId: string }> };

/** The backend parses :jobId with ParseUUIDPipe; anything else never reaches it. */
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recovery answers staff by code (who holds the claim, until when, whether the payload is gone).
 * errorResponse sanitizes an upstream body down to a message and would drop these, so for these
 * known codes alone the BFF forwards exactly the allowlisted fields and nothing else.
 */
const FORWARDED_ERROR_CODES = new Set([
    "MANUAL_RECOVERY_CLAIMED",
    "JOB_NOT_RECOVERABLE",
    "RECOVERY_PAYLOAD_EXPIRED",
    "RESOURCE_NOT_FOUND",
]);
const FORWARDED_ERROR_FIELDS = ["code", "expiresAt", "claimExpiresAt", "status"] as const;

function forwardRecoveryError(error: unknown): NextResponse | null {
    const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
    const status = response?.status;
    const data = response?.data;
    if (typeof status !== "number" || status < 400 || status > 499) return null;
    if (typeof data !== "object" || data === null) return null;
    const code = (data as Record<string, unknown>).code;
    if (typeof code !== "string" || !FORWARDED_ERROR_CODES.has(code)) return null;

    const body: Record<string, unknown> = {};
    for (const field of FORWARDED_ERROR_FIELDS) {
        const value = (data as Record<string, unknown>)[field];
        if (typeof value === "string") body[field] = value;
    }
    return NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
}

// POST /api/eformsign-docs/jobs/[jobId]/resolve - mark a failed document job resolved by hand (idempotent)
export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
        return localValidationProblemResponse([
            {
                pointer: "/jobId",
                code: "INVALID_FORMAT",
                detail: "작업 식별자가 올바르지 않아요.",
                location: "path",
            },
        ]);
    }

    try {
        const response = await serverAPIClient.post(`/eformsign-docs/jobs/${jobId}/resolve`, undefined, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return forwardRecoveryError(error) ?? errorResponse(error, "resolve eformsign document job", "mutation");
    }
}
