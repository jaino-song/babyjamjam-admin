import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../../file-route-utils";

function copyNosniffHeader(
    upstreamHeaders: Record<string, unknown> | undefined,
    headers: Record<string, string>,
): void {
    const nosniff = upstreamHeaders?.["x-content-type-options"];
    if (nosniff) headers["X-Content-Type-Options"] = String(nosniff);
}

// The download request buffers the upstream body as an ArrayBuffer, so axios
// also buffers a rejected 4xx/5xx body instead of parsing it. Decode it before
// handing the error to errorResponse, which forwards a verbatim upstream
// problem body (or sanitizes to the Korean fallback) while preserving the
// upstream status — no locally authored English body anymore.
function decodeBufferedUpstreamError(error: unknown): unknown {
    const response = (error as { response?: { status?: number; data?: unknown } } | null | undefined)?.response;
    if (!response || !Buffer.isBuffer(response.data)) return error;
    let data: unknown;
    try {
        data = JSON.parse(response.data.toString("utf8"));
    } catch {
        data = undefined;
    }
    return { response: { status: response.status, data } };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
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

        // The backend decides Content-Type / Content-Disposition /
        // X-Content-Type-Options; the proxy only copies them through and never
        // invents its own values beyond the octet-stream/inline fallbacks.
        // Dropping nosniff here would let a browser re-sniff a type the backend
        // deliberately allowlisted for inline display.
        const headers: Record<string, string> = {
            "Content-Type": String(response.headers["content-type"] ?? "application/octet-stream"),
            "Content-Disposition": String(response.headers["content-disposition"] ?? "inline"),
            "Content-Length": String(response.data.byteLength),
        };
        copyNosniffHeader(response.headers, headers);

        return new NextResponse(response.data, {
            status: response.status,
            headers,
        });
    } catch (error) {
        return errorResponse(decodeBufferedUpstreamError(error), "download document");
    }
}

export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        // HEAD responses carry no body by HTTP contract, so the status is the
        // whole signal here; the GET sibling carries the problem body.
        if (!token) return new NextResponse(null, { status: 401 });

        const { fileId } = await params;
        if (!isValidFileId(fileId)) return new NextResponse(null, { status: 400 });

        const response = await serverAPIClient.get(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });
        const headers: Record<string, string> = {
            "Content-Type": response.data?.mimeType || "application/octet-stream",
            "Content-Disposition": "inline",
        };
        if (typeof response.data?.fileSize === "number") {
            headers["Content-Length"] = String(response.data.fileSize);
        }
        copyNosniffHeader(response.headers, headers);
        return new NextResponse(null, { headers });
    } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number } };
            if (axiosError.response?.status === 404) {
                return new NextResponse(null, { status: 404 });
            }
        }
        return new NextResponse(null, { status: 500 });
    }
}
