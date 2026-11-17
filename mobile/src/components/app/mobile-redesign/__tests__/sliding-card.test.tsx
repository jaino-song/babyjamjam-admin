import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SlidingCard } from "../sliding-card";

const DATA_COMPONENT = "mobile_tests_settings_sliding-card";
const DETAIL_PANE_SELECTOR =
  `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`;

let globalFocusStyle: HTMLStyleElement;

beforeEach(() => {
  globalFocusStyle = document.createElement("style");
  const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const focusRule = globals.match(/^\*:focus-visible[^{]*\{[^}]*\}/m);
  expect(focusRule).not.toBeNull();
  globalFocusStyle.textContent = focusRule?.[0] ?? "";
  document.head.append(globalFocusStyle);
});

afterEach(() => globalFocusStyle.remove());

const originalPointerEvent = Object.getOwnPropertyDescriptor(
  globalThis,
  "PointerEvent",
);
const originalHasPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "hasPointerCapture",
);
const originalSetPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "setPointerCapture",
);
const originalReleasePointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "releasePointerCapture",
);

beforeAll(() => {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: class PointerEventMock extends MouseEvent {
      readonly isPrimary: boolean;
      readonly pointerId: number;
      readonly pointerType: string;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? false;
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "";
      }
    },
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
});

afterAll(() => {
  if (originalPointerEvent) {
    Object.defineProperty(globalThis, "PointerEvent", originalPointerEvent);
  } else {
    Reflect.deleteProperty(globalThis, "PointerEvent");
  }

  if (originalHasPointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      "hasPointerCapture",
      originalHasPointerCapture,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
  }

  if (originalSetPointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      "setPointerCapture",
      originalSetPointerCapture,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  }

  if (originalReleasePointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      "releasePointerCapture",
      originalReleasePointerCapture,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
  }
});

function renderOpenSlidingCard() {
  const onBack = jest.fn();
  const view = render(
    <SlidingCard
      data-component={DATA_COMPONENT}
      open
      onBack={onBack}
      backLabel="설정"
      detailKey="detail-a"
      list={<div>List content</div>}
      detail={<div>Detail content</div>}
    />,
  );
  const detailPane = view.container.querySelector<HTMLElement>(
    DETAIL_PANE_SELECTOR,
  );

  expect(detailPane).not.toBeNull();
  jest.spyOn(detailPane as HTMLElement, "getBoundingClientRect").mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 400,
    top: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return { ...view, detailPane: detailPane as HTMLElement, onBack };
}

