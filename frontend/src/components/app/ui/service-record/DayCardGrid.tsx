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

/** Session cards fill the available width with a scaled 88px minimum. */
export function DayCardGrid({ "data-component": dataComponent, children, className }: DayCardGridProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={GRID_SOURCE_COMPONENT}
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(calc(88px*var(--glint-ui-scale,1)),1fr))] gap-[calc(8px*var(--glint-ui-scale,1))]",
        className,
      )}
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
  statusTone?: "warning" | "success";
  state: DayCardState;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Overrides the button's accessible name, which otherwise is its text (and so
   * already contains the date). An override must still include the date text.
   */
  accessibleName?: string;
  /** A stable hook for a screen's own tests and specs; no styling hangs on it. */
  "data-slot"?: string;
}

// Border colours carry `!` because globals.css has an unlayered
// `* { border-color }` reset that would otherwise beat layered utilities.
const CARD_STATE_CLASS: Record<DayCardState, string> = {
  todo: "border-v3-border! bg-white",
  done: "border-v3-primary-medium! bg-v3-primary-light",
  readonly: "border-v3-primary! bg-white ring-[3px] ring-v3-primary-light",
  changed: "border-v3-primary-medium! bg-v3-primary-light",
  current: "border-v3-primary! bg-white ring-[3px] ring-v3-primary-light",
  locked: "border-v3-border! bg-white opacity-50",
};

const STATUS_EMPHASIS: Record<DayCardState, boolean> = {
  todo: false,
  done: true,
  readonly: false,
  changed: true,
  current: false,
  locked: false,
};

/**
 * One session card. `locked` is only a look (dimmed); whether it can be
 * pressed is the screen's call through `disabled`.
 */
export function DayCard({
  "data-component": dataComponent,
  dateLabel,
  title,
  statusLabel,
  statusTone,
  state,
  onClick,
  disabled = false,
  accessibleName,
  "data-slot": dataSlot,
}: DayCardProps) {
  return (
    <button
      type="button"
      data-component={dataComponent}
      data-source-component={CARD_SOURCE_COMPONENT}
      data-slot={dataSlot}
      data-state={state}
      aria-label={accessibleName}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-center rounded-[calc(12px*var(--glint-ui-scale,1))] border-[calc(1.5px*var(--glint-ui-scale,1))] px-[calc(4px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed",
        CARD_STATE_CLASS[state],
      )}
    >
      <span
        data-component={`${dataComponent}_date`}
        className="min-h-[calc(20px*var(--glint-ui-scale,1))] text-[calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] text-v3-text-muted"
      >
        {dateLabel}
      </span>
      <span
        data-component={`${dataComponent}_title`}
        className="text-[calc(20px*var(--glint-ui-scale,1))] font-extrabold leading-tight text-v3-dark"
      >
        {title}
      </span>
      <span
        data-component={`${dataComponent}_status`}
        className={cn(
          "mt-[calc(3px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] leading-[calc(16px*var(--glint-ui-scale,1))]",
          statusTone === "warning" ? "font-bold text-status-warning-fg"
            : statusTone === "success" ? "font-bold text-status-success-fg"
              : STATUS_EMPHASIS[state] ? "font-bold text-v3-primary" : "text-v3-text-muted",
        )}
      >
        {statusLabel}
      </span>
    </button>
  );
}
