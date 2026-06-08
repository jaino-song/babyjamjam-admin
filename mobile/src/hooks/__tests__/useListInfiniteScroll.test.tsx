import { act, renderHook } from "@testing-library/react";

import { useListInfiniteScroll } from "../useListInfiniteScroll";

describe("useListInfiniteScroll", () => {
  it("clamps manual load-more growth to the total item count", () => {
    const { result } = renderHook(() =>
      useListInfiniteScroll({
        resetKey: "all",
        totalItems: 7,
        fallbackInitialCount: 6,
      }),
    );

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.visibleCount).toBe(7);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps fallback and measured counts within the total item count", () => {
    const { result, rerender } = renderHook(
      ({ resetKey, totalItems }) =>
        useListInfiniteScroll({
          resetKey,
          totalItems,
          fallbackInitialCount: 6,
        }),
      {
        initialProps: {
          resetKey: "all",
          totalItems: 4,
        },
      },
    );

    expect(result.current.visibleCount).toBe(4);

    rerender({
      resetKey: "filtered",
      totalItems: 2,
    });

    expect(result.current.visibleCount).toBe(2);
    expect(result.current.hasMore).toBe(false);
  });

  it("restores the initial visible count when items load after an empty first render", () => {
    const { result, rerender } = renderHook(
      ({ totalItems }) =>
        useListInfiniteScroll({
          resetKey: "all",
          totalItems,
          fallbackInitialCount: 6,
        }),
      {
        initialProps: {
          totalItems: 0,
        },
      },
    );

    expect(result.current.visibleCount).toBe(0);

    rerender({
      totalItems: 113,
    });

    expect(result.current.visibleCount).toBe(6);
    expect(result.current.hasMore).toBe(true);
  });
});
