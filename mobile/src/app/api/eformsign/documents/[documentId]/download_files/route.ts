import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    getUpstreamErrorStatus,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import {
    BinaryDownloadError,
    toBinaryBytes,
    validateBinaryBytes,
} from "@/lib/contracts/document-download";

type EformsignFileType = "document" | "audit_trail";

function normalizeFileType(value: string | null): EformsignFileType {
    return value === "audit_trail" ? "audit_trail" : "document";
}

function safeFilenamePart(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "document";
}

function parsePageNumber(value: string | null): number | null {
    if (!value) return null;

    const pageNumber = Number(value);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new RangeError("Requested page must be a positive integer.");
    }

    return pageNumber;
}

function getResponseHeader(
    headers: Record<string, unknown> | undefined,
    name: string,
): string | undefined {
    if (!headers) {
        return undefined;
    }

    const lowerName = name.toLowerCase();
    const value = headers[lowerName] ?? headers[name] ?? headers[name.toUpperCase()];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function noStoreHeaders(contentType?: string): Headers {
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (contentType) {
        headers.set("Content-Type", contentType);
    }
    return headers;
}

function safeBinaryErrorResponse(message: string, status = 502): NextResponse {
    return NextResponse.json(
        { error: message },
        {
            status,
            headers: { "Cache-Control": "private, no-store" },
        },
    );
}

function headErrorResponse(error: unknown): NextResponse {
    const upstreamHeaders = (
        error && typeof error === "object"
            ? (error as { response?: { headers?: Record<string, unknown> } }).response?.headers
            : undefined
    );
    const headers = noStoreHeaders(getResponseHeader(upstreamHeaders, "content-type"));
    const retryAfter = getResponseHeader(upstreamHeaders, "retry-after");
    const wwwAuthenticate = getResponseHeader(upstreamHeaders, "www-authenticate");
    if (retryAfter) {
        headers.set("Retry-After", retryAfter);
    }
    if (wwwAuthenticate) {
        headers.set("WWW-Authenticate", wwwAuthenticate);
    }

    return new NextResponse(null, {
        status: getUpstreamErrorStatus(error, 502),
        headers,
    });
}

async function extractSinglePdfPage(sourcePdf: Uint8Array, pageNumber: number): Promise<Uint8Array> {
    const sourceDocument = await PDFDocument.load(sourcePdf);
    const sourcePageCount = sourceDocument.getPageCount();
    const sourcePageIndex = pageNumber - 1;

    if (sourcePageIndex >= sourcePageCount) {
        throw new RangeError(`Requested page ${pageNumber} but PDF only has ${sourcePageCount} pages.`);
    }

    const receiptDocument = await PDFDocument.create();
    const [receiptPage] = await receiptDocument.copyPages(sourceDocument, [sourcePageIndex]);
    receiptDocument.addPage(receiptPage);

    return receiptDocument.save();
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const authToken = getAuthToken(request);

    if (!authToken) {
        const response = unauthorizedResponse("Authentication required. Please log in.");
        response.headers.set("Cache-Control", "private, no-store");
        return response;
    }

    const { documentId } = await params;
    const { searchParams } = new URL(request.url);
    const fileType = normalizeFileType(searchParams.get("fileType"));
    const requestedPageParam = searchParams.get("page");
    const isReceiptPng = searchParams.get("format") === "receipt-png";

    try {
        const requestedPage = parsePageNumber(requestedPageParam);
        const response = await serverAPIClient.get(
            `/api/documents/${encodeURIComponent(documentId)}/download_files`,
            {
                params: { fileType, ...(isReceiptPng ? { format: "receipt-png" } : {}) },
                headers: getAuthHeaders(authToken),
                responseType: "arraybuffer",
            },
        );

        if (response.status >= 400) {
            return safeBinaryErrorResponse(
                "계약서 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
                response.status,
            );
        }

        const contentType = getResponseHeader(response.headers, "content-type") ?? "";
        const responseBody = toBinaryBytes(response.data);
        if (!responseBody) {
            throw new BinaryDownloadError();
        }
        if (isReceiptPng) {
            try {
                validateBinaryBytes(responseBody, "png", contentType, {
                    allowMissingContentType: false,
                });
            } catch (error) {
                if (error instanceof BinaryDownloadError) {
                    return safeBinaryErrorResponse("영수증 이미지 생성에 실패했습니다.");
                }
                throw error;
            }
            return new NextResponse(responseBody.buffer.slice(
                responseBody.byteOffset,
                responseBody.byteOffset + responseBody.byteLength,
            ) as ArrayBuffer, {
                status: response.status,
                headers: {
                    "Content-Type": "image/png",
                    "Content-Disposition": "attachment",
                    "Cache-Control": "private, no-store",
                },
            });
        }

        validateBinaryBytes(responseBody, "pdf", contentType);
        const outputBody = requestedPage
            ? await extractSinglePdfPage(responseBody, requestedPage)
            : responseBody;
        const outputArrayBuffer = outputBody.buffer.slice(
            outputBody.byteOffset,
            outputBody.byteOffset + outputBody.byteLength,
        ) as ArrayBuffer;
        const dispositionType = requestedPage ? "attachment" : "inline";
        const filenameSuffix = requestedPage ? `${fileType}-page-${requestedPage}` : fileType;

        return new NextResponse(outputArrayBuffer, {
            status: response.status,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `${dispositionType}; filename="${safeFilenamePart(documentId)}-${filenameSuffix}.pdf"`,
                "Cache-Control": "private, no-store",
            },
        });
    } catch (error) {
        if (error instanceof RangeError) {
            return safeBinaryErrorResponse(error.message, 400);
        }

        if (error instanceof BinaryDownloadError) {
            return safeBinaryErrorResponse("계약서 PDF를 불러오지 못했습니다.");
        }

        const response = errorResponse(error, "fetch eformsign document PDF");
        response.headers.set("Cache-Control", "private, no-store");
        return response;
    }
}

/**
 * Authenticated, bodyless availability probe used by the embedded mobile
 * viewer. Receipt PNG URLs intentionally do not share this PDF HEAD path.
 */
export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> },
) {
    const authToken = getAuthToken(request);

    if (!authToken) {
        return new NextResponse(null, {
            status: 401,
            headers: { "Cache-Control": "private, no-store" },
        });
    }

    const { documentId } = await params;
    const { searchParams } = new URL(request.url);
    if (searchParams.get("format") === "receipt-png") {
        return new NextResponse(null, {
            status: 405,
            headers: {
                "Allow": "GET",
                "Cache-Control": "private, no-store",
            },
        });
    }

    const fileType = normalizeFileType(searchParams.get("fileType"));

    try {
        const response = await serverAPIClient.head(
            `/api/documents/${encodeURIComponent(documentId)}/download_files`,
            {
                params: { fileType },
                headers: getAuthHeaders(authToken),
            },
        );
        const contentType = getResponseHeader(response.headers, "content-type");
        const headers = noStoreHeaders(contentType);
        const contentLength = getResponseHeader(response.headers, "content-length");
        if (contentLength) {
            headers.set("Content-Length", contentLength);
        }

        return new NextResponse(null, {
            status: response.status,
            headers,
        });
    } catch (error) {
        return headErrorResponse(error);
    }
}
