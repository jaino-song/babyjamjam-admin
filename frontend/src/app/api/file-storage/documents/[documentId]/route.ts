import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;

    try {
        const response = await serverAPIClient.get(`/documents/${documentId}`);
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/documents] get ${documentId} error:`, error);
        return NextResponse.json(
            { error: "failed to fetch document" },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;

    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.put(`/documents/${documentId}`, body);
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/documents] put ${documentId} error:`, error);
        return NextResponse.json(
            { error: "failed to update document" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;

    try {
        const response = await serverAPIClient.delete(`/documents/${documentId}`);
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/documents] delete ${documentId} error:`, error);
        return NextResponse.json(
            { error: "failed to delete document" },
            { status: 500 }
        );
    }
}
