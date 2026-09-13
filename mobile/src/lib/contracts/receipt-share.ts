import {
  downloadValidatedBinary,
  fetchValidatedBinary,
  type ValidatedBinary,
} from "@/lib/contracts/document-download";

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
export type ReceiptDownloadHandler = (
  url: string,
  fileName: string,
  binary?: ValidatedBinary,
) => Promise<void> | void;

interface ShareReceiptPngOptions {
  url: string;
  fileName: string;
  navigatorObject?: ReceiptShareNavigator;
  fileConstructor?: ReceiptFileConstructor;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onDownload: ReceiptDownloadHandler;
  onError: (message: string) => void;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Downloads a validated receipt with the customer-specific filename. */
export async function downloadReceiptPng(
  url: string,
  fileName: string,
  documentObject: Pick<Document, "createElement" | "body"> | undefined =
    typeof document === "undefined" ? undefined : document,
  binary?: ValidatedBinary,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await downloadValidatedBinary(url, fileName, "png", {
    binary,
    documentObject,
    fetchImpl,
  });
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
  signal,
  onDownload,
  onError,
}: ShareReceiptPngOptions): Promise<ReceiptShareOutcome> {
  const downloadValidatedReceipt = async (binary?: ValidatedBinary): Promise<ReceiptShareOutcome> => {
    try {
      if (signal?.aborted) {
        return "cancelled";
      }
      const validatedBinary = binary ?? await fetchValidatedBinary(url, "png", { fetchImpl, signal });
      if (signal?.aborted) {
        return "cancelled";
      }
      await onDownload(url, fileName, validatedBinary);
      return "downloaded";
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        return "cancelled";
      }
      onError(RECEIPT_SHARE_ERROR_MESSAGE);
      return "failed";
    }
  };

  if (!navigatorObject?.share || !navigatorObject.canShare || !fileConstructor) {
    return downloadValidatedReceipt();
  }

  let canShareReceiptFile = false;
  try {
    canShareReceiptFile = navigatorObject.canShare({
      files: [new fileConstructor([""], fileName, { type: RECEIPT_PNG_MIME_TYPE })],
    });
  } catch {
    return downloadValidatedReceipt();
  }

  if (!canShareReceiptFile) {
    return downloadValidatedReceipt();
  }

  try {
    const receiptBinary = await fetchValidatedBinary(url, "png", { fetchImpl, signal });
    if (signal?.aborted) {
      return "cancelled";
    }
    const receiptFile = new fileConstructor([receiptBinary.blob], fileName, {
      type: RECEIPT_PNG_MIME_TYPE,
    });

    if (!navigatorObject.canShare({ files: [receiptFile] })) {
      return downloadValidatedReceipt(receiptBinary);
    }

    if (signal?.aborted) {
      return "cancelled";
    }
    await navigatorObject.share({ files: [receiptFile] });
    return "shared";
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      return "cancelled";
    }

    onError(RECEIPT_SHARE_ERROR_MESSAGE);
    return "failed";
  }
}
