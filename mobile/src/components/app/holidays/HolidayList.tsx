"use client";

import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BranchHoliday } from "@/services/holidays";

import { formatHolidayDate, isWeekend, weekdayIndex } from "./holiday-format";

const SOURCE_COMPONENT = "HolidayList";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings_list";
/** `negative-outline` has no mobile Button variant: the outline variant with the burgundy text tone. */
const NEGATIVE_OUTLINE_CLASS_NAME = "border-v3-burgundy/40 text-v3-burgundy";

interface HolidayListProps {
  holidays: readonly BranchHoliday[];
  /** Today in Korea (YYYY-MM-DD). Earlier dates are locked. */
  today: string;
  disabled?: boolean;
  onExclude: (holiday: BranchHoliday) => void;
  onRestore: (holiday: BranchHoliday) => void;
  onDelete: (holiday: BranchHoliday) => void;
  dataComponent?: string;
}

function SourceChip({ holiday, dataComponent }: { holiday: BranchHoliday; dataComponent: string }) {
  if (holiday.excluded) {
    return (
      <StatusBadge data-component={dataComponent} variant="danger">
        지점 제외
      </StatusBadge>
    );
  }
  if (holiday.source === "branch_add") {
    return (
      <StatusBadge data-component={dataComponent} variant="success">
        지점 추가
      </StatusBadge>
    );
  }
  return (
    <StatusBadge data-component={dataComponent} variant="info">
      공공데이터
    </StatusBadge>
  );
}

/** One card per holiday: date, name and source on the left, the single row action on the right. */
export function HolidayList({
  holidays,
  today,
  disabled = false,
  onExclude,
  onRestore,
  onDelete,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: HolidayListProps) {
  const rows = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ul data-component={dataComponent} data-source-component={SOURCE_COMPONENT} className="grid gap-2">
      {rows.map((holiday) => {
        const past = holiday.date < today;
        const day = weekdayIndex(holiday.date);
        const rowComponent = `${dataComponent}_row`;
        return (
          <li
            key={`${holiday.date}-${holiday.source}`}
            data-component={rowComponent}
            data-slot="holiday-row"
            data-past={past || undefined}
            className={cn(
              "flex items-start justify-between gap-3 rounded-2xl border border-v3-border px-3.5 py-3 text-sm",
              past || holiday.excluded ? "text-v3-text-muted" : "text-v3-text",
            )}
          >
            <div data-component={`${rowComponent}_info`} className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  data-slot="holiday-date"
                  className={cn(
                    "whitespace-nowrap font-semibold",
                    day === 6 && "text-v3-primary",
                    day === 0 && "text-v3-burgundy",
                  )}
                >
                  {formatHolidayDate(holiday.date)}
                </span>
                <SourceChip holiday={holiday} dataComponent={`${rowComponent}_source`} />
              </div>
              <p
                data-slot="holiday-name"
                className={cn("break-words text-sm leading-snug", holiday.excluded && "line-through")}
              >
                {holiday.name}
              </p>
            </div>
            <div data-component={`${rowComponent}_action`} className="shrink-0">
              {past ? (
                <StatusBadge
                  data-component={`${rowComponent}_action_past-chip`}
                  data-slot="holiday-past-chip"
                  variant="neutral"
                >
                  지난 날짜
                </StatusBadge>
              ) : holiday.source === "branch_add" && holiday.overrideId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={NEGATIVE_OUTLINE_CLASS_NAME}
                  disabled={disabled}
                  data-component={`${rowComponent}_delete-trigger`}
                  onClick={() => onDelete(holiday)}
                >
                  삭제
                </Button>
              ) : holiday.excluded && holiday.overrideId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  data-component={`${rowComponent}_restore-trigger`}
                  onClick={() => onRestore(holiday)}
                >
                  다시 포함
                </Button>
              ) : !holiday.excluded && holiday.source !== "branch_add" && !isWeekend(holiday.date) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={NEGATIVE_OUTLINE_CLASS_NAME}
                  disabled={disabled}
                  data-component={`${rowComponent}_exclude-trigger`}
                  onClick={() => onExclude(holiday)}
                >
                  제외
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
