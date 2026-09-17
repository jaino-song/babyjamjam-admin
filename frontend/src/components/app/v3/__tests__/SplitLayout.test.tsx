import { act, render } from "@testing-library/react";
import { SplitLayout } from "../SplitLayout";

describe("SplitLayout", () => {
  it("remeasures panels when the shell width changes after a window resize", () => {
    jest.useFakeTimers();
    const originalObserver = global.ResizeObserver;
    let notifyResize: ResizeObserverCallback = () => undefined;
    const disconnect = jest.fn();
    const observer = { observe: jest.fn(), unobserve: jest.fn(), disconnect };
    global.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
      notifyResize = callback;
      return observer;
    }) as unknown as typeof ResizeObserver;
    let availableWidth = 298.5625;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.dataset.testid === "split-parent"
        ? availableWidth
        : this.dataset.panel === "detail"
          ? Number.parseFloat(this.closest<HTMLElement>('[data-slot="split-layout"]')?.style.getPropertyValue("--compact-detail-width") ?? "0")
          : 0;
      return width ? { ...originalRect.call(this), width } as DOMRect : originalRect.call(this);
    });
    const frameSpy = jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const cancelSpy = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(window.clearTimeout);

    try {
      const { container, unmount } = render(
        <main data-slot="main-content">
          <section data-testid="split-parent">
            <SplitLayout data-component="desktop_v3_tests_split-layout-resize" hasSelection>
              <div>목록</div>
              <div>상세</div>
            </SplitLayout>
          </section>
        </main>,
      );
      const root = container.querySelector<HTMLElement>('[data-slot="split-layout"]')!;
      expect(root.style.getPropertyValue("--compact-detail-width")).toBe("298.5625px");

      act(() => {
        availableWidth = 288;
        notifyResize([], observer as ResizeObserver);
        jest.runOnlyPendingTimers();
      });

      expect(root.style.getPropertyValue("--compact-detail-width")).toBe("288px");
      expect(root.style.getPropertyValue("--compact-list-offset")).toBe("304px");
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      global.ResizeObserver = originalObserver;
      rectSpy.mockRestore();
      frameSpy.mockRestore();
      cancelSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("animates each panel once when it mounts", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout" hasSelection>
        <div>목록</div>
        <div key="selected-detail">상세</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-slot="split-layout"]')).not.toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="list"]')).toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("keeps detail panel mount animation independent from selection state", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout-2" hasSelection={false}>
        <div>목록</div>
        <div>빈 상태</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("keeps extra children inside the detail panel in two-column mode", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout-3" hasSelection>
        <div data-testid="list-panel-child">목록</div>
        <div data-testid="retained-hidden-child">유지 중인 숨김 세션</div>
        <div data-testid="selected-detail-child">상세</div>
      </SplitLayout>,
    );

    const panels = container.querySelectorAll('[data-slot="split-layout-panel"]');

    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveAttribute("data-panel", "list");
    expect(panels[1]).toHaveAttribute("data-panel", "detail");
    expect(panels[0].querySelector('[data-testid="list-panel-child"]')).toBeInTheDocument();
    expect(panels[1].querySelector('[data-testid="retained-hidden-child"]')).toBeInTheDocument();
    expect(panels[1].querySelector('[data-testid="selected-detail-child"]')).toBeInTheDocument();
  });
});
