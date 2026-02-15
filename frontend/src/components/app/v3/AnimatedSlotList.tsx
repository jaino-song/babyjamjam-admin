"use client";

import React, { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

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

  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when sentinel becomes visible */
  onLoadMore?: () => void;
  /** True when fetching more items */
  isFetchingMore?: boolean;
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
  hasMore = false,
  onLoadMore,
  isFetchingMore = false,
}: AnimatedSlotListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const itemsLength = items?.length ?? 0;
  const slotCount: number = count !== undefined ? count : (isLoading ? loadingCount : itemsLength);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        onLoadMore();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasMore, onLoadMore]);

  return (
    <div ref={containerRef} data-component="animated-slot-list" className={cn("relative overflow-y-auto", className)}>
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
            style={{
              animationDelay: `${index * delayStepSeconds}s`,
            }}
            onClick={
              !isLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined
            }
          >
            {render({ index, item, isLoading })}
          </div>
        );
      })}

      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      )}

    </div>
  );
}
