import * as Sentry from "@sentry/nextjs";
import type { AxiosError } from "axios";

import {
  isServiceRecordSentrySignal,
  sanitizeSentryText,
  sanitizeSentryUrl,
  SERVICE_RECORD_SENTRY_FEATURE,
  SERVICE_RECORD_SENTRY_TAG,
} from "./sentry-config";

const reportedErrors = new WeakSet<object>();
const MIN_OPAQUE_ID_LENGTH = 16;
// Literal collection operations found in document BFF routes and API callers.
const DOCUMENT_COLLECTION_ROUTES = new Set([
  "completed", "in-progress", "status-counts", "rejected", "expired", "upload", "capabilities",
]);

export type ServiceRecordOperation =
  | "public-link"
  | "verify"
  | "context"
  | "save-header"
  | "save-session"
  | "submit-session"
  | "finalize"
  | "render";

function getRequestPath(url: string | undefined): string {
  if (!url) return "unknown";

  try {
    return new URL(url, "https://api.local").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] || "unknown";
  }
}

function getServiceRecordOperation(path: string): ServiceRecordOperation {
  if (path.includes("/verify")) return "verify";
  if (path.includes("/context")) return "context";
  if (path.includes("/header")) return "save-header";
  if (path.includes("/finalize")) return "finalize";
  if (path.includes("/sessions/") && path.includes("/submit")) return "submit-session";
  if (path.includes("/sessions/")) return "save-session";
  return "public-link";
}

function isAxiosErrorLike(error: unknown): error is AxiosError {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    error.isAxiosError === true
  );
}

export function captureApiError(error: unknown): boolean {
  if (!isAxiosErrorLike(error) || error.code === "ERR_CANCELED") return false;

  const status = error.response?.status;
  if (typeof status === "number" && status < 500) return false;
  const method = (error.config?.method ?? "unknown").toUpperCase();
  const path = getRequestPath(error.config?.url);
  if (reportedErrors.has(error)) return false;

  reportedErrors.add(error);

  const sanitizedPath = sanitizeSentryUrl(path) ?? "unknown";
  const statusLabel = status ? String(status) : "network";
  const isServiceRecord = isServiceRecordSentrySignal(path);
  const pathTemplate = isServiceRecord ? sanitizedPath : sanitizedPath
    .split("/")
    .map((segment) => (
      /^\d+$/.test(segment) || (segment.length >= MIN_OPAQUE_ID_LENGTH && /\d/.test(segment))
        ? ":id"
        : segment
    ))
    .map((segment, index, segments) => (
      segments[index - 1] === "documents" && segment && !DOCUMENT_COLLECTION_ROUTES.has(segment)
        ? ":id"
        : segment
    ))
    .join("/");
  const operation = isServiceRecord ? getServiceRecordOperation(path) : undefined;
  const capturedError = Object.assign(
    new Error(`${isServiceRecord ? "Service-record API" : "API"} request failed: ${method} ${sanitizedPath} (${statusLabel})`),
    { name: isServiceRecord ? "ServiceRecordApiRequestError" : "ApiRequestError" },
  );
  if (error.stack) {
    capturedError.stack = [
      capturedError.toString(),
      ...sanitizeSentryText(error.stack).split("\n").slice(1),
    ].join("\n");
  }

  Sentry.withScope((scope) => {
    scope.setLevel(status && status >= 500 ? "error" : "warning");
    scope.setTag(SERVICE_RECORD_SENTRY_TAG, isServiceRecord ? SERVICE_RECORD_SENTRY_FEATURE : "api");
    scope.setTag("app", "frontend");
    scope.setTag("runtime", typeof window === "undefined" ? "server" : "browser");
    if (operation) scope.setTag("operation", operation);
    scope.setTag("handled", "true");
    scope.setTag("status_code", statusLabel);
    scope.setContext("api", {
      method,
      path: pathTemplate,
      ...(operation ? { operation } : {}),
      status: status ?? null,
      code: error.code ?? null,
      runtime: typeof window === "undefined" ? "server" : "browser",
    });
    scope.setFingerprint(["api-error", method, pathTemplate, statusLabel]);
    Sentry.captureException(capturedError);
  });
  return true;
}

export async function captureAndFlushApiError(error: unknown): Promise<void> {
  if (captureApiError(error)) {
    try {
      await Sentry.flush(2_000);
    } catch {
      // Observability must never replace the original proxy failure.
    }
  }
}

export function captureServiceRecordRenderError(error: Error): void {
  if (reportedErrors.has(error)) return;
  reportedErrors.add(error);

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag(SERVICE_RECORD_SENTRY_TAG, SERVICE_RECORD_SENTRY_FEATURE);
    scope.setTag("app", "frontend");
    scope.setTag("runtime", "browser");
    scope.setTag("operation", "render");
    scope.setTag("handled", "true");
    scope.setContext("serviceRecord", {
      operation: "render",
      runtime: "browser",
    });
    Sentry.captureException(error);
  });
}
