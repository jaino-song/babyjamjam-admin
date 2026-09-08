const RECEIPT_PNG_MIME_TYPE = "image/png";

export const RECEIPT_SHARE_ERROR_MESSAGE =
  "영수증을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

export function getReceiptFileName(customerName: string | null | undefined): string {
  const trimmedName = customerName?.trim();
  return trimmedName ? `${trimmedName} 산모님 영수증.png` : "영수증.png";
}

export interface ReceiptShareData {
  files: File[];
}

export interface ReceiptShareNavigator {
  canShare?: (data?: ReceiptShareData) => boolean;
  share?: (data: ReceiptShareData) => Promise<void>;
}

export type ReceiptFileConstructor = new (
  bits: BlobPart[],
  fileName: string,
  options?: FilePropertyBag,
) => File;

export type ReceiptShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

interface ShareReceiptPngOptions {
  url: string;
  fileName: string;
  navigatorObject?: ReceiptShareNavigator;
  fileConstructor?: ReceiptFileConstructor;
  fetchImpl?: typeof fetch;
  onDownload: () => void;
  onError: (message: string) => void;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/**
 * Shares an eformsign receipt as a PNG file, falling back to the browser download
 * when the platform cannot share files. Fetch failures are reported in the
 * caller's localized UI; a user-cancelled share is intentionally silent.
 */
export async function shareReceiptPng({
  url,
  fileName,
  navigatorObject,
  fileConstructor,
  fetchImpl = globalThis.fetch,
  onDownload,
  onError,
}: ShareReceiptPngOptions): Promise<ReceiptShareOutcome> {
  if (
    !navigatorObject?.share ||
    !navigatorObject.canShare ||
    !fileConstructor
  ) {
    onDownload();
    return "downloaded";
  }

  let canShareReceiptFile = false;
  try {
    canShareReceiptFile = navigatorObject.canShare({
      files: [new fileConstructor([""], fileName, { type: RECEIPT_PNG_MIME_TYPE })],
    });
  } catch {
    onDownload();
    return "downloaded";
  }

  if (!canShareReceiptFile) {
    onDownload();
    return "downloaded";
  }

  try {
    const response = await fetchImpl(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Receipt PNG request failed with ${response.status}`);
    }

    const receiptBlob = await response.blob();
    const receiptFile = new fileConstructor([receiptBlob], fileName, {
      type: RECEIPT_PNG_MIME_TYPE,
    });

    if (!navigatorObject.canShare({ files: [receiptFile] })) {
      onDownload();
      return "downloaded";
    }

    await navigatorObject.share({ files: [receiptFile] });
    return "shared";
  } catch (error) {
    if (isAbortError(error)) {
      return "cancelled";
    }

    onError(RECEIPT_SHARE_ERROR_MESSAGE);
    return "failed";
  }
}
