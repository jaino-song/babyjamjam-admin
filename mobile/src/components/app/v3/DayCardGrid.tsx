import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const GRID_SOURCE_COMPONENT = "DayCardGrid";
const CARD_SOURCE_COMPONENT = "DayCard";

export interface DayCardGridProps {
  "data-component": string;
  children: ReactNode;
  /** Layout-only (never visual). */
  className?: string;
}

/** Session cards: 3 columns on a 360-390px phone, more on wide screens. */
export function DayCardGrid({ "data-component": dataComponent, children, className }: DayCardGridProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={GRID_SOURCE_COMPONENT}
      className={cn("grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2", className)}
    >
      {children}
    </div>
  );
}

export type DayCardState = "todo" | "done" | "readonly" | "changed" | "current" | "locked";

export interface DayCardProps {
  "data-component": string;
  /** Small muted date line. */
  dateLabel: ReactNode;
  /** Large session title (the bare session number today). */
  title: ReactNode;
  statusLabel: ReactNode;
  state: DayCardState;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Overrides the button's accessible name, which otherwise is its text (and so
   * already contains the date). An override must still include the date text.
   */
  accessibleName?: string;
}

const CARD_STATE_CLASS: Record<DayCardState, string> = {
  todo: "border-v3-border bg-white",
  done: "border-v3-primary-medium bg-v3-primary-light",
  readonly: "border-v3-primary-medium bg-white",
  changed: "border-v3-primary bg-v3-primary-light ring-[3px] ring-v3-primary-light",
  current: "border-v3-primary bg-white ring-[3px] ring-v3-primary-light",
  locked: "border-v3-border bg-white opacity-50",
};

const STATUS_EMPHASIS: Record<DayCardState, boolean> = {
  todo: false,
  done: true,
  readonly: true,
  changed: true,
  current: false,
  locked: false,
};

/**
 * One session card. `locked` is only a look (dimmed); whether it can be pressed
 * is the screen's call through `disabled`.
 */
export function DayCard({
  "data-component": dataComponent,
  dateLabel,
  title,
  statusLabel,
  state,
  onClick,
  disabled = false,
  accessibleName,
}: DayCardProps) {
  return (
    <button
      type="button"
      data-component={dataComponent}
      data-source-component={CARD_SOURCE_COMPONENT}
      data-state={state}
      aria-label={accessibleName}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-center rounded-xl border-[1.5px] px-1 py-2.5 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed",
        CARD_STATE_CLASS[state],
      )}
    >
      <span data-component={`${dataComponent}_date`} className="text-[11.5px] text-v3-text-muted">
        {dateLabel}
      </span>
      <span data-component={`${dataComponent}_title`} className="text-lg font-extrabold leading-tight text-v3-dark">
        {title}
      </span>
      <span
        data-component={`${dataComponent}_status`}
        className={cn(
          "mt-[3px] text-[10.5px]",
          STATUS_EMPHASIS[state] ? "font-bold text-v3-primary" : "text-v3-text-muted",
        )}
      >
        {statusLabel}
      </span>
    </button>
  );
}
