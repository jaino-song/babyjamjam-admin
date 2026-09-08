import {
  RECEIPT_SHARE_ERROR_MESSAGE,
  getReceiptFileName,
  shareReceiptPng,
  type ReceiptFileConstructor,
} from "./receipt-share";

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

function createResponse(body: BlobPart, ok = true, status = 200): Response {
  return {
    ok,
    status,
    blob: async () => new Blob([body], { type: "image/png" }),
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
      onDownload,
      onError,
    });

    expect(result).toBe("downloaded");
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("shares the fetched PNG with a PNG file name and MIME type", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    const fetchImpl = jest.fn().mockResolvedValue(createResponse("png-bytes"));

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
    expect(fetchImpl).toHaveBeenCalledWith("/receipt.png", { credentials: "include" });
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
      fetchImpl: jest.fn().mockResolvedValue(createResponse("png-bytes")),
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
