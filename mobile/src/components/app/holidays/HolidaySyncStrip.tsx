"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { HolidaySyncYearResult } from "@/services/holiday-settings";

import { describeSyncResult, formatLastSynced } from "./holiday-format";

const SOURCE_COMPONENT = "HolidaySyncStrip";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings_sync-strip";

interface HolidaySyncStripProps {
  synced: boolean;
  /** True while the sync state itself is not known (the year has not loaded): the status line shows "—". */
  statusUnknown?: boolean;
  lastSyncedAt: string | null;
  pending: boolean;
  disabled?: boolean;
  results: readonly HolidaySyncYearResult[] | null;
  /** Inline message for a failed sync request (e.g. the 429 copy). */
  errorMessage: string | null;
  onSync: () => void;
  dataComponent?: string;
}

export function HolidaySyncStrip({
  synced,
  statusUnknown = false,
  lastSyncedAt,
  pending,
  disabled = false,
  results,
  errorMessage,
  onSync,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: HolidaySyncStripProps) {
  const lastSyncedLabel = synced && lastSyncedAt ? formatLastSynced(lastSyncedAt) : "";

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className="grid gap-3 rounded-2xl border border-[#818b98] bg-transparent px-4 py-3.5"
    >
      <div data-component={`${dataComponent}_info`} className="grid min-w-0 justify-items-center gap-1 text-center">
        <p data-slot="holiday-sync-title" className="text-sm font-semibold text-v3-dark">대한민국 공휴일</p>
        <p data-slot="holiday-sync-status" className="text-xs text-v3-text-muted">
          {statusUnknown
            ? "—"
            : synced
              ? `마지막 동기화 ${lastSyncedLabel}`.trim()
              : "아직 동기화되지 않았어요 (기본 공휴일 목록 사용 중)"}
        </p>
        {results && results.length > 0 ? (
          <ul
            role="status"
            data-component={`${dataComponent}_results`}
            data-slot="holiday-sync-results"
            className="mt-1 grid gap-0.5 text-xs text-v3-text"
          >
            {results.map((result) => (
              <li
                key={result.year}
                className={result.status === "failed" ? "font-semibold text-v3-burgundy" : undefined}
              >
                {describeSyncResult(result)}
              </li>
            ))}
          </ul>
        ) : null}
        {errorMessage ? (
          <p
            role="alert"
            data-component={`${dataComponent}_error`}
            className="mt-1 text-xs font-semibold text-v3-burgundy"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        className="w-full"
        data-component={`${dataComponent}_sync-trigger`}
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        onClick={onSync}
      >
        {pending ? (
          <>
            <Spinner size="sm" aria-hidden="true" data-component={`${dataComponent}_sync-trigger_spinner`} />
            <span className="sr-only">동기화 중</span>
          </>
        ) : "지금 동기화"}
      </Button>
    </div>
  );
}
