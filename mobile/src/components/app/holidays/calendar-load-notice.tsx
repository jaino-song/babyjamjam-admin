"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BusinessDayCalendarError } from "@/hooks/useBusinessDayCalendar";

import styles from "./calendar-load-notice.module.css";

const SOURCE_COMPONENT = "CalendarLoadNotice";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_calendar-load-notice";

export interface CalendarLoadNoticeProps {
  /** `error` from useBusinessDayCalendar. */
  error: BusinessDayCalendarError;
  /** `retry` from useBusinessDayCalendar; the button only shows for "load-failed". */
  onRetry?: () => void;
  /** Show the muted "loading" line while the calendar is still loading (and there is no error). */
  loading?: boolean;
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
  dataComponent = DEFAULT_DATA_COMPONENT,
}: CalendarLoadNoticeProps) {
  if (error === null && !loading) return null;

  const failed = error === "load-failed";
  const text =
    error === "no-branch"
      ? "지점을 선택한 뒤 다시 시도해 주세요."
      : failed
        ? "공휴일 정보를 불러오지 못했어요."
        : "공휴일 정보를 불러오는 중이에요…";

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
        {text}
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
