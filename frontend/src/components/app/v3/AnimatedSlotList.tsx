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
  /** Number of skeleton slots to append while fetching more. Defaults to loadingCount. */
  fetchingMoreCount?: number;
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
  fetchingMoreCount,
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
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggeredRef = useRef(false);

  const itemsLength = items?.length ?? 0;
  const effectiveFetchingMoreCount = fetchingMoreCount ?? loadingCount;
  const slotCount: number =
    count !== undefined
      ? count
      : isLoading
        ? loadingCount
        : itemsLength + (isFetchingMore ? effectiveFetchingMoreCount : 0);

  useEffect(() => {
    loadMoreTriggeredRef.current = false;
  }, [itemsLength, hasMore, isFetchingMore]);

  useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const panelContent = sentinel.closest('[data-component="list-panel-content"]');
    const root = panelContent instanceof HTMLElement ? panelContent : null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadMoreTriggeredRef.current) return;

        loadMoreTriggeredRef.current = true;
        onLoadMore();
      },
      {
        root,
        rootMargin: "200px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isFetchingMore]);

  return (
    <div data-component="animated-slot-list" className={cn("relative -mx-2 px-2", className)}>
      {Array.from({ length: slotCount }, (_, index) => {
        const isAppendLoadingSlot = !isLoading && isFetchingMore && index >= itemsLength;
        const isSlotLoading = isLoading || isAppendLoadingSlot;
        const item = !isSlotLoading ? (items?.[index] ?? null) : null;

        const loadingBatchIndex = isAppendLoadingSlot ? index - itemsLength : index;
        const animationDelay = isSlotLoading
          ? `${Math.max(0, loadingBatchIndex) * delayStepSeconds}s`
          : "0s";

        const computedSlotClassName =
          typeof slotClassName === "function"
            ? slotClassName({ index, item, isLoading: isSlotLoading })
            : slotClassName ?? "";

        const shouldHide = hideEmptySlots && !isSlotLoading && !item;

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
              animationDelay,
            }}
            onClick={
              !isSlotLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined
            }
          >
            {render({ index, item, isLoading: isSlotLoading })}
          </div>
        );
      })}

      {hasMore && !isFetchingMore && (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      )}

      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      )}

    </div>
  );
}
