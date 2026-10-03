"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STATS_PERIOD_OPTIONS,
  type StatsPeriod,
} from "@/lib/observability/stats-period";

interface StatsPeriodSelectorProps {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
  dataComponent: string;
}

export function StatsPeriodSelector({
  period,
  onChange,
  dataComponent,
}: StatsPeriodSelectorProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component="StatsPeriodSelector"
      className="flex items-center justify-between gap-3 rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-dim-white px-3 py-2"
    >
      <span className="text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
        조회 기간
      </span>
      <Select
        value={String(period)}
        onValueChange={(value) => {
          const next = Number(value);
          if (next === 7 || next === 30) onChange(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="통계 조회 기간"
          data-component={`${dataComponent}_trigger`}
          className="min-w-[7.5rem]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-component={`${dataComponent}_content`}>
          {STATS_PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
