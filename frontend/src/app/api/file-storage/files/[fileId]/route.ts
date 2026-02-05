import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { fileId } = await params;

    try {
        const response = await serverAPIClient.get(`/documents/${fileId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/files] get ${fileId} error:`, error);
        return NextResponse.json(
            { error: "failed to fetch document" },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { fileId } = await params;

    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.put(`/documents/${fileId}`, body, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/files] put ${fileId} error:`, error);
        return NextResponse.json(
            { error: "failed to update document" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { fileId } = await params;

    try {
        const response = await serverAPIClient.delete(`/documents/${fileId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error(`[file-storage/files] delete ${fileId} error:`, error);
        return NextResponse.json(
            { error: "failed to delete document" },
            { status: 500 }
        );
    }
}
