import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    getUpstreamErrorStatus,
    logUpstreamError,
} from "@/lib/api/route-utils";
import { pickServiceRecordScheduleErrorExtension } from "@/features/service-records/types/admin-edit";

type RouteParams = { params: Promise<{ id: string }> };

const CLIENT_RETENTION_BLOCKED_CODE = "CLIENT_RETENTION_BLOCKED";
const CLIENT_RETENTION_BLOCKED_MESSAGE =
    "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.";
const CLIENT_DELETE_CONFLICT_FALLBACK =
    "연결된 정보 때문에 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";

function getUpstreamErrorData(error: unknown): unknown {
    if (!error || typeof error !== "object" || !("response" in error)) return undefined;
    const response = (error as { response?: { data?: unknown } }).response;
    return response?.data;
}

function getUpstreamErrorCode(error: unknown): unknown {
    const data = getUpstreamErrorData(error);
    if (!data || typeof data !== "object") return undefined;
    return (data as { code?: unknown }).code;
}

/**
 * A client update that cannot re-lay the remaining sessions answers 409 with
 * `scheduleCode: REALIGNMENT_REQUIRES_MANUAL_SCHEDULE`. The shared sanitizer
 * drops that member, so it is re-attached (known codes only) for the form to
 * point the admin at the schedule dialog.
 */
async function withScheduleErrorExtension(response: NextResponse, error: unknown): Promise<NextResponse> {
    const extension = pickServiceRecordScheduleErrorExtension(error);
    if (!extension?.scheduleCode) return response;
    const body = await response.json().catch(() => ({}));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return NextResponse.json(
        { ...(typeof body === "object" && body !== null ? body : {}), scheduleCode: extension.scheduleCode },
        { status: response.status, headers },
    );
}

// GET /api/clients/[id] - Get a client by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch client", "read");
    }
}

// PATCH /api/clients/[id] - Update a client
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        const body = await request.json();
        const response = await serverAPIClient.patch(`/clients/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return withScheduleErrorExtension(errorResponse(error, "update client", "mutation"), error);
    }
}

// DELETE /api/clients/[id] - Delete a client
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        await serverAPIClient.delete(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (getUpstreamErrorStatus(error) === 409) {
            const isAllowlistedConflict = getUpstreamErrorCode(error) === CLIENT_RETENTION_BLOCKED_CODE;
            logUpstreamError("delete client", error);
            return NextResponse.json(
                {
                    error: isAllowlistedConflict
                        ? CLIENT_RETENTION_BLOCKED_MESSAGE
                        : CLIENT_DELETE_CONFLICT_FALLBACK,
                    code: CLIENT_RETENTION_BLOCKED_CODE,
                },
                { status: 409 },
            );
        }
        return errorResponse(error, "delete client", "mutation");
    }
}
