"use client";

import { Button } from "@/components/ui/button";
import type { InactiveHolidayOverride } from "@/services/holidays";

import { formatHolidayDate } from "./holiday-format";

const SOURCE_COMPONENT = "HolidayInactiveOverrides";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings_inactive-overrides";

interface HolidayInactiveOverridesProps {
  overrides: readonly InactiveHolidayOverride[];
  disabled?: boolean;
  onDelete: (override: InactiveHolidayOverride) => void;
  dataComponent?: string;
}

/** Branch settings the public data has since made moot ("공공데이터가 바뀌어 효과가 없는 설정"). */
export function HolidayInactiveOverrides({
  overrides,
  disabled = false,
  onDelete,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: HolidayInactiveOverridesProps) {
  if (overrides.length === 0) return null;

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className="grid gap-2 rounded-2xl border border-v3-border px-4 py-3.5"
    >
      <div data-component={`${dataComponent}_header`}>
        <h3 className="text-sm font-bold text-v3-dark">적용되지 않는 지점 설정</h3>
        <p className="text-xs text-v3-text-muted">
          공공데이터가 바뀌어 지금은 효과가 없는 설정이에요.
        </p>
      </div>
      <ul data-component={`${dataComponent}_list`} className="grid gap-2">
        {overrides.map((override) => {
          const kindLabel = override.kind === "add" ? "지점 추가" : "지점 제외";
          return (
            <li
              key={override.id}
              data-component={`${dataComponent}_item`}
              className="flex items-start justify-between gap-3 text-sm text-v3-text"
            >
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold text-v3-dark">{formatHolidayDate(override.date)}</span>
                {override.name ? ` ${override.name}` : ""}
                <span className="ml-2 text-xs text-v3-text-muted">{kindLabel}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-v3-burgundy/40 text-v3-burgundy"
                disabled={disabled}
                data-component={`${dataComponent}_item_delete-trigger`}
                onClick={() => onDelete(override)}
              >
                삭제
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
