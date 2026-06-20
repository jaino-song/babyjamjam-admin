import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function createErrorResponse(error: string, status: number, includeBody: boolean) {
    if (!includeBody) {
        return new NextResponse(null, { status });
    }

    return NextResponse.json({ error }, { status });
}

async function proxyDownload(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
    includeBody: boolean
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return createErrorResponse("Unauthorized", 401, includeBody);
        }

        const { fileId } = await params;
        const { searchParams } = new URL(request.url);
        const attachment = searchParams.get("attachment");

        if (!includeBody) {
            const response = await serverAPIClient.get(`/documents/${fileId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const headers: Record<string, string> = {
                "Content-Type": response.data?.mimeType || "application/octet-stream",
                "Content-Disposition": "inline",
            };

            if (typeof response.data?.fileSize === "number") {
                headers["Content-Length"] = String(response.data.fileSize);
            }

            return new NextResponse(null, { headers });
        }

        const url = attachment === "true"
            ? `/documents/${fileId}/download?attachment=true`
            : `/documents/${fileId}/download`;

        const response = await serverAPIClient.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            responseType: "arraybuffer",
        });

        const contentLength =
            response.headers["content-length"] ?? String(response.data.byteLength);

        return new NextResponse(includeBody ? response.data : null, {
            headers: {
                "Content-Type": response.headers["content-type"] || "application/octet-stream",
                "Content-Disposition": response.headers["content-disposition"] || "inline",
                "Content-Length": contentLength,
            },
        });
    } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number } };
            if (axiosError.response?.status === 404) {
                return createErrorResponse("Document not found", 404, includeBody);
            }
        }
        return createErrorResponse("Download failed", 500, includeBody);
    }
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ fileId: string }> }
) {
    return proxyDownload(request, context, true);
}

export async function HEAD(
    request: NextRequest,
    context: { params: Promise<{ fileId: string }> }
) {
    return proxyDownload(request, context, false);
}
