"use client";

import { Button } from "@/components/ui/button";
import { FormHelperText } from "@/components/app/ui/form-section";
import type { BusinessDayCalendarError } from "@/hooks/useBusinessDayCalendar";

const SOURCE_COMPONENT = "CalendarLoadNotice";
const DEFAULT_DATA_COMPONENT = "desktop_holidays_calendar-load-notice";

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
  if (error === "no-branch") {
    return (
      <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} role="status">
        <FormHelperText tone="error" data-component={`${dataComponent}_message`}>
          지점을 선택한 뒤 다시 시도해 주세요.
        </FormHelperText>
      </div>
    );
  }

  if (error === "unsupported-year") {
    return (
      <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} role="status">
        <FormHelperText tone="error" data-component={`${dataComponent}_message`}>
          {UNSUPPORTED_YEAR_NOTICE_TEXT}
        </FormHelperText>
      </div>
    );
  }

  if (error === "load-failed") {
    return (
      <div
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        role="alert"
        className="flex flex-wrap items-center gap-2"
      >
        <FormHelperText tone="error" data-component={`${dataComponent}_message`}>
          공휴일 정보를 불러오지 못했어요.
        </FormHelperText>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-component={`${dataComponent}_retry`}
          onClick={onRetry}
        >
          다시 시도
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} role="status">
        <FormHelperText data-component={`${dataComponent}_message`}>
          공휴일 정보를 불러오는 중이에요…
        </FormHelperText>
      </div>
    );
  }

  return null;
}
