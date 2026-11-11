import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "radix-ui";
import { AnchoredNotificationModalShell } from "./AnchoredNotificationModalShell";

const base = "desktop_chrome_sidebar_notifications-modal";
const close = jest.fn();
const originalObserver = global.ResizeObserver;
function Harness({ open = true, preferredHeight, children, onEscapeKeyDown }: { open?: boolean; preferredHeight?: number; children?: React.ReactNode; onEscapeKeyDown?: (event: KeyboardEvent) => void }) {
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  return <><button ref={anchorRef}>Trigger</button><AnchoredNotificationModalShell open={open} onClose={close} anchorRef={anchorRef} label="알림" data-component={base} preferredHeight={preferredHeight} onEscapeKeyDown={onEscapeKeyDown}>
    <header>Caller header</header><button>First</button>{children}<button>Last</button>
  </AnchoredNotificationModalShell></>;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { left: 800, top: 40, bottom: 72, height: this.getAttribute("role") === "dialog" ? 300 : 32 } as DOMRect;
  });
});
afterEach(() => { jest.restoreAllMocks(); global.ResizeObserver = originalObserver; });

it("renders only when open and places the caller's complete header/body in the named dialog", () => {
  const { rerender } = render(<Harness open={false} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<Harness />);
  const panel = screen.getByRole("dialog", { name: "알림" });
  expect(panel).toHaveAttribute("aria-modal", "true");
  expect(panel).toHaveClass("w-[25rem]", "max-w-[calc(100vw-24px)]", "rounded-[28px]", "shadow-v3", "z-[1000]");
  expect(document.querySelector('[data-slot="anchored-notification-backdrop"]')).toHaveClass("z-[999]", "bg-slate-950/34", "backdrop-blur-[2px]");
  expect(panel).toContainElement(screen.getByText("Caller header"));
  expect(panel).toHaveAttribute("data-component", base);
  expect(document.querySelector('[data-slot="anchored-notification-backdrop"]')).toHaveAttribute("data-component", "desktop_chrome_sidebar_notifications-modal_backdrop");
  expect(panel).toHaveAttribute("data-source-component", "AnchoredNotificationModalShell");
  expect(panel).toHaveStyle({ top: "84px", left: "612px", maxHeight: "672px" });
});

it.each([{}, { "data-component": "" }])("omits owned namespace attributes for %j without changing the real dialog", async (metadata) => {
  const anchorRef = React.createRef<HTMLButtonElement>();
  const content = (open: boolean, child?: React.ReactNode) => <><button ref={anchorRef}>Optional trigger</button>
    <AnchoredNotificationModalShell open={open} onClose={close} anchorRef={anchorRef} label="Optional notifications" {...metadata}>
      <header>Optional header</header><button>Optional action</button>{child}
    </AnchoredNotificationModalShell></>;
  const { rerender } = render(content(true));
  const panel = screen.getByRole("dialog", { name: "Optional notifications" });
  expect(panel).toHaveAttribute("data-source-component", "AnchoredNotificationModalShell");
  expect(panel).toHaveAttribute("aria-modal", "true");
  expect(document.querySelector('[data-slot="anchored-notification-backdrop"]')).toBeInTheDocument();
  expect(document.querySelectorAll("[data-component]")).toHaveLength(0);
  expect(panel).toHaveStyle({ top: "84px", left: "612px", maxHeight: "672px" });
  rerender(content(true, <span data-component="caller_authored_child">Caller child</span>));
  expect(screen.getByText("Caller child")).toHaveAttribute("data-component", "caller_authored_child");
  expect(document.querySelectorAll("[data-component]")).toHaveLength(1);
  fireEvent.keyDown(screen.getByText("Optional action"), { key: "Escape" });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  rerender(content(false));
  await waitFor(() => expect(screen.getByText("Optional trigger")).toHaveFocus());
});

it("caps preferred height, flips/clamps on resize and keeps notifications naturally sized", () => {
  const { rerender } = render(<Harness preferredHeight={500} />);
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "500px" });
  act(() => {
    Object.defineProperty(window, "innerHeight", { value: 220 });
    Object.defineProperty(window, "innerWidth", { value: 320 });
    fireEvent(window, new Event("resize"));
  });
  expect(screen.getByRole("dialog")).toHaveStyle({ top: "12px", left: "12px", height: "196px", maxHeight: "196px" });
  rerender(<Harness />);
  expect(screen.getByRole("dialog").style.height).toBe("");
});

it("flips above a low anchor when the panel fits above it", () => {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 650, bottom: 682, height: 300 } as DOMRect);
  render(<Harness preferredHeight={300} />);
  expect(screen.getByRole("dialog")).toHaveStyle({ top: "338px" });
});

it("traps both Tab directions, preserves focus on data updates and returns focus on close", async () => {
  const { rerender } = render(<Harness />);
  const first = screen.getByRole("button", { name: "First" });
  const last = screen.getByRole("button", { name: "Last" });
  await waitFor(() => expect(first).toHaveFocus());
  first.focus(); fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  last.focus(); rerender(<Harness><p>Updated data</p></Harness>);
  expect(last).toHaveFocus();
  rerender(<Harness open={false} />);
  await waitFor(() => expect(screen.getByText("Trigger")).toHaveFocus());
});

