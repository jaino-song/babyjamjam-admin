"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

const SETTINGS_LIST_CARD_SOURCE_COMPONENT = "SettingsListCard";
const SETTINGS_LIST_ITEM_SOURCE_COMPONENT = "SettingsListItem";
const SETTINGS_LIST_SKELETON_SOURCE_COMPONENT = "SettingsRowsSkeleton";

const SETTINGS_ROW_GEOMETRY_CLASS =
  "flex min-h-[calc(66px*var(--glint-ui-scale,1))] w-full items-center gap-[calc(11px*var(--glint-ui-scale,1))] rounded-[calc(15px*var(--glint-ui-scale,1))] border-[calc(1px*var(--glint-ui-scale,1))] px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(9px*var(--glint-ui-scale,1))]";

export interface SettingsListCardProps {
  "data-component": string;
  title: string;
  count: number;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}

export function SettingsListCard({
  "data-component": dataComponent,
  title,
  count,
  subtitle,
  actionLabel,
  onAction,
  children,
}: SettingsListCardProps): ReactElement {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <section
      data-component={dataComponent}
      data-source-component={SETTINGS_LIST_CARD_SOURCE_COMPONENT}
      className="flex h-full min-h-0 flex-1 flex-col gap-[calc(18px*var(--glint-ui-scale,1))]"
    >
      <header
        data-component={sub("header")}
        className="flex shrink-0 items-start justify-between gap-[calc(12px*var(--glint-ui-scale,1))]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-[calc(6px*var(--glint-ui-scale,1))]">
          <span
            data-component={sub("header_title-row")}
            className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
          >
            <h2
              data-component={sub("header_title-row_title")}
              className="text-[calc(1.05rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.4rem*var(--glint-ui-scale,1))] text-v3-dark"
            >
              {title}
            </h2>
            <span
              data-component={sub("header_title-row_count")}
              className="inline-flex items-center rounded-[calc(999px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(8px*var(--glint-ui-scale,1))] py-[calc(3px*var(--glint-ui-scale,1))] text-[calc(0.66rem*var(--glint-ui-scale,1))] font-bold leading-none text-v3-primary"
            >
              {count}개
            </span>
          </span>
          <span
            data-component={sub("header_subtitle")}
            className="text-[calc(0.72rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            {subtitle}
          </span>
        </span>
        {actionLabel && onAction ? (
          <button
            data-component={sub("header_action")}
            type="button"
            className="min-h-[calc(36px*var(--glint-ui-scale,1))] shrink-0 cursor-pointer rounded-[calc(10px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(10px*var(--glint-ui-scale,1))] text-[calc(0.68rem*var(--glint-ui-scale,1))] font-bold text-v3-primary outline-none transition-colors active:bg-v3-primary/15 focus-visible:ring-[calc(3px*var(--glint-ui-scale,1))] focus-visible:ring-v3-primary/10"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </header>

      <div
        data-component={sub("items")}
        className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-[calc(6px*var(--glint-ui-scale,1))] overflow-y-auto overscroll-contain"
      >
        {children}
      </div>
    </section>
  );
}

export interface SettingsListItemProps {
  "data-component": string;
  icon: LucideIcon;
  title: string;
  subtitle: ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  isDisabled?: boolean;
  control?: ReactNode;
  showChevron?: boolean;
  dataAttributes?: Record<`data-${string}`, string>;
}

export function SettingsListItem({
  "data-component": dataComponent,
  icon: Icon,
  title,
  subtitle,
  isSelected = false,
  onSelect,
  isDisabled = false,
  control,
  showChevron = true,
  dataAttributes,
}: SettingsListItemProps): ReactElement {
  const rowContent = (
    <>
      <span
        data-component={`${dataComponent}_icon`}
        className="flex h-[calc(42px*var(--glint-ui-scale,1))] w-[calc(42px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(13px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary"
        aria-hidden="true"
      >
        <Icon
          className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))]"
          strokeWidth={2.25}
        />
      </span>
      <span
        data-component={`${dataComponent}_copy`}
        className="flex min-w-0 flex-1 flex-col gap-[calc(3px*var(--glint-ui-scale,1))]"
      >
        <span
          data-component={`${dataComponent}_copy_title`}
          className="truncate text-[calc(0.82rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.1rem*var(--glint-ui-scale,1))] text-v3-dark"
        >
          {title}
        </span>
        <span
          data-component={`${dataComponent}_copy_subtitle`}
          className="truncate text-[calc(0.68rem*var(--glint-ui-scale,1))] leading-[calc(0.95rem*var(--glint-ui-scale,1))] text-v3-text-muted"
        >
          {subtitle}
        </span>
      </span>
      <span
        data-component={`${dataComponent}_trailing`}
        className="flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
      >
        {control ? (
          <span
            className="h-[calc(23.4px*var(--glint-ui-scale,1))] w-[calc(41.4px*var(--glint-ui-scale,1))]"
            aria-hidden="true"
          />
        ) : null}
        {showChevron ? (
          <ChevronRight
            data-component={`${dataComponent}_trailing_chevron`}
            className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] text-v3-text-muted"
            strokeWidth={2.25}
            aria-hidden="true"
          />
        ) : null}
      </span>
    </>
  );
  const rowClassName = cn(
    SETTINGS_ROW_GEOMETRY_CLASS,
    "text-left outline-none transition-colors focus-visible:border-v3-primary/45 focus-visible:ring-[calc(3px*var(--glint-ui-scale,1))] focus-visible:ring-v3-primary/10 disabled:cursor-default disabled:opacity-100",
    onSelect && !isDisabled && "cursor-pointer active:bg-v3-primary-light/65",
    isSelected
      ? "border-v3-primary/20 bg-v3-primary-light/45"
      : "border-transparent bg-transparent",
    onSelect && !isSelected && !isDisabled && "hover:bg-v3-primary-light/30",
  );

  return (
    <div
      data-component={dataComponent}
      data-source-component={SETTINGS_LIST_ITEM_SOURCE_COMPONENT}
      className="relative"
      {...dataAttributes}
    >
      {onSelect ? (
        <button
          data-component={`${dataComponent}_button`}
          type="button"
          aria-label={`${title} 설정`}
          aria-current={isSelected ? "true" : undefined}
          disabled={isDisabled}
          className={rowClassName}
          onClick={onSelect}
        >
          {rowContent}
        </button>
      ) : (
        <div data-component={`${dataComponent}_content`} className={rowClassName}>
          {rowContent}
        </div>
      )}
      {control ? (
        <span
          data-component={`${dataComponent}_trailing_control`}
          className="absolute right-[calc(34px*var(--glint-ui-scale,1))] top-1/2 -translate-y-1/2"
        >
          {control}
        </span>
      ) : null}
    </div>
  );
}

