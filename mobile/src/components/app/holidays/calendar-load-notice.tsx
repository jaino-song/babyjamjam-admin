"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { BusinessDayCalendarError } from "@/hooks/useBusinessDayCalendar";

import styles from "./calendar-load-notice.module.css";

const SOURCE_COMPONENT = "CalendarLoadNotice";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_calendar-load-notice";

/**
 * `useBusinessDayCalendar` errors plus "unsupported-year": the calendar loaded fine but the
 * period reaches a year it has no data for, so the end date could not be calculated.
 */
export type CalendarNoticeError = BusinessDayCalendarError | "unsupported-year";

export const UNSUPPORTED_YEAR_NOTICE_TEXT = "이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.";

export interface CalendarLoadNoticeProps {
  /** `error` from useBusinessDayCalendar, or "unsupported-year" (no retry button). */
  error: CalendarNoticeError;
  /** `retry` from useBusinessDayCalendar; the button only shows for "load-failed". */
  onRetry?: () => void;
  /** Show the muted "loading" line while the calendar is still loading (and there is no error). */
  loading?: boolean;
  /** Opt in to a spinner; existing callers keep the loading text. */
  indicator?: "text" | "spinner";
  /** Save-time revision notice in the existing inline message slot. */
  message?: string | null;
  /** Override when the notice sits inside a differently named parent, per the data-component caller-context rule. */
  dataComponent?: string;
}

/**
 * Inline notice for date fields that depend on the branch holiday calendar.
 * Renders nothing when there is nothing to say, so a consumer can mount it
 * unconditionally next to its date inputs.
 */
export function CalendarLoadNotice({
  error,
  onRetry,
  loading = false,
  indicator = "text",
  message = null,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: CalendarLoadNoticeProps) {
  if (error === null && !loading && !message) return null;

  const failed = error === "load-failed";
  const text =
    error === "no-branch"
      ? "지점을 선택한 뒤 다시 시도해 주세요."
      : error === "unsupported-year"
        ? UNSUPPORTED_YEAR_NOTICE_TEXT
        : failed
          ? "공휴일 정보를 불러오지 못했어요."
          : message ?? "공휴일 정보를 불러오는 중이에요…";

  return (
    <div
      className={styles.notice}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      role={failed ? "alert" : "status"}
    >
      <p
        className={cn(styles.message, error === null ? styles.helper_muted : styles.helper_err)}
        data-component={`${dataComponent}_message`}
        data-slot="message"
      >
        {indicator === "spinner" && loading && error === null && !message ? (
          <>
            <Spinner data-component={`${dataComponent}_message_loading`} aria-hidden="true" />
            <span className="sr-only">공휴일 정보를 불러오는 중이에요…</span>
          </>
        ) : text}
      </p>
      {failed ? (
        <Button
          type="button"
          variant="v3-outline"
          size="sm"
          data-component={`${dataComponent}_retry`}
          onClick={onRetry}
        >
          다시 시도
        </Button>
      ) : null}
    </div>
  );
}
