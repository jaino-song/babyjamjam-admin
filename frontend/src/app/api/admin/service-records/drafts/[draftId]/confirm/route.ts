import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
} from "@/lib/api/route-utils";
import { jsonResponse } from "@/app/api/admin/service-records/_lib/proxy";
import { pickServiceRecordScheduleErrorExtension } from "@/features/service-records/types/admin-edit";

type RouteParams = { params: Promise<{ draftId: string }> };

const BLOCKING_OPERATIONS = new Set(["contract_period", "receipt_refresh", "record_snapshot"]);
const SAFE_BLOCKING_TOKEN = /^[A-Za-z0-9_:.-]{1,80}$/;

interface BlockingOperation {
    operation: string;
    status: string | null;
    lastErrorCode: string | null;
}

function safeToken(value: unknown): string | null {
    return typeof value === "string" && SAFE_BLOCKING_TOKEN.test(value) ? value : null;
}

/**
 * The shared problem sanitizer drops unknown upstream members. The editor needs
 * to tell "a previous edit's follow-up is still running" from a plain version
 * conflict, so a 409's `blockingOperation` is re-attached after validating it
 * down to a known operation and short, safe tokens.
 */
function readBlockingOperation(error: unknown): BlockingOperation | null {
    const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
    if (response?.status !== 409) return null;
    const data = response.data;
    if (typeof data !== "object" || data === null) return null;
    const candidate = (data as { blockingOperation?: unknown }).blockingOperation;
    if (typeof candidate !== "object" || candidate === null) return null;
    const { operation, status, lastErrorCode } = candidate as Record<string, unknown>;
    if (typeof operation !== "string" || !BLOCKING_OPERATIONS.has(operation)) return null;
    return { operation, status: safeToken(status), lastErrorCode: safeToken(lastErrorCode) };
}

async function withBlockingOperation(response: NextResponse, blocking: BlockingOperation): Promise<NextResponse> {
    const body = await response.json().catch(() => ({}));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return NextResponse.json(
        { ...(typeof body === "object" && body !== null ? body : {}), blockingOperation: blocking },
        { status: response.status, headers },
    );
}

/**
 * The shared problem sanitizer drops members it does not know. A schedule
 * replacement is refused with a `scheduleCode` (and a locked-session conflict
 * with `blockingReasons`) that the dialog needs to explain what to change, so
 * both are re-attached after validating them down to a closed code set.
 */
async function withScheduleErrorExtension(response: NextResponse, error: unknown): Promise<NextResponse> {
    const extension = pickServiceRecordScheduleErrorExtension(error);
    if (!extension) return response;
    const body = await response.json().catch(() => ({}));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return NextResponse.json(
        { ...(typeof body === "object" && body !== null ? body : {}), ...extension },
        { status: response.status, headers },
    );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return authRequiredResponse();
    const { draftId } = await params;

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post(
            `/admin/service-records/drafts/${encodeURIComponent(draftId)}/confirm`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return jsonResponse(response.data ?? {}, response.status);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) return invalidJson;
        const sanitized = errorResponse(error, "confirm service record draft", "mutation");
        const blocking = readBlockingOperation(error);
        const withBlocking = blocking ? await withBlockingOperation(sanitized, blocking) : sanitized;
        return withScheduleErrorExtension(withBlocking, error);
    }
}
