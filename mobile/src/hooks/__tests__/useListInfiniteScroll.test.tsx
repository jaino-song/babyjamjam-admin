import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

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

function ScrollList({
  totalItems = 17,
  resetKey = "all",
  autoLoadInitial,
}: {
  totalItems?: number;
  resetKey?: string;
  autoLoadInitial?: boolean;
}) {
  const { visibleCount, isInitialLoad, hasMore, scrollContainerRef, sentinelRef, loadMore } =
    useListInfiniteScroll({ totalItems, resetKey, autoLoadInitial });

  return (
    <>
      <output data-testid="phase">{isInitialLoad ? "initial" : "expanded"}</output>
      <div ref={scrollContainerRef} style={{ gap: 10, padding: 0 }}>
        {Array.from({ length: visibleCount }, (_, index) => (
          <div className="list-item" key={index}>Record {index + 1}</div>
        ))}
        {hasMore && <div ref={sentinelRef} data-testid="sentinel" />}
      </div>
      <button onClick={loadMore}>Load more</button>
    </>
  );
}

describe("useListInfiniteScroll with attached list refs", () => {
  let observers: Array<{
    notify: (isIntersecting: boolean) => void;
    observe: jest.Mock;
    disconnect: jest.Mock;
  }>;
  let resize: () => void;
  let scrollHeight: number;
  const originalIntersection = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  const originalResize = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");

  beforeEach(() => {
    observers = [];
    scrollHeight = 260;
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => scrollHeight);
    jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: jest.fn().mockImplementation((callback: () => void) => {
        resize = callback;
        return { observe: jest.fn(), disconnect: jest.fn() };
      }),
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: jest.fn().mockImplementation((callback: IntersectionObserverCallback) => {
        const observer = {
          notify: (isIntersecting: boolean) => callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          ),
          observe: jest.fn(),
          disconnect: jest.fn(),
        };
        observers.push(observer);
        return observer;
      }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [name, descriptor] of [
      ["IntersectionObserver", originalIntersection],
      ["ResizeObserver", originalResize],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  const rowCount = () => document.querySelectorAll(".list-item").length;
  const intersect = (isIntersecting = true) => {
    expect(observers.length).toBeGreaterThan(0);
    act(() => observers[observers.length - 1].notify(isIntersecting));
  };

  it("observes the initial measured list and reaches every record without a tap", () => {
    render(<ScrollList autoLoadInitial />);

    // 260px holds three 80px rows with two 10px gaps, plus one peek row.
    expect(rowCount()).toBe(4);
    expect(screen.getByTestId("phase")).toHaveTextContent("initial");
    expect(observers.length).toBeGreaterThan(0);
    expect(observers[0].observe).toHaveBeenCalledWith(screen.getByTestId("sentinel"));
    intersect(false);
    expect(rowCount()).toBe(4);

    intersect();
    expect(rowCount()).toBe(10);
    intersect();
    expect(rowCount()).toBe(16);
    intersect();
    expect(rowCount()).toBe(17);
    expect(screen.getByText("Record 17")).toBeInTheDocument();
    expect(screen.queryByTestId("sentinel")).not.toBeInTheDocument();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);

    const observerCount = observers.length;
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(rowCount()).toBe(17);
    expect(observers).toHaveLength(observerCount);
  });

  it("keeps the default manual first step and starts observing only after that step", () => {
    render(<ScrollList />);

    expect(rowCount()).toBe(4);
    expect(observers).toHaveLength(0);
    scrollHeight = 350;
    act(() => resize());
    expect(rowCount()).toBe(5);
    expect(observers).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(rowCount()).toBe(11);
    expect(screen.getByTestId("phase")).toHaveTextContent("expanded");
    expect(observers[0].observe).toHaveBeenCalledWith(screen.getByTestId("sentinel"));
    intersect();
    expect(rowCount()).toBe(17);
    expect(screen.queryByTestId("sentinel")).not.toBeInTheDocument();
  });

  it.each([
    { rowHeight: 80, initialCount: 4, mode: "measured" },
    { rowHeight: 0, initialCount: 6, mode: "fallback" },
  ])("restores $mode rows and automatic paging after filter reset and empty-to-loaded", ({ rowHeight, initialCount }) => {
    jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(rowHeight);
    const { rerender } = render(<ScrollList autoLoadInitial totalItems={0} />);
    expect(rowCount()).toBe(0);
    expect(observers).toHaveLength(0);

    rerender(<ScrollList autoLoadInitial />);
    expect(rowCount()).toBe(initialCount);
    expect(observers.length).toBeGreaterThan(0);
    expect(observers[observers.length - 1].observe).toHaveBeenCalledWith(screen.getByTestId("sentinel"));
    intersect();
    expect(rowCount()).toBe(initialCount + 6);

    rerender(<ScrollList autoLoadInitial resetKey="filtered" />);
    expect(rowCount()).toBe(initialCount);
    expect(screen.getByTestId("phase")).toHaveTextContent("initial");
    expect(observers[observers.length - 1].observe).toHaveBeenCalledWith(screen.getByTestId("sentinel"));
    intersect();
    expect(rowCount()).toBe(initialCount + 6);
  });
});
