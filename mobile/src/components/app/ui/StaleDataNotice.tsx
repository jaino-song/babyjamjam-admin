"use client";

import { AlertTriangle } from "lucide-react";

const SOURCE_COMPONENT = "StaleDataNotice";

export interface StaleDataNoticeProps {
  /** Caller-context canonical data-component value for the root. */
  dataComponent: string;
  message: string;
}

/**
 * Quiet one-line notice shown above data that is still on screen after a background refresh failed.
 * No retry button, no background or border (operator decision 2026-11-11).
 */
export function StaleDataNotice({ dataComponent, message }: StaleDataNoticeProps) {
  return (
    <p
      role="status"
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-slot="stale-data-notice"
      className="flex items-center gap-1.5 py-1 text-[0.78rem] text-status-warning-fg"
    >
      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}
