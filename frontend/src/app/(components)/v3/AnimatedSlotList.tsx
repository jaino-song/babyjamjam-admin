"use client";

import React, { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";

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

  // Load more functionality
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when user taps to load more */
  onLoadMore?: () => void;
  /** True when fetching more items */
  isFetchingMore?: boolean;
  /** True when showing initial teaser view (enables gradient overlay) */
  isInitialLoad?: boolean;
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
  // Load more props
  hasMore = false,
  onLoadMore,
  isFetchingMore = false,
  isInitialLoad = false,
}: AnimatedSlotListProps<T>) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // If count is provided, use it. Otherwise, show all items (or loadingCount while loading)
  const itemsLength = items?.length ?? 0;
  const slotCount: number = count !== undefined ? count : (isLoading ? loadingCount : itemsLength);

  // Calculate opacity for fade effect on teaser items (only last 2 items fade)
  const getItemOpacity = (index: number): number => {
    if (!isInitialLoad || !hasMore) return 1;
    // Items 1-4 fully visible, items 5-6 fade
    if (index < 4) return 1;
    // Item 5 (index 4) -> 0.5, Item 6 (index 5) -> 0.2
    const opacityValues = [0.5, 0.2];
    return opacityValues[index - 4] ?? 0.1;
  };

  // Intersection Observer for infinite scroll (after initial tap)
  useEffect(() => {
    // Only enable after initial teaser is dismissed
    if (isInitialLoad || !hasMore || isFetchingMore || !onLoadMore) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        // Trigger when sentinel is 200px from viewport
        rootMargin: "200px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isInitialLoad, hasMore, isFetchingMore, onLoadMore]);

  // Show teaser overlay when in initial load state with more items
  const showTeaserOverlay = isInitialLoad && hasMore && !isFetchingMore && !isLoading;

  return (
    <div data-component="animated-slot-list" className={cn("relative", className)}>
      {Array.from({ length: slotCount }, (_, index) => {
        const item = !isLoading ? (items?.[index] ?? null) : null;

        const computedSlotClassName =
          typeof slotClassName === "function"
            ? slotClassName({ index, item, isLoading })
            : slotClassName ?? "";

        const shouldHide = hideEmptySlots && !isLoading && !item;
        const itemOpacity = getItemOpacity(index);

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
              opacity: isLoading ? 1 : itemOpacity,
            }}
            onClick={
              !isLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined
            }
          >
            {render({ index, item, isLoading })}
          </div>
        );
      })}

      {/* Teaser overlay - entire area is clickable to load more */}
      {showTeaserOverlay && (
        <button
          onClick={onLoadMore}
          className="absolute inset-x-0 bottom-0 h-36 cursor-pointer group"
        >
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

          {/* Tap to load more text and chevron */}
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-1 text-v3-text-muted text-sm group-hover:text-v3-primary transition-colors">
            <span>탭하여 더 보기</span>
            <ChevronDown className="w-5 h-5 animate-ball-bounce" />
          </div>
        </button>
      )}

      {/* Loading spinner when fetching more */}
      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      )}

      {/* Sentinel for infinite scroll detection (invisible, at bottom of list) */}
      {!isInitialLoad && hasMore && !isFetchingMore && (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      )}
    </div>
  );
}
