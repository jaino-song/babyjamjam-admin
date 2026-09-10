export type DownloadBinaryKind = "pdf" | "png";

export interface ValidatedBinary {
  kind: DownloadBinaryKind;
  blob: Blob;
  bytes: Uint8Array;
  contentType: "application/pdf" | "image/png";
}

export class BinaryDownloadError extends Error {
  constructor(message = "파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") {
    super(message);
    this.name = "BinaryDownloadError";
  }
}

const PDF_SIGNATURE = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_SIGNATURE = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

const PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-pdf",
]);
const PNG_MIME_TYPES = new Set([
  "image/png",
  "application/octet-stream",
  "binary/octet-stream",
]);

export const DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS = 1_000;

function normalizeContentType(contentType: string | null | undefined): string {
  return String(contentType ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";
}

function hasSignature(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.byteLength < signature.byteLength) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

/** Converts the array-like bodies returned by axios without accepting text error payloads. */
export function toBinaryBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (
    Array.isArray(value) &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  ) {
    return Uint8Array.from(value);
  }

  return null;
}

interface ValidateBinaryOptions {
  allowMissingContentType?: boolean;
}

/**
 * Validates both the declared media type and the magic bytes before a response
 * can be handed to pdf.js, a File constructor, or a browser download.
 */
export function validateBinaryBytes(
  value: unknown,
  kind: DownloadBinaryKind,
  contentType: string | null | undefined,
  { allowMissingContentType = true }: ValidateBinaryOptions = {},
): Uint8Array {
  const bytes = toBinaryBytes(value);
  if (!bytes || bytes.byteLength === 0) {
    throw new BinaryDownloadError();
  }

  const normalizedContentType = normalizeContentType(contentType);
  const acceptedMimeTypes = kind === "pdf" ? PDF_MIME_TYPES : PNG_MIME_TYPES;
  if (
    (!normalizedContentType && !allowMissingContentType) ||
    (normalizedContentType && !acceptedMimeTypes.has(normalizedContentType))
  ) {
    throw new BinaryDownloadError();
  }

  const signature = kind === "pdf" ? PDF_SIGNATURE : PNG_SIGNATURE;
  if (!hasSignature(bytes, signature)) {
    throw new BinaryDownloadError();
  }

  return bytes;
}

export function createValidatedBinary(
  value: unknown,
  kind: DownloadBinaryKind,
  contentType: string | null | undefined,
  options?: ValidateBinaryOptions,
): ValidatedBinary {
  const bytes = validateBinaryBytes(value, kind, contentType, options);
  const canonicalContentType = kind === "pdf" ? "application/pdf" : "image/png";
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);

  return {
    kind,
    bytes,
    blob: new Blob([blobBytes.buffer], { type: canonicalContentType }),
    contentType: canonicalContentType,
  };
}

function getResponseContentType(response: Response): string {
  const headers = response.headers as Headers | undefined;
  if (typeof headers?.get === "function") {
    return headers.get("content-type") ?? "";
  }

  const fallbackHeaders = headers as unknown as Record<string, unknown> | undefined;
  const value = fallbackHeaders?.["content-type"] ?? fallbackHeaders?.["Content-Type"];
  return typeof value === "string" ? value : "";
}

export async function readValidatedResponse(
  response: Response,
  kind: DownloadBinaryKind,
  options?: ValidateBinaryOptions,
): Promise<ValidatedBinary> {
  if (!response.ok) {
    throw new BinaryDownloadError();
  }

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch {
    throw new BinaryDownloadError();
  }

  return createValidatedBinary(body, kind, getResponseContentType(response), options);
}

export interface FetchValidatedBinaryOptions extends ValidateBinaryOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export async function fetchValidatedBinary(
  url: string,
  kind: DownloadBinaryKind,
  { fetchImpl = globalThis.fetch, signal, ...validationOptions }: FetchValidatedBinaryOptions = {},
): Promise<ValidatedBinary> {
  if (typeof fetchImpl !== "function") {
    throw new BinaryDownloadError();
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      credentials: "include",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      const abortError = error instanceof Error ? error : new Error("The request was aborted.");
      abortError.name = "AbortError";
      throw abortError;
    }
    throw new BinaryDownloadError();
  }

  if (signal?.aborted) {
    const abortError = new Error("The request was aborted.");
    abortError.name = "AbortError";
    throw abortError;
  }

  return readValidatedResponse(response, kind, validationOptions);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const abortError = new Error("The request was aborted.");
  abortError.name = "AbortError";
  throw abortError;
}

