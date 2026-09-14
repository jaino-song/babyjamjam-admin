import { TextEncoder } from "node:util";

import {
  BinaryDownloadError,
  createValidatedBinary,
  downloadValidatedBinary,
  fetchValidatedBinary,
  readValidatedResponse,
} from "./document-download";

const PDF_BYTES = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55, 10, 37, 37, 69, 79, 70, 10]);
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function responseFor(
  bytes: Uint8Array,
  contentType: string,
  ok = true,
  status = 200,
): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    ok,
    status,
    headers: new Headers({ "content-type": contentType }),
    clone: () => responseFor(bytes, contentType, ok, status),
    json: async () => null,
    arrayBuffer: async () => copy.buffer,
  } as Response;
}

function genericUnauthorizedResponse(): Response {
  return {
    ok: false,
    status: 401,
    headers: new Headers({ "content-type": "application/json" }),
    clone: () => genericUnauthorizedResponse(),
    json: async () => ({ code: "UPSTREAM_ERROR" }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

describe("document binary validation", () => {
  it("accepts a PDF signature with the PDF MIME type", () => {
    const binary = createValidatedBinary(PDF_BYTES, "pdf", "application/pdf; charset=binary");

    expect(binary.kind).toBe("pdf");
    expect(binary.contentType).toBe("application/pdf");
    expect(Array.from(binary.bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
  });

  it("accepts a valid PDF declared as application/octet-stream", async () => {
    await expect(
      readValidatedResponse(responseFor(PDF_BYTES, "application/octet-stream"), "pdf"),
    ).resolves.toEqual(expect.objectContaining({ kind: "pdf" }));
  });

  it.each([
    ["application/json", JSON.stringify({ error: "upstream" })],
    ["text/html", "<html>error</html>"],
    ["application/pdf", "not a PDF"],
  ])("rejects a %s body when a PDF is expected", async (contentType, body) => {
    const bytes = new TextEncoder().encode(body);

    await expect(
      readValidatedResponse(responseFor(bytes, contentType), "pdf"),
    ).rejects.toBeInstanceOf(BinaryDownloadError);
  });

  it("requires a PNG signature before creating a shareable image", async () => {
    await expect(
      readValidatedResponse(responseFor(PNG_BYTES, "image/png"), "png"),
    ).resolves.toEqual(expect.objectContaining({ kind: "png", contentType: "image/png" }));

    await expect(
      readValidatedResponse(
        responseFor(new TextEncoder().encode(JSON.stringify({ error: "upstream" })), "image/png"),
        "png",
      ),
    ).rejects.toBeInstanceOf(BinaryDownloadError);
  });

  it.each([401, 403, 503])("does not save a non-2xx response (%i)", async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(
      responseFor(new TextEncoder().encode(JSON.stringify({ error: "denied" })), "application/json", false, status),
    );

    await expect(fetchValidatedBinary("/document", "pdf", { fetchImpl })).rejects.toBeInstanceOf(BinaryDownloadError);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/document",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("rethrows a native AbortError without changing its identity", async () => {
    const abortError = new DOMException("The request was aborted.", "AbortError");
    const fetchImpl = jest.fn().mockRejectedValue(abortError);

    await expect(fetchValidatedBinary("/document", "pdf", { fetchImpl })).rejects.toBe(abortError);
  });

  it("returns a named abort error when the signal aborts during a non-abort rejection", async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error("request interrupted");
    });

    await expect(
      fetchValidatedBinary("/document", "pdf", { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError", message: "request interrupted" });
  });

  it("normalizes a non-abort DOMException when the signal aborts", async () => {
    const controller = new AbortController();
    const networkError = new DOMException("request interrupted", "NetworkError");
    const fetchImpl = jest.fn().mockImplementation(async () => {
      controller.abort();
      throw networkError;
    });
    const request = fetchValidatedBinary("/document", "pdf", {
      fetchImpl,
      signal: controller.signal,
    });

    await expect(request).rejects.toMatchObject({ name: "AbortError", message: "request interrupted" });
    await expect(request).rejects.not.toBe(networkError);
  });

  it("wraps an ordinary fetch failure as a BinaryDownloadError", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("network failure"));

    await expect(fetchValidatedBinary("/document", "pdf", { fetchImpl })).rejects.toBeInstanceOf(
      BinaryDownloadError,
    );
  });

  it("refreshes an expired application session before reading a protected binary", async () => {
    const originalFetch = global.fetch;
    let binaryAttempts = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/auth/refresh") {
        return responseFor(new Uint8Array(), "application/json", true, 204);
      }

      binaryAttempts += 1;
      return binaryAttempts === 1
        ? genericUnauthorizedResponse()
        : responseFor(PDF_BYTES, "application/pdf");
    });
    global.fetch = fetchMock;

    try {
      await expect(
        fetchValidatedBinary("/api/eformsign/documents/doc-1/download", "pdf"),
      ).resolves.toMatchObject({ kind: "pdf", contentType: "application/pdf" });

      expect(binaryAttempts).toBe(2);
      expect(fetchMock.mock.calls.filter(([input]) => input === "/api/auth/refresh")).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not replay a protected binary when it is aborted during session refresh", async () => {
    const originalFetch = global.fetch;
    const controller = new AbortController();
    let binaryAttempts = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/auth/refresh") {
        controller.abort(new DOMException("cancelled", "AbortError"));
        return responseFor(new Uint8Array(), "application/json", true, 204);
      }

      binaryAttempts += 1;
      return genericUnauthorizedResponse();
    });

    try {
      await expect(
        fetchValidatedBinary("/api/eformsign/documents/doc-1/download", "pdf", {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(binaryAttempts).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("creates a download object URL only after validation and revokes it after the click", async () => {
    const click = jest.fn();
    const remove = jest.fn();
    const anchor = { href: "", download: "", target: "", rel: "", click, remove };
    const documentObject = {
      createElement: jest.fn().mockReturnValue(anchor),
      body: { appendChild: jest.fn() },
    };
    const urlObject = {
      createObjectURL: jest.fn().mockReturnValue("blob:validated"),
      revokeObjectURL: jest.fn(),
    };

    await downloadValidatedBinary(
      "/receipt.png",
      "홍길동 산모님 영수증.png",
      "png",
      {
        binary: createValidatedBinary(PNG_BYTES, "png", "image/png"),
        documentObject,
        urlObject,
        delayMs: 5,
      },
    );

    expect(anchor).toMatchObject({ href: "blob:validated", download: "홍길동 산모님 영수증.png" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(urlObject.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(urlObject.revokeObjectURL).toHaveBeenCalledWith("blob:validated");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
