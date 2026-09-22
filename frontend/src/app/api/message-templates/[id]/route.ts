import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { authRequiredResponse, errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch message template", "read");
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        const body = await request.json();
        const response = await serverAPIClient.patch(`/message-templates/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "update message template", "mutation");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const { id } = await params;
        await serverAPIClient.delete(`/message-templates/${id}`, {
            headers: getAuthHeaders(token),
        });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return errorResponse(error, "delete message template", "mutation");
    }
}
