import { act, fireEvent, render, screen } from "@testing-library/react";

import { HoverCard } from "./hover-card";

// Radix Popper measures with ResizeObserver, and the touch tests need a
// pointerType on pointer events; jsdom provides neither.
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventPolyfill, configurable: true });
  }
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function renderCard(props: Partial<React.ComponentProps<typeof HoverCard>> = {}) {
  return render(
    <HoverCard
      data-component="desktop_tests_hover-card"
      title="자동 문자가 꺼져 있어요"
      description={
        <>
          <b>송진호</b> 관리사의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.
        </>
      }
      action={{ label: "관리사 정보에서 켜기 →", href: "/employees/7" }}
      {...props}
    >
      <button type="button" disabled>
        재발송
      </button>
    </HoverCard>,
  );
}

const trigger = () => document.querySelector('[data-slot="hover-card-trigger"]') as HTMLElement;
const card = () => document.querySelector('[data-slot="hover-card-content"]');

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe("HoverCard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stays closed until the pointer has hovered ~200ms, then renders title, description and the action link", () => {
    renderCard();
    expect(card()).toBeNull();

    fireEvent.pointerEnter(trigger());
    advance(150);
    expect(card()).toBeNull();
    advance(100);

    const content = card() as HTMLElement;
    expect(content).toHaveAttribute("data-component", "desktop_tests_hover-card");
    expect(content.querySelector('[data-slot="title"]')).toHaveTextContent("자동 문자가 꺼져 있어요");
    expect(content.querySelector('[data-slot="description"]')).toHaveTextContent(
      "송진호 관리사의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.",
    );
    const link = content.querySelector('[data-slot="action"]');
    expect(link).toHaveAttribute("href", "/employees/7");
    expect(link).toHaveTextContent("관리사 정보에서 켜기 →");
  });

  it("closes ~100ms after the pointer leaves, and stays open while it is over the card", () => {
    renderCard();
    fireEvent.pointerEnter(trigger());
    advance(250);
    expect(card()).not.toBeNull();

    fireEvent.pointerLeave(trigger());
    fireEvent.pointerEnter(card() as HTMLElement);
    advance(300);
    expect(card()).not.toBeNull();

    fireEvent.pointerLeave(card() as HTMLElement);
    advance(150);
    expect(card()).toBeNull();
  });

  it("opens on keyboard focus of the wrapper, links it with aria-describedby and closes on Escape", () => {
    renderCard();
    expect(trigger()).toHaveAttribute("tabindex", "0");
    expect(trigger()).not.toHaveAttribute("aria-describedby");

    fireEvent.focus(trigger());
    advance(250);
    const content = card() as HTMLElement;
    expect(content).not.toBeNull();
    expect(trigger()).toHaveAttribute("aria-describedby", content.id);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(card()).toBeNull();
    expect(trigger()).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the inner button disabled", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "재발송" })).toBeDisabled();
  });

  it("applies the tone classes and omits the action link when none is given", () => {
    const { unmount } = renderCard({ action: undefined, tone: "info" });
    fireEvent.pointerEnter(trigger());
    advance(250);
    const content = card() as HTMLElement;
    expect(content).toHaveAttribute("data-tone", "info");
    expect(content.querySelector(".bg-v3-primary-light")).not.toBeNull();
    expect(content.querySelector(".bg-status-warning")).toBeNull();
    expect(content.querySelector('[data-slot="action"]')).toBeNull();
    unmount();

    renderCard();
    fireEvent.pointerEnter(trigger());
    advance(250);
    expect((card() as HTMLElement).querySelector(".bg-status-warning")).not.toBeNull();
    expect(card()).toHaveAttribute("data-tone", "warning");
  });

  it("toggles on a touch tap and ignores the focus-driven open that follows the tap", () => {
    renderCard();

    fireEvent.pointerDown(trigger(), { pointerType: "touch" });
    fireEvent.pointerUp(trigger(), { pointerType: "touch" });
    expect(card()).not.toBeNull();

    // Compat events after a tap: Radix would try to open on focus.
    fireEvent.focus(trigger());
    advance(300);
    expect(card()).not.toBeNull();

    // A second tap on the trigger closes it again.
    fireEvent.pointerDown(trigger(), { pointerType: "touch" });
    fireEvent.pointerUp(trigger(), { pointerType: "touch" });
    expect(card()).toBeNull();
  });

  it("closes an open touch card on an outside tap", () => {
    renderCard();
    fireEvent.pointerDown(trigger(), { pointerType: "touch" });
    fireEvent.pointerUp(trigger(), { pointerType: "touch" });
    expect(card()).not.toBeNull();

    advance(800);
    // Radix defers a touch outside-press to the click that follows it.
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.click(document.body);
    expect(card()).toBeNull();
  });
});
