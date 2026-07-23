import * as Sentry from "@sentry/nextjs";
import type { AxiosError } from "axios";

import {
  isServiceRecordSentrySignal,
  sanitizeSentryText,
  sanitizeSentryUrl,
  SERVICE_RECORD_SENTRY_FEATURE,
  SERVICE_RECORD_SENTRY_TAG,
} from "./sentry-config";

interface ServiceRecordErrorContext {
  operation: string;
  method?: string;
  path?: string;
  status?: number;
  code?: string;
}

const reportedErrors = new WeakSet<object>();

function isAxiosErrorLike(error: unknown): error is AxiosError {
  return (
    typeof error === "object"
    && error !== null
    && "isAxiosError" in error
    && error.isAxiosError === true
  );
}

function getRequestPath(url: string | undefined): string {
  if (!url) return "unknown";

  try {
    return new URL(url, "https://api.local").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] || "unknown";
  }
}

export function captureServiceRecordError(
  error: unknown,
  context?: ServiceRecordErrorContext,
): void {
  if (typeof error === "object" && error !== null && reportedErrors.has(error)) return;

  const axiosError = isAxiosErrorLike(error) ? error : null;
  if (axiosError?.code === "ERR_CANCELED") return;

  const status = context?.status ?? axiosError?.response?.status;
  if (typeof status === "number" && status < 500) return;

  const method = (
    context?.method
    ?? axiosError?.config?.method
    ?? "unknown"
  ).toUpperCase();
  const rawPath = context?.path ?? getRequestPath(axiosError?.config?.url);
  if (!context && !isServiceRecordSentrySignal(rawPath)) return;

  if (typeof error === "object" && error !== null) {
    reportedErrors.add(error);
  }

  const path = sanitizeSentryUrl(rawPath) ?? "unknown";
  const statusLabel = status ? String(status) : "network";
  const operation = context?.operation ?? "api";
  const capturedError = Object.assign(
    new Error(`Service-record ${operation} failed: ${method} ${path} (${statusLabel})`),
    { name: "ServiceRecordError" },
  );
  if (error instanceof Error && error.stack) {
    capturedError.stack = [
      capturedError.toString(),
      ...sanitizeSentryText(error.stack).split("\n").slice(1),
    ].join("\n");
  }

  Sentry.withScope((scope) => {
    scope.setLevel(status && status >= 500 ? "error" : "warning");
    scope.setTag(SERVICE_RECORD_SENTRY_TAG, SERVICE_RECORD_SENTRY_FEATURE);
    scope.setTag("error.kind", operation);
    scope.setTag("api.status", statusLabel);
    scope.setContext("serviceRecord", {
      operation,
      method,
      path,
      status: status ?? null,
      code: context?.code ?? axiosError?.code ?? null,
      runtime: typeof window === "undefined" ? "server" : "browser",
    });
    scope.setFingerprint(["service-record", operation, method, path, statusLabel]);
    Sentry.captureException(capturedError);
  });
}
