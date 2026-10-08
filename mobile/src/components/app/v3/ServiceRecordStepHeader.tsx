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
  progressLabel = "진행률",
  className,
}: ServiceRecordStepHeaderProps) {
  const percent = Math.round(clampProgress(progress) * 100);

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn("bg-v3-primary px-4 pb-3 pt-3.5 text-white", className)}
    >
      <h1
        data-component={`${dataComponent}_title`}
        className="m-0 text-[15px] font-bold tracking-tight"
      >
        {title}
      </h1>
      {meta || crumbs ? (
        <div
          data-component={`${dataComponent}_meta-row`}
          className="mt-0.5 flex items-center justify-between gap-3 text-[11.5px]"
        >
          <div data-component={`${dataComponent}_meta`} className="min-w-0 opacity-90">
            {meta}
          </div>
          <div
            data-component={`${dataComponent}_crumbs`}
            className="ml-auto flex items-center gap-1.5 text-white/80 [&_b]:text-white"
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
        aria-valuenow={percent}
        className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-white/30"
      >
        <div
          data-component={`${dataComponent}_progress_fill`}
          className="h-full rounded-full bg-white transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
