import { act, fireEvent, render, screen } from "@testing-library/react";
import { AnimatedSlotList } from "../AnimatedSlotList";
import { ListEmptyState } from "../ListEmptyState";
import { ListPanel } from "../ListPanel";

function createRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    width,
    height: 32,
    top: 0,
    right: left + width,
    bottom: 32,
    left,
    toJSON: () => ({}),
  };
}

describe("ListPanel", () => {
  it("aligns its header padding with a detail panel when requested", () => {
    const { container } = render(
      <ListPanel
        data-component="desktop_v3_tests_split-layout_list-panel-detail-header"
        title="목록"
        headerPadding="detail"
        className="h-fit flex-none self-start"
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel"]')).toHaveClass(
      "h-fit",
      "flex-none",
      "self-start",
    );
    expect(container.querySelector('[data-slot="list-panel-header"]')).toHaveClass(
      "px-[calc(24px*var(--glint-ui-scale,1))]",
      "py-[calc(20px*var(--glint-ui-scale,1))]",
    );
  });

  it("renders overlay through the root list-panel overlay layer", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel"
        title="목록"
        subtitle="설명"
        overlay={
          <ListEmptyState
            message="항목이 없습니다."
            className="flex-none min-h-0"
          />
        }
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_split-layout_list-panel_empty"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_list-empty-state_copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_split-layout_list-panel_empty-copy"]')).not.toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("renders emptyState through the overlay layer while keeping content mounted", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-2"
        title="목록"
        emptyState={<ListEmptyState message="항목이 없습니다." />}
      >
        <div data-testid="list-panel-content-child">본문</div>
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_split-layout_list-panel-2_empty-state"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="list-panel-content"]')).toBeInTheDocument();
    expect(screen.getByTestId("list-panel-content-child")).toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("keeps bottom space in the scroll container without a sticky opaque spacer", () => {
    const { container } = render(
      <ListPanel
        data-component="desktop_v3_tests_split-layout_list-panel-bottom-space"
        title="목록"
      >
        <button data-testid="last-list-row" type="button">
          마지막 행
        </button>
      </ListPanel>,
    );

    const content = container.querySelector<HTMLElement>('[data-slot="list-panel-content"]');
    const lastRow = screen.getByTestId("last-list-row");

    expect(content).toHaveClass("pb-[calc(24px*var(--glint-ui-scale,1))]");
    expect(content?.lastElementChild).toBe(lastRow);
    expect(
      Array.from(content?.children ?? []).some((child) => child.classList.contains("sticky")),
    ).toBe(false);
  });

  it("keeps the fetch-more boundary after appended rows and preserves row pop-up motion", () => {
    const renderPanel = (isFetchingMore: boolean) => (
      <ListPanel
        data-component="desktop_v3_tests_split-layout_list-panel-fetch-more"
        title="목록"
      >
        <AnimatedSlotList
          data-component="desktop_v3_tests_split-layout_list-panel-fetch-more_rows"
          items={[
            { id: "row-1", name: "첫 번째 행" },
            { id: "row-2", name: "두 번째 행" },
          ]}
          isLoading={false}
          isFetchingMore={isFetchingMore}
          fetchingMoreCount={1}
          hasMore
          itemDataComponent="desktop_v3_tests_split-layout_list-panel-fetch-more_row"
          getItemKey={(item) => item.id}
          render={({ item }) => item?.name ?? null}
        />
      </ListPanel>
    );

    const { container, rerender } = render(renderPanel(false));
    const content = container.querySelector<HTMLElement>('[data-slot="list-panel-content"]');
    const rows = () =>
      container.querySelectorAll(
        '[data-component="desktop_v3_tests_split-layout_list-panel-fetch-more_row"]',
      );
    const list = container.querySelector('[data-slot="animated-slot-list"]');
    const fetchMore = list?.querySelector('[data-slot="fetch-more"]');

    if (!content || !list || !fetchMore) {
      throw new Error("ListPanel fetch-more boundary was not rendered");
    }

    expect(content).toHaveClass("pb-[calc(24px*var(--glint-ui-scale,1))]");
    expect(content.lastElementChild).toBe(list);
    expect(list.lastElementChild).toBe(fetchMore);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).not.toHaveClass("animate-v3-pop-up");
    expect(rows()[1]).toHaveClass("animate-v3-pop-up");
    expect(rows()[1]).toHaveStyle({ animationDelay: "0.04s" });

    rerender(renderPanel(true));

    expect(list.lastElementChild).toBe(fetchMore);
    expect(rows()).toHaveLength(3);
    expect(rows()[1]).toHaveClass("animate-v3-pop-up");
    expect(rows()[2]).not.toHaveClass("animate-v3-pop-up");
  });

  it("waits for loading to finish before rendering the empty state", () => {
    const emptyState = <ListEmptyState message="항목이 없습니다." />;
    const content = <div data-testid="list-panel-content-child">본문</div>;
    const { container, rerender } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-3" title="목록" emptyState={emptyState} isLoading>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).not.toBeInTheDocument();
    expect(screen.getByTestId("list-panel-content-child")).toBeInTheDocument();
    expect(screen.queryByText("항목이 없습니다.")).not.toBeInTheDocument();

    rerender(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-4" title="목록" emptyState={emptyState} isContentLoading>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).not.toBeInTheDocument();
    expect(screen.queryByText("항목이 없습니다.")).not.toBeInTheDocument();

    rerender(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-5" title="목록" emptyState={emptyState}>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("keeps inline tabs scrollable while search expands as an overlay", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-6"
        title="고객 목록"
        tabs={[
          { label: "전체", value: "all" },
          { label: "대기", value: "waiting" },
          { label: "교체 요청", value: "replacement_requested" },
          { label: "진행중", value: "active" },
          { label: "완료", value: "completed" },
          { label: "중단", value: "terminated" },
        ]}
        activeTab="all"
        searchValue=""
        onSearchChange={jest.fn()}
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-controls"]')).toHaveClass(
      "[container-type:inline-size]",
    );
    expect(container.querySelector('[data-slot="list-panel-tab-scroll"]')).toHaveClass(
      "min-w-0",
      "flex-1",
      "overflow-x-auto",
    );
    expect(container.querySelector('[data-component="desktop_v3_expandable-search"]')).toHaveClass(
      "h-[calc(40px*var(--glint-ui-scale,1))]",
      "w-[calc(32px*var(--glint-ui-scale,1))]",
      "overflow-visible",
    );
    expect(container.querySelector('[data-component="desktop_v3_expandable-search_overlay"]')).toHaveClass(
      "absolute",
      "right-0",
      "h-[calc(40px*var(--glint-ui-scale,1))]",
      "expandable-search-overlay-surface",
    );

    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));

    expect(screen.getByRole("textbox", { name: "검색어" })).toHaveAttribute(
      "placeholder",
      "검색…",
    );
    expect(container.querySelector('[data-component="desktop_v3_expandable-search_overlay"]')).toHaveClass(
      "bg-white",
      "border-0",
      "shadow-none",
    );
    expect(container.querySelector('[data-component="desktop_v3_expandable-search_overlay"]')).not.toHaveClass(
      "border",
      "shadow-sm",
      "focus-within:ring-[3px]",
      "focus-within:ring-inset",
    );
    expect(container.querySelector('[data-component="desktop_v3_expandable-search_overlay"]')).toHaveStyle({
      width: "12rem",
    });
    expect(screen.getByRole("button", { name: "검색 닫기" })).toHaveClass(
      "transition-transform",
      "duration-200",
    );
    expect(container.querySelector('input[type="text"]')).toHaveClass(
      "flex-1",
      "border-0",
      "truncate",
      "expandable-search-overlay-input",
    );
  });

  it("shows the right fade only while more tabs remain offscreen", () => {
    const { container } = render(
      <ListPanel
        data-component="desktop_v3_tests_split-layout_list-panel-scroll-hint"
        title="고객 목록"
        tabs={[
          { label: "전체", value: "all" },
          { label: "대기", value: "waiting" },
          { label: "진행중", value: "active" },
          { label: "중단", value: "terminated" },
        ]}
        activeTab="all"
        onTabChange={jest.fn()}
      >
        {null}
      </ListPanel>,
    );

    const viewport = container.querySelector<HTMLElement>(
      '[data-slot="list-panel-tab-scroll"]'
    );
    const fade = viewport?.nextElementSibling;
    if (!viewport || !(fade instanceof HTMLElement)) {
      throw new Error("ListPanel tab scroll hint elements were not rendered");
    }

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 320 },
    });

    fireEvent.scroll(viewport);
    expect(fade).toHaveClass("opacity-100");

    viewport.scrollLeft = 140;
    fireEvent.scroll(viewport);
    expect(fade).toHaveClass("opacity-0");
  });

  it("exposes the active filter state when a tab group label is provided", () => {
    const onTabChange = jest.fn();

    render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-7"
        title="최근 현황"
        tabs={[
          { label: "전체", value: "all" },
          { label: "조치 필요", value: "action-required" },
        ]}
        activeTab="all"
        onTabChange={onTabChange}
        tabsAriaLabel="최근 현황 필터"
      >
        {null}
      </ListPanel>,
    );

    expect(screen.getByRole("group", { name: "최근 현황 필터" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "조치 필요" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "조치 필요" }));
    expect(onTabChange).toHaveBeenCalledWith("action-required");
  });

  it("remeasures the underline on the next frame when the active tab changes", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
    const cancelFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const tabs = [
      { label: "전체", value: "all" },
      { label: "진행중", value: "active" },
    ];
    const renderPanel = (activeTab: string) => (
      <ListPanel
        data-component="desktop_v3_tests_split-layout_list-panel-8"
        title="고객 목록"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={jest.fn()}
      >
        {null}
      </ListPanel>
    );

    const { container, rerender } = render(renderPanel("all"));
    const tabList = container.querySelector<HTMLElement>('[data-slot="list-panel-tab-list"]');
    const allTab = screen.getByRole("button", { name: "전체" });
    const activeTab = screen.getByRole("button", { name: "진행중" });
    const indicator = container.querySelector<HTMLElement>('[data-slot="list-panel-tab-indicator"]');

    if (!tabList || !indicator) {
      throw new Error("ListPanel tab measurement elements were not rendered");
    }

    tabList.getBoundingClientRect = () => createRect(10, 130);
    allTab.getBoundingClientRect = () => createRect(20, 40);
    activeTab.getBoundingClientRect = () => createRect(80, 60);

    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(0));
    });
    expect(indicator).toHaveStyle({ transform: "translateX(10px)", width: "40px" });

    rerender(renderPanel("active"));
    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(16));
    });
    expect(indicator).toHaveStyle({ transform: "translateX(70px)", width: "60px" });

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });
});
