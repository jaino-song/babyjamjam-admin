import {
  RECEIPT_SHARE_ERROR_MESSAGE,
  downloadReceiptPng,
  getReceiptFileName,
  shareReceiptPng,
  type ReceiptFileConstructor,
} from "./receipt-share";
import { createValidatedBinary } from "./document-download";

class TestFile {
  readonly name: string;
  readonly type: string;
  readonly bits: BlobPart[];

  constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
    this.bits = bits;
    this.name = name;
    this.type = options?.type ?? "";
  }
}

const PNG_BYTES = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  8,
  6,
  0,
  0,
  0,
  31,
  21,
  196,
  137,
  0,
  0,
  0,
  13,
  73,
  68,
  65,
  84,
  120,
  156,
  99,
  96,
  0,
  0,
  0,
  2,
  0,
  1,
  226,
  33,
  188,
  51,
  0,
  0,
  0,
  0,
  73,
  69,
  78,
  68,
  174,
  66,
  96,
  130,
]);

function createResponse(body: BlobPart, ok = true, status = 200): Response {
  const responseBytes = body instanceof Uint8Array ? body : new Uint8Array(new Blob([body]).size);
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "image/png" }),
    arrayBuffer: async () => responseBytes.buffer,
  } as Response;
}

describe("shareReceiptPng", () => {
  const fileName = "홍길동 산모님 영수증.png";

  it("builds the customer-specific PNG filename and the unnamed fallback", () => {
    expect(getReceiptFileName(" 홍길동 ")).toBe("홍길동 산모님 영수증.png");
    expect(getReceiptFileName(null)).toBe("영수증.png");
  });

  it("downloads when file sharing is unsupported", async () => {
    const onDownload = jest.fn();
    const onError = jest.fn();
    const result = await shareReceiptPng({
      url: "/receipt.png",
      fileName,
      fileConstructor: TestFile as unknown as ReceiptFileConstructor,
      navigatorObject: { share: jest.fn() },
      fetchImpl: jest.fn().mockResolvedValue(createResponse(PNG_BYTES)),
      onDownload,
      onError,
    });

    expect(result).toBe("downloaded");
    expect(onDownload).toHaveBeenCalledWith(
      "/receipt.png",
      fileName,
      expect.objectContaining({ kind: "png", contentType: "image/png" }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("wires the receipt URL and customer filename to a browser download", async () => {
    const click = jest.fn();
    const remove = jest.fn();
    const anchor = { href: "", download: "", click, remove };
    const appendChild = jest.fn();
    const documentObject = {
      createElement: jest.fn().mockReturnValue(anchor),
      body: { appendChild },
    };
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn().mockReturnValue("blob:receipt"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });

    try {
      await downloadReceiptPng(
        "/receipt.png",
        fileName,
        documentObject as unknown as Pick<Document, "createElement" | "body">,
        createValidatedBinary(PNG_BYTES, "png", "image/png"),
        jest.fn(),
      );
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }

    expect(documentObject.createElement).toHaveBeenCalledWith("a");
    expect(anchor).toMatchObject({ href: "blob:receipt", download: fileName });
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("shares the fetched PNG with a PNG file name and MIME type", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    const fetchImpl = jest.fn().mockResolvedValue(createResponse(PNG_BYTES));

    const result = await shareReceiptPng({
      url: "/receipt.png",
      fileName,
      fileConstructor: TestFile as unknown as ReceiptFileConstructor,
      navigatorObject: { share, canShare },
      fetchImpl,
      onDownload: jest.fn(),
      onError: jest.fn(),
    });

    expect(result).toBe("shared");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/receipt.png",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0]).toEqual({
      files: [expect.objectContaining({ name: fileName, type: "image/png" })],
    });
  });

  it("quietly handles a user-cancelled share", async () => {
    const onError = jest.fn();
    const result = await shareReceiptPng({
      url: "/receipt.png",
      fileName,
      fileConstructor: TestFile as unknown as ReceiptFileConstructor,
      navigatorObject: {
        canShare: jest.fn().mockReturnValue(true),
        share: jest.fn().mockRejectedValue({ name: "AbortError" }),
      },
      fetchImpl: jest.fn().mockResolvedValue(createResponse(PNG_BYTES)),
      onDownload: jest.fn(),
      onError,
    });

    expect(result).toBe("cancelled");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a localized error when the PNG fetch fails", async () => {
    const onError = jest.fn();
    const result = await shareReceiptPng({
      url: "/receipt.png",
      fileName,
      fileConstructor: TestFile as unknown as ReceiptFileConstructor,
      navigatorObject: {
        canShare: jest.fn().mockReturnValue(true),
        share: jest.fn(),
      },
      fetchImpl: jest.fn().mockResolvedValue(createResponse("error", false, 502)),
      onDownload: jest.fn(),
      onError,
    });

    expect(result).toBe("failed");
    expect(onError).toHaveBeenCalledWith(RECEIPT_SHARE_ERROR_MESSAGE);
  });
});
