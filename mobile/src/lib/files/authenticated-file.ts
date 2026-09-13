import { authenticatedFetch } from "@/lib/api/authenticated-fetch";

export interface AuthenticatedFileFetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchAuthenticatedFileBlob(
  url: string,
  { signal, fetchImpl = authenticatedFetch }: AuthenticatedFileFetchOptions = {},
): Promise<Blob> {
  const response = await fetchImpl(url, {
    cache: "no-store",
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error("Unable to fetch protected file");
  }
  return response.blob();
}

interface DownloadAuthenticatedFileOptions extends AuthenticatedFileFetchOptions {
  documentObject?: Pick<Document, "createElement" | "body">;
  urlObject?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export const AUTHENTICATED_FILE_OBJECT_URL_REVOKE_DELAY_MS = 1_000;

type FileSaveOptions = Pick<DownloadAuthenticatedFileOptions, "documentObject" | "urlObject"> & {
  revokeDelayMs?: number;
};

export function saveBlobAsFile(
  blob: Blob,
  fileName: string,
  {
    documentObject = document,
    urlObject = URL,
    revokeDelayMs = AUTHENTICATED_FILE_OBJECT_URL_REVOKE_DELAY_MS,
  }: FileSaveOptions = {},
): void {
  const objectUrl = urlObject.createObjectURL(blob);
  const anchor = documentObject.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    documentObject.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => {
      urlObject.revokeObjectURL(objectUrl);
    }, Math.max(0, revokeDelayMs));
  }
}

export async function downloadAuthenticatedFile(
  url: string,
  fileName: string,
  {
    documentObject = document,
    urlObject = URL,
    ...fetchOptions
  }: DownloadAuthenticatedFileOptions = {},
): Promise<void> {
  const blob = await fetchAuthenticatedFileBlob(url, fetchOptions);
  saveBlobAsFile(blob, fileName, { documentObject, urlObject });
}
