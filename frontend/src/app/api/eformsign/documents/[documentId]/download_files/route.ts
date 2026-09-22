import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  localValidationProblemResponse,
  upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";

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
    throw new RangeError("page");
  }

  return pageNumber;
}

async function extractSinglePdfPage(sourcePdf: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const sourceDocument = await PDFDocument.load(sourcePdf);
  const sourcePageCount = sourceDocument.getPageCount();
  const sourcePageIndex = pageNumber - 1;

  if (sourcePageIndex >= sourcePageCount) {
    // Machine-readable signal for the validation-problem mapper below; the
    // raw message never reaches the client.
    throw new RangeError(`page-count:${sourcePageCount}`);
  }

  const receiptDocument = await PDFDocument.create();
  const [receiptPage] = await receiptDocument.copyPages(sourceDocument, [sourcePageIndex]);
  receiptDocument.addPage(receiptPage);

  return receiptDocument.save();
}

/**
 * Proxies the eformsign document PDF from the backend. With `?page=N`, extracts that single
 * page (used for the receipt at `page=7`) — mirrors the mobile BFF route. Backend returns the
 * full PDF; page extraction is a BFF concern. Receipt PNG requests are rendered upstream.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return authRequiredResponse();
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
      return errorResponse({ response }, "fetch eformsign document PDF", "read");
    }

    const contentType = String(response.headers["content-type"] || "application/pdf");
    const responseBody =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : new Uint8Array(response.data as ArrayLike<number>);
    if (isReceiptPng) {
      if (!contentType.startsWith("image/png")) {
        // The upstream did not render a receipt image: answer the registered
        // 502 problem instead of a raw body.
        return upstreamStatusProblemResponse(
          502,
          "render eformsign receipt image",
          "NOT_APPLIED",
          "read",
        );
      }
      return new NextResponse(responseBody, {
        status: response.status,
        headers: {
          "Content-Type": "image/png",
          // The same-origin download attribute supplies the customer-specific filename.
          "Content-Disposition": "attachment",
          "Cache-Control": "private, no-store",
        },
      });
    }

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
        "Content-Type": requestedPage ? "application/pdf" : contentType,
        "Content-Disposition": `${dispositionType}; filename="${safeFilenamePart(documentId)}-${filenameSuffix}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      // RangeErrors here are always BFF-authored page validations — the
      // upstream PDF bytes never surface — so answer the registered
      // validation problem instead of the raw English message.
      const outOfRange = /^page-count:(\d+)$/.exec(error.message);
      return localValidationProblemResponse([
        {
          pointer: "/page",
          code: outOfRange ? "OUT_OF_RANGE" : "INVALID_VALUE",
          detail: outOfRange
            ? `요청한 페이지는 문서의 전체 ${outOfRange[1]}페이지를 벗어났어요.`
            : "요청한 페이지는 1 이상의 정수여야 해요.",
          location: "query",
        },
      ]);
    }

    return errorResponse(error, "fetch eformsign document PDF", "read");
  }
}
