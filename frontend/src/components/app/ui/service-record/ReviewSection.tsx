import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SECTION_SOURCE_COMPONENT = "ReviewSection";
const ROW_SOURCE_COMPONENT = "ReviewRow";
const ROW_GRID_SOURCE_COMPONENT = "ReviewRowGrid";

export interface ReviewSectionProps {
  "data-component": string;
  /** Id placed on the title tag; the `<section>` is named by it. */
  titleId: string;
  /** 산모 / 신생아 / 서비스 기록, shown as the coloured tag. */
  title: string;
  tone: "mom" | "baby" | "etc";
  onEdit?: () => void;
  /** Visible text of the edit button (its accessible name is `${title} 수정`). */
  editLabel?: string;
  children: ReactNode;
  /** Layout-only (never visual). */
  className?: string;
}

const TAG_TONE_CLASS: Record<ReviewSectionProps["tone"], string> = {
  mom: "bg-v3-burgundy-light text-v3-burgundy",
  baby: "bg-v3-primary-light text-v3-primary",
  etc: "bg-v3-dim-white text-v3-text-muted",
};

/** A review block: a coloured tag, an optional edit button and its rows. */
export function ReviewSection({
  "data-component": dataComponent,
  titleId,
  title,
  tone,
  onEdit,
  editLabel = "수정",
  children,
  className,
}: ReviewSectionProps) {
  return (
    <section
      aria-labelledby={titleId}
      data-component={dataComponent}
      data-source-component={SECTION_SOURCE_COMPONENT}
      className={cn("mt-[calc(14px*var(--glint-ui-scale,1))]", className)}
    >
      <div
        data-component={`${dataComponent}_header`}
        className="mb-[calc(6px*var(--glint-ui-scale,1))] flex items-center justify-between gap-[calc(8px*var(--glint-ui-scale,1))]"
      >
        <span
          id={titleId}
          data-component={`${dataComponent}_header_title`}
          className={cn(
            "inline-block rounded-[6px] px-[calc(7px*var(--glint-ui-scale,1))] py-[calc(2px*var(--glint-ui-scale,1))] text-[calc(10.5px*var(--glint-ui-scale,1))] font-extrabold",
            TAG_TONE_CLASS[tone],
          )}
        >
          {title}
        </span>
        {onEdit ? (
          <button
            type="button"
            data-component={`${dataComponent}_header_edit`}
            data-slot="sec-edit"
            aria-label={`${title} 수정`}
            onClick={onEdit}
            className="min-h-[calc(32px*var(--glint-ui-scale,1))] rounded-[6px] px-1 text-[calc(12px*var(--glint-ui-scale,1))] font-bold text-v3-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary"
          >
            {editLabel}
          </button>
        ) : null}
      </div>
      <div
        data-component={`${dataComponent}_rows`}
        className="flex flex-col gap-[calc(6px*var(--glint-ui-scale,1))]"
      >
        {children}
      </div>
    </section>
  );
}

export interface ReviewRowGridProps {
  "data-component": string;
  children: ReactNode;
  /** Layout-only (never visual). */
  className?: string;
}

/** Lays `ReviewRow`s out in 1 column below `sm` and 2 columns from `sm` up. */
export function ReviewRowGrid({ "data-component": dataComponent, children, className }: ReviewRowGridProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={ROW_GRID_SOURCE_COMPONENT}
      className={cn(
        "grid grid-cols-1 gap-x-[calc(12px*var(--glint-ui-scale,1))] gap-y-[calc(6px*var(--glint-ui-scale,1))] sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ReviewRowProps {
  "data-component": string;
  /** Id placed on the label element; the row's `group` is named by it. */
  labelId: string;
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "empty" | "ok";
  /** `inline` = label left / value right; `note` = label above value. */
  layout?: "inline" | "note";
  /** Layout-only (never visual). */
  className?: string;
}

const VALUE_TONE_CLASS: Record<NonNullable<ReviewRowProps["tone"]>, string> = {
  default: "text-v3-dark",
  empty: "text-v3-text-muted/70",
  ok: "text-v3-primary",
};

/** One boxed review line. */
export function ReviewRow({
  "data-component": dataComponent,
  labelId,
  label,
  value,
  tone = "default",
  layout = "inline",
  className,
}: ReviewRowProps) {
  const note = layout === "note";
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-component={dataComponent}
      data-source-component={ROW_SOURCE_COMPONENT}
      className={cn(
        "rounded-[10px] border border-v3-border! bg-v3-dim-white px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(7px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))]",
        note ? "block" : "flex justify-between gap-[calc(12px*var(--glint-ui-scale,1))]",
        className,
      )}
    >
      <span
        id={labelId}
        data-component={`${dataComponent}_label`}
        className={cn("text-v3-text-muted", note ? "mb-1 block" : "shrink-0")}
      >
        {label}
      </span>
      <span
        data-component={`${dataComponent}_value`}
        className={cn(
          VALUE_TONE_CLASS[tone],
          note ? "block font-semibold leading-normal" : "break-keep text-right font-bold",
          tone === "empty" && "font-semibold",
        )}
      >
        {value}
      </span>
    </div>
  );
}