it("closes with Escape/backdrop but respects the owner's prevented Escape", async () => {
  const back = jest.fn((event: KeyboardEvent) => event.preventDefault());
  const { rerender } = render(<Harness onEscapeKeyDown={back} />);
  fireEvent.keyDown(screen.getByText("First"), { key: "Escape" });
  expect(back).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  rerender(<Harness />);
  fireEvent.keyDown(screen.getByText("First"), { key: "Escape" });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  fireEvent.pointerDown(document.querySelector(`[data-slot="anchored-notification-backdrop"]`)!, { button: 0 });
  expect(close).toHaveBeenCalledTimes(2);
});

it("lets a higher nested dialog own Escape and retains pre-existing hidden/scroll state", async () => {
  document.body.style.overflow = "hidden";
  const protectedNode = document.createElement("aside");
  protectedNode.setAttribute("aria-hidden", "true"); protectedNode.setAttribute("inert", "");
  document.body.append(protectedNode);
  const { rerender } = render(<Harness><Dialog.Root defaultOpen><Dialog.Portal><Dialog.Overlay /><Dialog.Content aria-describedby={undefined}><Dialog.Title>Nested</Dialog.Title><button>Nested action</button></Dialog.Content></Dialog.Portal></Dialog.Root></Harness>);
  fireEvent.keyDown(screen.getByText("Nested action"), { key: "Escape" });
  await act(async () => {});
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("Nested action")).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "알림" })).toBeInTheDocument();
  rerender(<Harness open={false} />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(protectedNode).toHaveAttribute("aria-hidden", "true");
  expect(protectedNode).toHaveAttribute("inert");
  expect(document.body.style.overflow).toBe("hidden");
  protectedNode.remove(); document.body.style.overflow = "";
});

it("does not steal focus from a higher dialog when externally closed", async () => {
  const higher = <Dialog.Root open><Dialog.Portal><Dialog.Overlay /><Dialog.Content aria-describedby={undefined}><Dialog.Title>Higher</Dialog.Title><button>Higher action</button></Dialog.Content></Dialog.Portal></Dialog.Root>;
  const { rerender } = render(<Harness />);
  rerender(<><Harness />{higher}</>);
  await waitFor(() => expect(screen.getByText("Higher action")).toHaveFocus());
  const triggerFocus = jest.spyOn(screen.getByText("Trigger"), "focus");
  rerender(<><Harness open={false} />{higher}</>);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(triggerFocus).not.toHaveBeenCalled();
  expect(screen.getByText("Higher action")).toHaveFocus();
});

it("tracks natural-content resizing but never remeasures a preferred-height panel", () => {
  const observe = jest.fn(), disconnect = jest.fn();
  let resized!: ResizeObserverCallback;
  global.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
    resized = callback;
    return { observe, disconnect, unobserve: jest.fn() };
  }) as unknown as typeof ResizeObserver;
  const { rerender } = render(<Harness />);
  const panel = screen.getByRole("dialog");
  expect(observe).toHaveBeenCalledWith(panel);
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 650, bottom: 682, height: 300 } as DOMRect);
  act(() => resized([], {} as ResizeObserver));
  expect(panel).toHaveStyle({ top: "338px" });
  rerender(<Harness preferredHeight={500} />);
  expect(disconnect).toHaveBeenCalled();
  const measured = jest.fn();
  Object.defineProperty(panel, "getBoundingClientRect", { configurable: true, value: measured });
  fireEvent(window, new Event("resize"));
  expect(measured).not.toHaveBeenCalled();
  const anchorMeasured = jest.fn().mockReturnValue({ left: 20, top: 650, bottom: 682, height: 32 });
  Object.defineProperty(screen.getByText("Trigger"), "getBoundingClientRect", { configurable: true, value: anchorMeasured });
  rerender(<Harness preferredHeight={500}><p>Updated jobs</p></Harness>);
  expect(anchorMeasured).not.toHaveBeenCalled();
  expect(measured).not.toHaveBeenCalled();
});

it("remeasures natural growth after a content commit even when the capped box cannot resize", () => {
  Object.defineProperty(window, "innerHeight", { value: 700 });
  let naturalHeight = 620;
  const observeCappedPanel = jest.fn();
  global.ResizeObserver = jest.fn(() => ({
    observe: observeCappedPanel,
    disconnect: jest.fn(),
    unobserve: jest.fn(),
  })) as unknown as typeof ResizeObserver;
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") !== "dialog") {
      return { left: 800, top: 40, bottom: 72, height: 32 } as DOMRect;
    }
    // Model CSS max-height: a capped panel cannot notify ResizeObserver of hidden growth.
    return { height: Math.min(naturalHeight, Number.parseFloat(this.style.maxHeight)) } as DOMRect;
  });
  const { rerender } = render(<Harness><p>Loading list</p></Harness>);
  const panel = screen.getByRole("dialog");
  expect(panel).toHaveStyle({ top: "68px", maxHeight: "620px" });
  expect(observeCappedPanel).toHaveBeenCalledWith(panel);
  naturalHeight = 660;
  expect(panel.getBoundingClientRect().height).toBe(620);
  rerender(<Harness><p>Loaded list</p></Harness>);
  expect(panel).toHaveStyle({ top: "28px", maxHeight: "660px" });
  expect(panel.getBoundingClientRect().height).toBe(660);
});
