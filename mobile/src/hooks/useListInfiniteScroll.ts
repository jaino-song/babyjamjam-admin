"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const LIST_INFINITE_INITIAL_COUNT = 6;
export const LIST_INFINITE_INITIAL_COUNT_ALL = 12;
export const LIST_INFINITE_PAGE_SIZE = 6;

const ROW_SELECTOR = ".list-item, .contract-item";

/**
 * Teaser → tap-to-expand → infinite scroll 패턴.
 *
 * - 초기 단계 (`isInitialLoad === true`): 화면에 들어가는 row 수 + 1개 (peek) 만큼 렌더 + "탭하여 더보기"
 *   버튼 노출. `scrollContainerRef` 가 가리키는 스크롤 영역의 clientHeight 와 첫 row 의 offsetHeight 를
 *   측정해 `floor((scrollH + gap) / (rowH + gap)) + 1` 만큼 채운다 — 마지막 row 는 footer 의 white
 *   gradient 뒤로 살짝 가려져 "더 있다" 라는 teaser cue 가 됨. 측정 실패 시 `fallbackInitialCount` 사용.
 * - 사용자가 한 번 누르면 `isInitialLoad=false` 로 전환되어 버튼은 사라지고 sentinel 요소가
 *   viewport 진입할 때마다 +LIST_INFINITE_PAGE_SIZE 자동 로드.
 *
 * - resetKey: 값이 바뀌면 visibleCount 가 측정값(또는 fallback) 으로 리셋 (필터/탭 변경 등)
 * - totalItems: 가장 큰 섹션 등 "더 표시 가능한지" 판단의 기준 값. 호출 페이지에서 slice 이전 상태로
 *   계산해서 넘기면 순환참조 없음.
 * - fallbackInitialCount: 첫 render (측정 전) 또는 측정 실패 시 사용할 기본값.
 */
export function useListInfiniteScroll({
  resetKey,
  totalItems,
  fallbackInitialCount = LIST_INFINITE_INITIAL_COUNT,
}: {
  resetKey: unknown;
  totalItems: number;
  fallbackInitialCount?: number;
}) {
  const [visibleCount, setVisibleCount] = useState(fallbackInitialCount);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset on filter/tab change (compare-during-render pattern; React-recommended over an effect).
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setHasInteracted(false);
    setVisibleCount(fallbackInitialCount);
  }

  // Measure how many rows fit and adjust visibleCount while still in initial state.
  useLayoutEffect(() => {
    if (hasInteracted) return;
    const scroll = scrollContainerRef.current;
    if (!scroll) return;

    const measure = () => {
      const firstRow = scroll.querySelector<HTMLElement>(ROW_SELECTOR);
      if (!firstRow) return;
      const rowH = firstRow.offsetHeight;
      if (rowH <= 0) return;
      const scrollH = scroll.clientHeight;
      const style = window.getComputedStyle(scroll);
      const gap = parseFloat(style.rowGap || style.gap || "0") || 0;
      const padTop = parseFloat(style.paddingTop) || 0;
      const padBottom = parseFloat(style.paddingBottom) || 0;
      const usable = scrollH - padTop - padBottom;
      const fit = Math.max(1, Math.floor((usable + gap) / (rowH + gap)));
      const target = fit + 1; // +1 peek row, masked by footer white-fade
      setVisibleCount((prev) => (prev === target ? prev : target));
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [hasInteracted, resetKey, totalItems]);

  const isInitialLoad = !hasInteracted;
  const hasMore = visibleCount < totalItems;

  const loadMore = useCallback(() => {
    setHasInteracted(true);
    setVisibleCount((current) => current + LIST_INFINITE_PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (!hasMore || isInitialLoad) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "0px 0px 120px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isInitialLoad, loadMore]);

  return {
    visibleCount,
    isInitialLoad,
    hasMore,
    sentinelRef,
    scrollContainerRef,
    loadMore,
  };
}
