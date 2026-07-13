import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../../file-route-utils";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { fileId } = await params;
        if (!isValidFileId(fileId)) {
            return invalidFileIdResponse();
        }

        const { searchParams } = new URL(request.url);
        const attachment = searchParams.get("attachment");

        const url = documentPath(
            fileId,
            attachment === "true" ? "/download?attachment=true" : "/download",
        );

        const response = await serverAPIClient.get(url, {
            headers: getAuthHeaders(token),
            responseType: "arraybuffer",
        });

        return new NextResponse(response.data, {
            status: response.status,
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
        return errorResponse(error, "download document");
    }
}
