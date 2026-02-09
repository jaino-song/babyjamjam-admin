"use client";

import React from "react";
import { cn } from "@/lib/utils";

type SlotClassNameArgs<T> = { index: number; item: T | null; isLoading: boolean };

export interface AnimatedSlotListProps<T> {
  count: number;
  items?: readonly T[] | null;
  isLoading: boolean;
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
  className,
  itemDataComponent = "animated-slot-list-item",
  delayStepSeconds = 0.04,
  hideEmptySlots = true,
  slotClassName,
  onSlotClick,
  render,
}: AnimatedSlotListProps<T>) {
  return (
    <div data-component="animated-slot-list" className={className}>
      {Array.from({ length: count }, (_, index) => {
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
