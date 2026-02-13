import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { fileId } = await params;
        const { searchParams } = new URL(request.url);
        const attachment = searchParams.get("attachment");

        const url = attachment === "true"
            ? `/documents/${fileId}/download?attachment=true`
            : `/documents/${fileId}/download`;

        const response = await serverAPIClient.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            responseType: "arraybuffer",
        });

        return new NextResponse(response.data, {
            headers: {
                "Content-Type": response.headers["content-type"] || "application/octet-stream",
                "Content-Disposition": response.headers["content-disposition"] || "inline",
                "Content-Length": String(response.data.byteLength),
            },
        });
    } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number } };
            if (axiosError.response?.status === 404) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }
        }
        return NextResponse.json({ error: "Download failed" }, { status: 500 });
    }
}
