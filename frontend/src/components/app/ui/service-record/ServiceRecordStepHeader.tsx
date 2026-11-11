import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ServiceRecordStepHeader";

export interface ServiceRecordStepHeaderProps {
  "data-component": string;
  /** Rendered as the screen's `<h1>`. */
  title: ReactNode;
  /** Left of the row under the title (the provider name today). */
  meta?: ReactNode;
  /** Right of the row under the title, e.g. `<><b>3회차</b> · 산모 (1/4)</>`. */
  crumbs?: ReactNode;
  /** 0..1; values outside the range are clamped. */
  progress: number;
  /** Unknown progress slides the fill and omits the percentage. */
  indeterminate?: boolean;
  /** Accessible name of the progress bar. */
  progressLabel?: string;
  /** Layout-only (never visual). */
  className?: string;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Blue step header with the title row, a meta/crumbs row and a progress bar. */
export function ServiceRecordStepHeader({
  "data-component": dataComponent,
  title,
  meta,
  crumbs,
  progress,
  indeterminate = false,
  progressLabel = "진행률",
  className,
}: ServiceRecordStepHeaderProps) {
  const percent = Math.round(clampProgress(progress) * 100);

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn(
        "bg-v3-primary px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(12px*var(--glint-ui-scale,1))] pt-[calc(14px*var(--glint-ui-scale,1))] text-white",
        className,
      )}
    >
      <h1
        data-component={`${dataComponent}_title`}
        className="m-0 text-[calc(18px*var(--glint-ui-scale,1))] leading-[calc(28px*var(--glint-ui-scale,1))] font-bold tracking-tight"
      >
        {title}
      </h1>
      {meta || crumbs ? (
        <div
          data-component={`${dataComponent}_meta-row`}
          className="mt-0.5 flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] text-[calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))]"
        >
          <div data-component={`${dataComponent}_meta-row_meta`} className="min-w-0 opacity-90">
            {meta}
          </div>
          <div
            data-component={`${dataComponent}_meta-row_crumbs`}
            className="ml-auto flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] text-white/80 [&_b]:text-white"
          >
            {crumbs}
          </div>
        </div>
      ) : null}
      <div
        data-component={`${dataComponent}_progress`}
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-busy={indeterminate || undefined}
        className="mt-[calc(10px*var(--glint-ui-scale,1))] h-[calc(5px*var(--glint-ui-scale,1))] overflow-hidden rounded-full bg-white/30"
      >
        <div
          data-component={`${dataComponent}_progress_fill`}
          data-indeterminate={indeterminate || undefined}
          className={cn(
            "h-full rounded-full bg-white",
            indeterminate
              ? "w-2/5 animate-indeterminate-bar motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60"
              : "transition-[width] duration-300",
          )}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