export function SettingsListRowsSkeleton({
  "data-component": dataComponent,
  rowCount = 4,
}: {
  "data-component": string;
  rowCount?: number;
}): ReactElement {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, index) => (
        <div key={`${dataComponent}-${index}`} className="relative" aria-hidden="true">
          <div
            data-component={`${dataComponent}_row`}
            data-source-component={SETTINGS_LIST_SKELETON_SOURCE_COMPONENT}
            className={cn(SETTINGS_ROW_GEOMETRY_CLASS, "border-transparent")}
          >
            <span className="skeleton-base h-[calc(42px*var(--glint-ui-scale,1))] w-[calc(42px*var(--glint-ui-scale,1))] shrink-0 rounded-[calc(13px*var(--glint-ui-scale,1))]" />
            <span className="flex min-w-0 flex-1 flex-col gap-[calc(3px*var(--glint-ui-scale,1))]">
              <span className="skeleton-base h-[calc(1.1rem*var(--glint-ui-scale,1))] w-[calc(118px*var(--glint-ui-scale,1))] rounded-[calc(4px*var(--glint-ui-scale,1))]" />
              <span className="skeleton-base h-[calc(0.95rem*var(--glint-ui-scale,1))] w-[calc(150px*var(--glint-ui-scale,1))] rounded-[calc(4px*var(--glint-ui-scale,1))]" />
            </span>
            <span className="flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
              <span className="skeleton-base h-[calc(23.4px*var(--glint-ui-scale,1))] w-[calc(41.4px*var(--glint-ui-scale,1))] rounded-full" />
              <span className="skeleton-base h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] rounded-[calc(4px*var(--glint-ui-scale,1))]" />
            </span>
          </div>
        </div>
      ))}
    </>
  );
}