type DocumentLike = Pick<Document, "createElement"> & {
  body?: Pick<HTMLElement, "appendChild"> | null;
};
type UrlLike = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

function getDocument(documentObject?: DocumentLike): DocumentLike | undefined {
  return documentObject ?? (typeof document === "undefined" ? undefined : document);
}

function getUrlObject(urlObject?: UrlLike): UrlLike | undefined {
  return urlObject ?? (typeof URL === "undefined" ? undefined : URL);
}

function scheduleObjectUrlRevoke(
  objectUrl: string,
  urlObject: UrlLike,
  delayMs = DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS,
): void {
  setTimeout(() => {
    try {
      urlObject.revokeObjectURL(objectUrl);
    } catch {
      // Revocation is best-effort; the browser owns the object URL lifetime.
    }
  }, Math.max(0, delayMs));
}

interface TriggerObjectUrlOptions {
  documentObject?: DocumentLike;
  urlObject?: UrlLike;
  target?: "_blank" | "_self";
  delayMs?: number;
}

function triggerObjectUrl(
  binary: ValidatedBinary,
  fileName: string,
  { documentObject: providedDocument, urlObject: providedUrlObject, target = "_self", delayMs }: TriggerObjectUrlOptions = {},
): void {
  const documentObject = getDocument(providedDocument);
  const urlObject = getUrlObject(providedUrlObject);
  if (!documentObject || !urlObject) {
    throw new BinaryDownloadError();
  }

  let objectUrl: string;
  try {
    objectUrl = urlObject.createObjectURL(binary.blob);
  } catch {
    throw new BinaryDownloadError();
  }

  try {
    const anchor = documentObject.createElement("a");
    anchor.href = objectUrl;
    if (fileName) {
      anchor.download = fileName;
    }
    anchor.target = target;
    anchor.rel = "noopener noreferrer";
    documentObject.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    try {
      urlObject.revokeObjectURL(objectUrl);
    } catch {
      // Best effort only.
    }
    throw new BinaryDownloadError();
  }

  scheduleObjectUrlRevoke(objectUrl, urlObject, delayMs);
}

export interface TriggerValidatedBinaryOptions extends TriggerObjectUrlOptions {
  binary?: ValidatedBinary;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export async function downloadValidatedBinary(
  url: string,
  fileName: string,
  kind: DownloadBinaryKind,
  { binary, fetchImpl, signal, ...triggerOptions }: TriggerValidatedBinaryOptions = {},
): Promise<void> {
  throwIfAborted(signal);
  const validatedBinary = binary ?? await fetchValidatedBinary(url, kind, { fetchImpl, signal });
  throwIfAborted(signal);
  if (validatedBinary.kind !== kind) {
    throw new BinaryDownloadError();
  }
  triggerObjectUrl(validatedBinary, fileName, triggerOptions);
}

export async function openValidatedBinary(
  url: string,
  kind: DownloadBinaryKind,
  { binary, fetchImpl, signal, ...triggerOptions }: TriggerValidatedBinaryOptions = {},
): Promise<void> {
  throwIfAborted(signal);
  const validatedBinary = binary ?? await fetchValidatedBinary(url, kind, { fetchImpl, signal });
  throwIfAborted(signal);
  if (validatedBinary.kind !== kind) {
    throw new BinaryDownloadError();
  }
  triggerObjectUrl(validatedBinary, "", { ...triggerOptions, target: "_blank" });
}

export function revokeObjectUrl(objectUrl: string, urlObject?: UrlLike): void {
  const resolvedUrlObject = getUrlObject(urlObject);
  if (!resolvedUrlObject) {
    return;
  }

  try {
    resolvedUrlObject.revokeObjectURL(objectUrl);
  } catch {
    // Best effort only.
  }
}
