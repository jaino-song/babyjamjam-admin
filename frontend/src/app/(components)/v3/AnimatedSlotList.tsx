"use client";

import React from "react";
import { cn } from "@/lib/utils";

type SlotClassNameArgs<T> = { index: number; item: T | null; isLoading: boolean };

export interface AnimatedSlotListProps<T> {
  /** Number of slots to render. If not provided, shows all items (unlimited). */
  count?: number;
  items?: readonly T[] | null;
  isLoading: boolean;
  /** Number of skeleton slots to show while loading (only used when count is not provided). Default: 4 */
  loadingCount?: number;
  className?: string;
  itemDataComponent?: string;
  /** Delay step in seconds (e.g. 0.04) */
  delayStepSeconds?: number;
  hideEmptySlots?: boolean;
  slotClassName?: string | ((args: SlotClassNameArgs<T>) => string);
  onSlotClick?: (item: T, index: number) => void;
  render: (args: { index: number; item: T | null; isLoading: boolean }) => React.ReactNode;
}

export function AnimatedSlotList<T>({
  count,
  items,
  isLoading,
  loadingCount = 4,
  className,
  itemDataComponent = "animated-slot-list-item",
  delayStepSeconds = 0.04,
  hideEmptySlots = true,
  slotClassName,
  onSlotClick,
  render,
}: AnimatedSlotListProps<T>) {
  // If count is provided, use it. Otherwise, show all items (or loadingCount while loading)
  const itemsLength = items?.length ?? 0;
  const slotCount: number = count !== undefined ? count : (isLoading ? loadingCount : itemsLength);

  return (
    <div data-component="animated-slot-list" className={className}>
      {Array.from({ length: slotCount }, (_, index) => {
        const item = !isLoading ? (items?.[index] ?? null) : null;

        const computedSlotClassName =
          typeof slotClassName === "function"
            ? slotClassName({ index, item, isLoading })
            : slotClassName ?? "";

        const shouldHide = hideEmptySlots && !isLoading && !item;

        return (
          <div
            key={`slot-${index}`}
            data-component={itemDataComponent}
            className={cn(
              "animate-v3-pop-up",
              computedSlotClassName,
              shouldHide && "hidden"
            )}
            style={{ animationDelay: `${index * delayStepSeconds}s` }}
            onClick={
              !isLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined
            }
          >
            {render({ index, item, isLoading })}
          </div>
        );
      })}
    </div>
  );
}
