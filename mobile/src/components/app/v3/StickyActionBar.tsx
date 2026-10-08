import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "StickyActionBar";

export interface StickyActionBarProps {
  "data-component": string;
  /** Buttons; each child takes an equal share of the row. */
  children: ReactNode;
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
        "sticky bottom-0 z-10 flex gap-2 border-t border-v3-border bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] [&>*]:flex-1",
        className,
      )}
    >
      {children}
    </div>
  );
}
