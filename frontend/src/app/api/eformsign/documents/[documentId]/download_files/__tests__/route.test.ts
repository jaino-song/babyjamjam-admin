/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;

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

describe("eformsign document download_files route", () => {
  beforeEach(() => {
    mockServerGet.mockReset();
  });

  it("returns only the requested PDF page when page is provided (receipt = page 7)", async () => {
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
    mockServerGet.mockResolvedValue({ status: 200, headers: { "content-type": "image/png" }, data: png });
    const response = await GET(
      createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&format=receipt-png"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(mockServerGet).toHaveBeenCalledWith("/api/documents/doc-1/download_files", expect.objectContaining({
      params: { fileType: "document", format: "receipt-png" },
    }));
  });

  it("does not mislabel a PDF response as PNG", async () => {
    mockServerGet.mockResolvedValue({ status: 200, headers: { "content-type": "application/pdf" }, data: await createPdf(8) });
    const response = await GET(
      createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?format=receipt-png"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "UPSTREAM_INVALID_RESPONSE",
      status: 502,
      outcome: "NOT_APPLIED",
    });
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
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
    const body = await response.json();
    expect(body).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      outcome: "NOT_APPLIED",
    });
    expect(body.errors).toMatchObject([{ pointer: "/page", code: "OUT_OF_RANGE" }]);
    expect(JSON.stringify(body)).not.toContain("Requested page 7 but PDF only has 2 pages.");
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(mockServerGet).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-integer page with a validation problem before touching PDF bytes", async () => {
    const response = await GET(
      createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?page=abc"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    expect(body.errors).toMatchObject([{ pointer: "/page", code: "INVALID_VALUE" }]);
    expect(mockServerGet).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated download with a registered 401 problem body", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/eformsign/documents/doc-1/download_files"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(mockServerGet).not.toHaveBeenCalled();
  });

  it("sanitizes an upstream download failure instead of reflecting binary details", async () => {
    mockServerGet.mockRejectedValue({
      response: { status: 500, data: { message: "pdf store shard-5 exploded" } },
    });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(
        createRequest("http://localhost/api/eformsign/documents/doc-1/download_files"),
        { params: Promise.resolve({ documentId: "doc-1" }) },
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(typeof body.error).toBe("string");
      expect(JSON.stringify(body)).not.toContain("shard-5");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
