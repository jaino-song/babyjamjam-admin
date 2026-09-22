import { validationProblemResponse } from "@/lib/api/problem-responses";

export function isValidFileId(fileId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(fileId);
}

export function invalidFileIdResponse() {
  return validationProblemResponse("Invalid file id", [
    { pointer: "/fileId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
  ]);
}

export function documentPath(fileId: string, suffix = ""): string {
  return `/documents/${encodeURIComponent(fileId)}${suffix}`;
}
