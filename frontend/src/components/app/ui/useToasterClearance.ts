"use client";

import { useEffect, useState } from "react";

/** The Toaster viewport's stable hook (see `ui/toaster.tsx`). */
export const TOASTER_VIEWPORT_SELECTOR = '[data-slot="toaster-viewport"]';

/**
 * Bottom offset used when no toast is visible, or when the toaster cannot be
 * measured. It also stays the floor while a toast is visible, so on phones the
 * stack never drops below the floating bottom navigation.
 */
export const TOASTER_CLEARANCE_FALLBACK_PX = 128;

/** The toaster's own `bottom-6`, used if its computed offset cannot be read. */
const TOASTER_BOTTOM_DEFAULT_PX = 24;

/** The gap kept between the toaster's top edge and the stack. */
export const TOASTER_CLEARANCE_GAP_PX = 8;

/**
 * The bottom offset a bottom-right stack needs to sit clear of the shared
 * Toaster: the toaster's bottom offset, plus its measured content height, plus
 * a fixed gap. Falls back to a fixed offset when no toast is visible or when
 * ResizeObserver is unavailable (jsdom, old browsers).
 *
 * Pass `active` as whether the stack is rendered, so the toaster is looked up
 * again each time the stack appears.
 */
export function useToasterClearance(active: boolean): number {
  const [bottom, setBottom] = useState(TOASTER_CLEARANCE_FALLBACK_PX);

  useEffect(() => {
    if (!active || typeof ResizeObserver === "undefined") return undefined;
    const viewport = document.querySelector<HTMLElement>(TOASTER_VIEWPORT_SELECTOR);
    if (!viewport) return undefined;

    const apply = (height: number) => {
      if (!(height > 0)) {
        setBottom(TOASTER_CLEARANCE_FALLBACK_PX);
        return;
      }
      const toasterBottom =
        Number.parseFloat(window.getComputedStyle(viewport).bottom) || TOASTER_BOTTOM_DEFAULT_PX;
      setBottom(
        Math.max(
          TOASTER_CLEARANCE_FALLBACK_PX,
          Math.ceil(toasterBottom + height + TOASTER_CLEARANCE_GAP_PX),
        ),
      );
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      apply(entry ? entry.contentRect.height : viewport.getBoundingClientRect().height);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      // Back to the fallback so the next appearance never starts from a stale height.
      setBottom(TOASTER_CLEARANCE_FALLBACK_PX);
    };
  }, [active]);

  return bottom;
}
