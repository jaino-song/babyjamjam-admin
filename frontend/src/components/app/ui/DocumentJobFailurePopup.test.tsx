import { act, fireEvent, render, screen } from "@testing-library/react";

import { DocumentJobFailurePopup } from "./DocumentJobFailurePopup";
import { DocumentJobFailurePopupStack } from "./DocumentJobFailurePopupStack";

describe("DocumentJobFailurePopup", () => {
  it("renders copy, runs the action and closes", () => {
    const onAction = jest.fn();
    const onClose = jest.fn();

    render(
      <DocumentJobFailurePopup
        data-component="desktop_test_failure"
        title="계약서 자동 전송 실패"
        description="김하늘 님"
        actionLabel="직접 작성하기"
        onAction={onAction}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("계약서 자동 전송 실패");
    fireEvent.click(screen.getByRole("button", { name: "직접 작성하기" }));
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DocumentJobFailurePopupStack", () => {
  it("renders nothing without items or overflow", () => {
    const { container } = render(<DocumentJobFailurePopupStack data-component="desktop_test_stack" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("numbers its items and labels the overflow popup", () => {
    render(
      <DocumentJobFailurePopupStack
        data-component="desktop_test_stack"
        items={[
          { key: "a", title: "하나", actionLabel: "열기", onAction: jest.fn(), onClose: jest.fn() },
          { key: "b", title: "둘", actionLabel: "열기", onAction: jest.fn(), onClose: jest.fn() },
        ]}
        overflow={{ title: "실패 3건 더 보기", actionLabel: "목록 보기", onAction: jest.fn(), onClose: jest.fn() }}
      />,
    );

    expect(screen.getByRole("region", { name: "전자문서 처리 실패 알림" })).toBeInTheDocument();
    expect(document.querySelector('[data-component="desktop_test_stack_item-0"]')).toHaveTextContent("하나");
    expect(document.querySelector('[data-component="desktop_test_stack_item-1"]')).toHaveTextContent("둘");
    expect(document.querySelector('[data-component="desktop_test_stack_overflow"]')).toHaveTextContent("실패 3건 더 보기");
  });
});

describe("DocumentJobFailurePopupStack toaster clearance", () => {
  const originalResizeObserver = global.ResizeObserver;
  let trigger: ((height: number) => void) | null = null;
  let toaster: HTMLDivElement;

  const items = [{ key: "a", title: "하나", actionLabel: "열기", onAction: jest.fn(), onClose: jest.fn() }];
  const stackBottom = () => screen.getByRole("region", { name: "전자문서 처리 실패 알림" }).style.bottom;

  beforeEach(() => {
    toaster = document.createElement("div");
    toaster.setAttribute("data-slot", "toaster-viewport");
    toaster.style.bottom = "24px";
    document.body.appendChild(toaster);
    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {
        trigger = (height) =>
          this.callback(
            [{ target: toaster, contentRect: { height } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    toaster.remove();
    global.ResizeObserver = originalResizeObserver;
    trigger = null;
  });

  it("sits above a tall toast with an 8px gap", () => {
    render(<DocumentJobFailurePopupStack data-component="desktop_test_stack" items={items} />);
    expect(stackBottom()).toBe("128px");

    act(() => trigger?.(200));

    expect(Number.parseFloat(stackBottom())).toBeGreaterThanOrEqual(24 + 200 + 8);
  });

  it("keeps the fallback offset as a floor and when no toast is visible", () => {
    render(<DocumentJobFailurePopupStack data-component="desktop_test_stack" items={items} />);

    act(() => trigger?.(40));
    expect(stackBottom()).toBe("128px");

    act(() => trigger?.(200));
    act(() => trigger?.(0));
    expect(stackBottom()).toBe("128px");
  });

  it("falls back when ResizeObserver is unavailable", () => {
    // @ts-expect-error jsdom without ResizeObserver
    delete global.ResizeObserver;
    render(<DocumentJobFailurePopupStack data-component="desktop_test_stack" items={items} />);

    expect(stackBottom()).toBe("128px");
  });
});
