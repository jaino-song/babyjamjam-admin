/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import { GET, HEAD } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        head: jest.fn(),
    },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;
const mockServerHead = serverAPIClient.head as jest.Mock;

async function createPdf(pageCount: number): Promise<Uint8Array> {
    const document = await PDFDocument.create();

    for (let index = 0; index < pageCount; index += 1) {
        document.addPage([300, 400]);
    }

    return document.save();
}

function createRequest(url: string): NextRequest {
    return new NextRequest(url, {
        headers: {
            cookie: "auth_token=auth-token",
        },
    });
}

describe("eformsign document download route", () => {
    beforeEach(() => {
        mockServerGet.mockReset();
        mockServerHead.mockReset();
    });

    it("returns only the requested PDF page when page is provided", async () => {
        const sourcePdf = await createPdf(8);
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "application/pdf" },
            data: sourcePdf,
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&page=7"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Disposition")).toContain("attachment;");
        expect(response.headers.get("Content-Disposition")).toContain("doc-1-document-page-7.pdf");
        expect(mockServerGet).toHaveBeenCalledWith(
            "/api/documents/doc-1/download_files",
            expect.objectContaining({ params: { fileType: "document" } }),
        );

        const outputPdf = await PDFDocument.load(await response.arrayBuffer());
        expect(outputPdf.getPageCount()).toBe(1);
    });

    it("forwards receipt PNG bytes without PDF extraction or a filename override", async () => {
        const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "image/png" },
            data: png,
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&format=receipt-png"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/png");
        expect(response.headers.get("Content-Disposition")).toBe("attachment");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
        expect(mockServerGet).toHaveBeenCalledWith(
            "/api/documents/doc-1/download_files",
            expect.objectContaining({ params: { fileType: "document", format: "receipt-png" } }),
        );
    });

    it("rejects a receipt PNG request when upstream returns a non-PNG MIME type", async () => {
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "application/pdf" },
            data: await createPdf(8),
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?format=receipt-png"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({ error: "영수증 이미지 생성에 실패했습니다." });
    });

    it("keeps ordinary full PDF downloads inline", async () => {
        const sourcePdf = await createPdf(8);
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "application/pdf" },
            data: sourcePdf,
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        expect(response.headers.get("Content-Disposition")).toContain("inline;");
        expect(mockServerGet).toHaveBeenCalledWith(
            "/api/documents/doc-1/download_files",
            expect.objectContaining({ params: { fileType: "document" } }),
        );
        const outputPdf = await PDFDocument.load(await response.arrayBuffer());
        expect(outputPdf.getPageCount()).toBe(8);
    });

    it("rejects page requests beyond the PDF page count", async () => {
        const sourcePdf = await createPdf(2);
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "application/pdf" },
            data: sourcePdf,
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&page=7"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Requested page 7 but PDF only has 2 pages.",
        });
    });

    it("returns an authenticated, bodyless PDF availability probe", async () => {
        mockServerHead.mockResolvedValue({
            status: 200,
            headers: {
                "content-type": "application/pdf",
                "content-length": "2048",
            },
        });

        const response = await HEAD(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=audit_trail"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        expect(response.headers.get("Content-Length")).toBe("2048");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect((await response.arrayBuffer()).byteLength).toBe(0);
        expect(mockServerHead).toHaveBeenCalledWith(
            "/api/documents/doc-1/download_files",
            expect.objectContaining({
                params: { fileType: "audit_trail" },
            }),
        );
    });

    it("does not label a receipt PNG HEAD as a PDF probe", async () => {
        const response = await HEAD(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?format=receipt-png"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(405);
        expect(response.headers.get("Content-Type")).toBeNull();
        expect(mockServerHead).not.toHaveBeenCalled();
    });

    it("does not contact the backend for an unauthenticated HEAD request", async () => {
        const response = await HEAD(
            new NextRequest("http://localhost/api/eformsign/documents/doc-1/download_files", { method: "HEAD" }),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect((await response.arrayBuffer()).byteLength).toBe(0);
        expect(mockServerHead).not.toHaveBeenCalled();
    });

    it("preserves safe retry metadata for an upstream HEAD failure without forwarding cookies", async () => {
        mockServerHead.mockRejectedValue(
            Object.assign(new Error("not ready"), {
                response: {
                    status: 503,
                    headers: {
                        "content-type": "application/json",
                        "retry-after": "30",
                        "set-cookie": "backend-session=secret",
                    },
                },
            }),
        );

        const response = await HEAD(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("30");
        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect((await response.arrayBuffer()).byteLength).toBe(0);
    });

    it.each([
        ["application/json", JSON.stringify({ error: "backend unavailable" })],
        ["text/html", "<html><body>upstream error</body></html>"],
        ["application/pdf", "not a pdf"],
    ])("never returns a %s body as a successful PDF", async (contentType, body) => {
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": contentType },
            data: new TextEncoder().encode(body),
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(502);
        expect(response.headers.get("Content-Type")).toContain("application/json");
        expect(JSON.stringify(await response.json())).not.toContain("upstream error");
    });

    it("accepts a valid PDF returned as application/octet-stream", async () => {
        const sourcePdf = await createPdf(1);
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            data: sourcePdf,
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        await expect(PDFDocument.load(await response.arrayBuffer())).resolves.toBeDefined();
    });

    it("rejects a receipt response with a PNG MIME type when its bytes are JSON", async () => {
        mockServerGet.mockResolvedValue({
            status: 200,
            headers: { "content-type": "image/png" },
            data: new TextEncoder().encode(JSON.stringify({ error: "not an image" })),
        });

        const response = await GET(
            createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?format=receipt-png"),
            { params: Promise.resolve({ documentId: "doc-1" }) },
        );

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({ error: "영수증 이미지 생성에 실패했습니다." });
    });
});
