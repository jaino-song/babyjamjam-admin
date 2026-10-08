import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SECTION_SOURCE_COMPONENT = "ReviewSection";
const ROW_SOURCE_COMPONENT = "ReviewRow";

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
      className={cn("mt-3.5", className)}
    >
      <div
        data-component={`${dataComponent}_header`}
        className="mb-1.5 flex items-center justify-between gap-2"
      >
        <span
          id={titleId}
          data-component={`${dataComponent}_header_title`}
          className={cn("inline-block rounded-[6px] px-[7px] py-0.5 text-[10.5px] font-extrabold", TAG_TONE_CLASS[tone])}
        >
          {title}
        </span>
        {onEdit ? (
          <button
            type="button"
            data-component={`${dataComponent}_header_edit`}
            aria-label={`${title} 수정`}
            onClick={onEdit}
            className="min-h-8 rounded-[6px] px-1 text-[12.5px] font-bold text-v3-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary"
          >
            {editLabel}
          </button>
        ) : null}
      </div>
      <div data-component={`${dataComponent}_rows`} className="flex flex-col gap-1.5">
        {children}
      </div>
    </section>
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
        "rounded-[10px] border border-v3-border bg-v3-dim-white px-2.5 py-2 text-[13px]",
        note ? "block" : "flex justify-between gap-3",
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
