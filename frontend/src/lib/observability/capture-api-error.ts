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

function getRequestPath(url: string | undefined): string {
  if (!url) return "unknown";

  try {
    return new URL(url, "https://api.local").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] || "unknown";
  }
}

function isAxiosErrorLike(error: unknown): error is AxiosError {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    error.isAxiosError === true
  );
}

export function captureApiError(error: unknown): void {
  if (!isAxiosErrorLike(error) || error.code === "ERR_CANCELED") return;

  const status = error.response?.status;
  if (typeof status === "number" && status < 500) return;
  const method = (error.config?.method ?? "unknown").toUpperCase();
  const path = getRequestPath(error.config?.url);
  if (!isServiceRecordSentrySignal(path)) return;
  if (reportedErrors.has(error)) return;

  reportedErrors.add(error);

  const sanitizedPath = sanitizeSentryUrl(path) ?? "unknown";
  const statusLabel = status ? String(status) : "network";
  const capturedError = Object.assign(
    new Error(`Service-record API request failed: ${method} ${sanitizedPath} (${statusLabel})`),
    { name: "ServiceRecordApiRequestError" },
  );
  if (error.stack) {
    capturedError.stack = [
      capturedError.toString(),
      ...sanitizeSentryText(error.stack).split("\n").slice(1),
    ].join("\n");
  }

  Sentry.withScope((scope) => {
    scope.setLevel(status && status >= 500 ? "error" : "warning");
    scope.setTag(SERVICE_RECORD_SENTRY_TAG, SERVICE_RECORD_SENTRY_FEATURE);
    scope.setTag("error.kind", "api");
    scope.setTag("api.method", method);
    scope.setTag("api.status", statusLabel);
    scope.setContext("api", {
      method,
      path: sanitizedPath,
      status: status ?? null,
      code: error.code ?? null,
      runtime: typeof window === "undefined" ? "server" : "browser",
    });
    scope.setFingerprint(["api-error", method, sanitizedPath, statusLabel]);
    Sentry.captureException(capturedError);
  });
}
