import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "StickyActionBar";

export interface StickyActionBarProps {
  "data-component": string;
  /** Buttons; equal-width slots below `sm`, natural width and right-aligned from `sm` up. */
  children: ReactNode;
  /**
   * Optional left-end slot: at the left end from `sm` up, the first equal-width
   * child below `sm`.
   */
  leading?: ReactNode;
  /** Renders `role="group"` with this name when given. */
  "aria-label"?: string;
  /** Layout-only (never visual). */
  className?: string;
}

/**
 * Bottom action bar. It is `position: sticky; bottom: 0` inside the scroll
 * container (not `fixed`), so it stays in view without ever covering content.
 */
export function StickyActionBar({
  "data-component": dataComponent,
  children,
  leading,
  "aria-label": ariaLabel,
  className,
}: StickyActionBarProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "sticky bottom-0 z-10 grid auto-cols-fr grid-flow-col gap-[calc(8px*var(--glint-ui-scale,1))] border-t border-v3-border! bg-white px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] sm:flex sm:justify-end sm:px-[calc(24px*var(--glint-ui-scale,1))]",
        // Below `sm`: every direct child is one equal border-box slot that may shrink.
        // From `sm`: natural width, right-aligned.
        "[&>*]:min-w-0 [&>*]:truncate sm:[&>*]:flex-none",
        className,
      )}
    >
      {leading ? (
        <div
          data-component={`${dataComponent}_leading`}
          className="min-w-0 sm:mr-auto sm:flex sm:gap-[calc(8px*var(--glint-ui-scale,1))] [&>*]:w-full [&>*]:min-w-0 sm:[&>*]:w-auto sm:[&>*]:flex-none"
        >
          {leading}
        </div>
      ) : null}
      {children}
    </div>
  );
}
