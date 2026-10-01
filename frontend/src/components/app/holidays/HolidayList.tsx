"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BranchHoliday } from "@/services/holidays";

import { formatHolidayDate, isWeekend, weekdayIndex } from "./holiday-format";

const SOURCE_COMPONENT = "HolidayList";
const DEFAULT_DATA_COMPONENT = "desktop_settings_sections_holidays_list";

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

function SourceChip({ holiday }: { holiday: BranchHoliday }) {
  if (holiday.excluded) return <Badge variant="v3-expired">지점 제외</Badge>;
  if (holiday.source === "branch_add") return <Badge variant="success">지점 추가</Badge>;
  return <Badge variant="info">공공데이터</Badge>;
}

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
    <Table data-component={dataComponent} data-source-component={SOURCE_COMPONENT}>
      <TableHeader>
        <TableRow>
          <TableHead>날짜</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>출처</TableHead>
          <TableHead className="text-right">관리</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((holiday) => {
          const past = holiday.date < today;
          const day = weekdayIndex(holiday.date);
          return (
            <TableRow
              key={`${holiday.date}-${holiday.source}`}
              data-component={`${dataComponent}_row`}
              data-slot="holiday-row"
              data-past={past || undefined}
              className={cn((past || holiday.excluded) && "text-v3-text-muted")}
            >
              <TableCell
                className={cn(
                  "whitespace-nowrap font-semibold",
                  day === 6 && "text-v3-primary",
                  day === 0 && "text-v3-burgundy",
                )}
              >
                {formatHolidayDate(holiday.date)}
              </TableCell>
              <TableCell className={cn(holiday.excluded && "line-through")}>{holiday.name}</TableCell>
              <TableCell>
                <SourceChip holiday={holiday} />
              </TableCell>
              <TableCell className="text-right">
                {past ? (
                  <Badge variant="secondary" data-slot="holiday-past-chip">
                    지난 날짜
                  </Badge>
                ) : holiday.source === "branch_add" && holiday.overrideId ? (
                  <Button
                    type="button"
                    variant="negative-outline"
                    size="sm"
                    disabled={disabled}
                    data-component={`${dataComponent}_row_delete-trigger`}
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
                    data-component={`${dataComponent}_row_restore-trigger`}
                    onClick={() => onRestore(holiday)}
                  >
                    다시 포함
                  </Button>
                ) : !holiday.excluded && holiday.source !== "branch_add" && !isWeekend(holiday.date) ? (
                  <Button
                    type="button"
                    variant="negative-outline"
                    size="sm"
                    disabled={disabled}
                    data-component={`${dataComponent}_row_exclude-trigger`}
                    onClick={() => onExclude(holiday)}
                  >
                    제외
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