describe("SlidingCard", () => {
  it("names the pane from the current detail title and preserves existing heading IDs", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      open: true,
      onBack: jest.fn(),
      backLabel: "운영 통계",
      list: <h2>운영 통계</h2>,
    };
    const { rerender } = render(
      <SlidingCard {...props} detailKey="clients" detail={<><h2 id="client-stats-title">고객 통계</h2><p>고객 수 10명</p></>} />,
    );
    const pane = screen.getByRole("region", { name: "고객 통계" });
    expect(pane).toHaveFocus();
    expect(screen.getByRole("heading", { name: "고객 통계" })).toHaveAttribute("id", "client-stats-title");

    rerender(<SlidingCard {...props} detailKey="employees" detail={<h2>제공인력 통계</h2>} />);
    expect(pane).toHaveAccessibleName("제공인력 통계");
    expect(screen.getByRole("button", { name: "운영 통계 목록으로 돌아가기" })).toBeInTheDocument();

    rerender(<SlidingCard {...props} detailKey="empty" detail={<p>상세 내용 없음</p>} />);
    expect(pane).toHaveAccessibleName("상세 정보");
    expect(pane).not.toHaveAttribute("aria-labelledby");
  });

  it("uses the detail header name and follows titles that arrive after loading", async () => {
    function Detail() {
      const [loaded, setLoaded] = useState(false);
      return <><button onClick={() => setLoaded(true)}>Load detail</button>{loaded ? <div className="client-detail-name">테스트 고객</div> : <span role="status" aria-label="불러오는 중" />}</>;
    }
    render(<SlidingCard data-component={DATA_COMPONENT} open onBack={jest.fn()} backLabel="고객 목록" detailKey="client" list={null} detail={<Detail />} />);
    const pane = screen.getByRole("region", { name: "상세 정보" });
    fireEvent.click(screen.getByRole("button", { name: "Load detail" }));
    await waitFor(() => expect(pane).toHaveAccessibleName("테스트 고객"));
  });

  it("keeps the list pane available and the detail pane hidden when closed", () => {
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open={false}
        onBack={jest.fn()}
        backLabel="설정"
        detailKey={null}
        list={<div>List content</div>}
        detail={null}
      />,
    );

    const listPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );

    expect(listPane).not.toHaveAttribute("aria-hidden", "true");
    expect(listPane).not.toHaveAttribute("inert");
    expect(detailPane).toHaveAttribute("aria-hidden", "true");
    expect(detailPane).toHaveAttribute("inert");
  });

  it("hides the list pane and focuses the detail container without a button ring when open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={jest.fn()}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<h2>알림 설정</h2>}
      />,
    );

    const listPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );
    const backButton = screen.getByRole("button", {
      name: "설정 목록으로 돌아가기",
    });

    expect(listPane).toHaveAttribute("aria-hidden", "true");
    expect(listPane).toHaveAttribute("inert");
    expect(detailPane).not.toHaveAttribute("aria-hidden", "true");
    expect(detailPane).not.toHaveAttribute("inert");
    expect(detailPane).toHaveFocus();
    expect(detailPane).toHaveAttribute("tabindex", "-1");
    expect(detailPane).toHaveAttribute("role", "region");
    expect(detailPane).toHaveAccessibleName("알림 설정");
    expect(detailPane).toHaveClass("outline-none");
    expect(detailPane).toBeInstanceOf(HTMLElement);
    const pane = detailPane as HTMLElement;
    expect(pane.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(pane).outline).toBe("none");
    expect(getComputedStyle(pane).borderRadius).toBe("0");
    expect(backButton).not.toHaveFocus();
    await user.tab();
    expect(backButton).toHaveFocus();
    expect(getComputedStyle(backButton).outline).not.toBe("none");
    expect(getComputedStyle(backButton).outline).not.toBe("");
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = jest.fn();
    render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={onBack}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<div>Detail content</div>}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "설정 목록으로 돌아가기" }),
    );

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("commits an edge drag and suppresses the following ghost click", () => {
    const { detailPane, onBack } = renderOpenSlidingCard();
    const backButton = screen.getByRole("button", {
      name: "설정 목록으로 돌아가기",
    });

    fireEvent.pointerDown(detailPane, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(detailPane, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.click(backButton);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("allows a legitimate detail button tap after a committed swipe emitted no click", () => {
    const onBack = jest.fn();
    const onDetailClick = jest.fn();
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={onBack}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={(
          <button type="button" onClick={onDetailClick}>
            Detail action
          </button>
        )}
      />,
    );
    const detailPane = container.querySelector<HTMLElement>(
      DETAIL_PANE_SELECTOR,
    );

    expect(detailPane).not.toBeNull();
    jest.spyOn(detailPane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(detailPane as HTMLElement, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(detailPane as HTMLElement, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(detailPane as HTMLElement, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });

    const detailAction = screen.getByRole("button", { name: "Detail action" });
    fireEvent.pointerDown(detailAction, {
      clientX: 200,
      clientY: 100,
      isPrimary: true,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.pointerUp(detailAction, {
      clientX: 200,
      clientY: 100,
      isPrimary: true,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.click(detailAction);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDetailClick).toHaveBeenCalledTimes(1);
  });

  it("retains committed drag styles until the card closes", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      onBack: jest.fn(),
      backLabel: "설정",
      list: <div>List content</div>,
    };
    const { container, rerender } = render(
      <SlidingCard
        {...props}
        open
        detailKey="detail-a"
        detail={<div>Detail content</div>}
      />,
    );
    const detailPane = container.querySelector<HTMLElement>(
      DETAIL_PANE_SELECTOR,
    );

    expect(detailPane).not.toBeNull();
    jest.spyOn(detailPane as HTMLElement, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(detailPane as HTMLElement, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(detailPane as HTMLElement, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(detailPane as HTMLElement, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(detailPane).toHaveClass("dragging");
    expect(detailPane).toHaveStyle({ transform: "translateX(190px)" });

    rerender(
      <SlidingCard
        {...props}
        open={false}
        detailKey={null}
        detail={null}
      />,
    );

    expect(detailPane).not.toHaveClass("dragging");
    expect(detailPane?.style.transform).toBe("");
  });

  it("ignores mouse drags that start at the left edge", () => {
    const { detailPane, onBack } = renderOpenSlidingCard();

    fireEvent.pointerDown(detailPane, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(detailPane, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(detailPane).not.toHaveClass("dragging");
    expect(detailPane.style.transform).toBe("");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not claim a drag that starts away from the left edge", () => {
    const { detailPane, onBack } = renderOpenSlidingCard();

    fireEvent.pointerDown(detailPane, {
      clientX: 200,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 360,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(detailPane, {
      clientX: 360,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPane).not.toHaveClass("dragging");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("shows direct drag styles and snaps back below the distance threshold", () => {
    const { container, detailPane, onBack } = renderOpenSlidingCard();
    const listPane = container.querySelector<HTMLElement>(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const listDim = container.querySelector<HTMLElement>(
      `[data-slot="list-dim"]`,
    );

    fireEvent.pointerDown(detailPane, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 60,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 60,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPane).toHaveClass("dragging");
    expect(detailPane).toHaveStyle({ transform: "translateX(50px)" });

    fireEvent.pointerUp(detailPane, {
      clientX: 60,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPane).not.toHaveClass("dragging");
    expect(detailPane.style.transform).toBe("");
    expect(listPane?.style.transform).toBe("");
    expect(listDim?.style.opacity).toBe("");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not claim a vertical-dominant movement from the edge", () => {
    const { detailPane, onBack } = renderOpenSlidingCard();

    fireEvent.pointerDown(detailPane, {
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 20,
      clientY: 50,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPane).not.toHaveClass("dragging");
    expect(detailPane.style.transform).toBe("");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("snaps back without navigation when an edge drag is cancelled", () => {
    const { container, detailPane, onBack } = renderOpenSlidingCard();
    const listPane = container.querySelector<HTMLElement>(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const listDim = container.querySelector<HTMLElement>(
      `[data-slot="list-dim"]`,
    );

    fireEvent.pointerDown(detailPane, {
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(detailPane, {
      clientX: 160,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerCancel(detailPane, {
      clientX: 160,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPane).not.toHaveClass("dragging");
    expect(detailPane.style.transform).toBe("");
    expect(listPane?.style.transform).toBe("");
    expect(listDim?.style.opacity).toBe("");
    expect(onBack).not.toHaveBeenCalled();
  });

  // Velocity-based commit is verified manually on-device because jsdom event
  // timeStamps are not reliable enough for a deterministic assertion.

  it("restores focus to the previously active element when closed", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      onBack: jest.fn(),
      backLabel: "설정",
      detailKey: "detail-a",
      list: <button type="button">Open detail</button>,
      detail: <h2>알림 설정</h2>,
    };
    const { container, rerender } = render(<SlidingCard {...props} open={false} />);
    const opener = screen.getByRole("button", { name: "Open detail" });
    opener.focus();
    fireEvent.focusIn(opener);
    expect(opener).toHaveFocus();

    opener.blur();
    expect(document.body).toHaveFocus();

    rerender(<SlidingCard {...props} open />);
    const detailPane = container.querySelector<HTMLElement>('[data-slot="detail-pane"]')!;
    const backButton = screen.getByRole("button", {
      name: "설정 목록으로 돌아가기",
    });
    expect(detailPane).toHaveFocus();
    expect(detailPane).toHaveAttribute("tabindex", "-1");
    expect(detailPane).toHaveAttribute("role", "region");
    expect(detailPane).toHaveAccessibleName("알림 설정");
    expect(detailPane).toHaveClass("outline-none");
    expect(backButton).not.toHaveFocus();

    detailPane.blur();
    expect(document.body).toHaveFocus();

    rerender(
      <SlidingCard
        {...props}
        open={false}
        detailKey={null}
        detail={null}
      />,
    );
    expect(opener).toHaveFocus();
  });

  it("keeps the last detail mounted until the closing transform ends", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      onBack: jest.fn(),
      backLabel: "설정",
      list: <div>List content</div>,
    };
    const { container, rerender } = render(
      <SlidingCard
        {...props}
        open
        detailKey="detail-a"
        detail={<div>Detail A</div>}
      />,
    );

    rerender(
      <SlidingCard
        {...props}
        open={false}
        detailKey={null}
        detail={null}
      />,
    );

    expect(screen.getByText("Detail A")).toBeInTheDocument();

    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );
    expect(detailPane).not.toBeNull();
    const transitionEndEvent = new Event("transitionend", {
      bubbles: true,
    });
    Object.defineProperty(transitionEndEvent, "propertyName", {
      value: "transform",
    });
    fireEvent(detailPane as Element, transitionEndEvent);

    expect(screen.queryByText("Detail A")).not.toBeInTheDocument();
  });

  it("clears the cached detail after the fallback timeout", () => {
    jest.useFakeTimers();

    try {
      const props = {
        "data-component": DATA_COMPONENT,
        onBack: jest.fn(),
        backLabel: "설정",
        list: <div>List content</div>,
      };
      const { rerender } = render(
        <SlidingCard
          {...props}
          open
          detailKey="detail-a"
          detail={<div>Detail A</div>}
        />,
      );

      rerender(
        <SlidingCard
          {...props}
          open={false}
          detailKey={null}
          detail={null}
        />,
      );
      expect(screen.getByText("Detail A")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(450);
      });

      expect(screen.queryByText("Detail A")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("scrolls for a new detail but not when the detail closes", () => {
    const originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo",
    );
    const scrollTo = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    try {
      const props = {
        "data-component": DATA_COMPONENT,
        open: true,
        onBack: jest.fn(),
        backLabel: "설정",
        list: <div>List content</div>,
      };
      const { rerender } = render(
        <SlidingCard
          {...props}
          detailKey="detail-a"
          detail={<div>Detail A</div>}
        />,
      );
      scrollTo.mockClear();

      rerender(
        <SlidingCard
          {...props}
          detailKey="detail-b"
          detail={<div>Detail B</div>}
        />,
      );

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      scrollTo.mockClear();
      rerender(
        <SlidingCard
          {...props}
          open={false}
          detailKey={null}
          detail={null}
        />,
      );

      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollTo",
          originalScrollTo,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      }
    }
  });

  it("exposes the source identity and the caller-derived component hierarchy", () => {
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={jest.fn()}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<div>Detail content</div>}
      />,
    );

    const root = container.querySelector(
      `[data-component="${DATA_COMPONENT}"]`,
    );
    expect(root).toHaveAttribute("data-source-component", "SlidingCard");

    [
      `${DATA_COMPONENT}_stage`,
      `${DATA_COMPONENT}_stage_list-pane`,
      `${DATA_COMPONENT}_stage_detail-pane`,
      `${DATA_COMPONENT}_stage_detail-pane_header`,
      `${DATA_COMPONENT}_stage_detail-pane_header_back`,
      `${DATA_COMPONENT}_stage_detail-pane_body`,
    ].forEach((componentName) => {
      expect(
        container.querySelector(`[data-component="${componentName}"]`),
      ).toBeInTheDocument();
    });
  });
});

it('removes bottom padding only when the caller opts in', () => {
  const props = {
    "data-component": DATA_COMPONENT,
    open: false,
    onBack: jest.fn(),
    backLabel: "설정",
    detailKey: null,
    list: <div>List content</div>,
    detail: null,
  };
  const { container, rerender } = render(<SlidingCard {...props} />);
  const listPane = container.querySelector('[data-slot="list-pane"]');
  expect(listPane).toHaveClass('listPane');
  expect(listPane).not.toHaveClass('listPaneNoBottomPadding');

  rerender(<SlidingCard {...props} listBottomPadding="none" />);
  expect(listPane).toHaveClass('listPane', 'listPaneNoBottomPadding');
  expect(container.querySelector('[data-slot="detail-pane"]')).not.toHaveClass('listPaneNoBottomPadding');

  rerender(<SlidingCard {...props} />);
  expect(listPane).not.toHaveClass('listPaneNoBottomPadding');
});

it("uses the shared 16px card radius", () => {
  const css = readFileSync(join(__dirname, "../sliding-card.module.css"), "utf8");
  const cardRule = css.match(/\.slidingCard\s*\{[^}]+\}/)?.[0];
  expect(cardRule).toContain("border-radius: calc(16px*var(--glint-ui-scale, 1))");
});
