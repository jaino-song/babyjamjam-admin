import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { Button } from "../button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../sheet";
import { useSheetExit } from "../use-sheet-exit";

function TestSheet({ after, second }: { after: () => void; second?: () => void }) {
  const { open, close, exitWatcher } = useSheetExit();
  return (
    <Sheet open={open}>
      <SheetContent side="bottom" inert={!open || undefined}>
        {exitWatcher}
        <SheetTitle>Exit test</SheetTitle>
        <SheetDescription>Sheet exit lifecycle</SheetDescription>
        <Button onClick={() => {
          close(after);
          if (second) close(second);
        }}>Close</Button>
      </SheetContent>
    </Sheet>
  );
}

function stubAnimations() {
  const getComputedStyle = window.getComputedStyle.bind(window);
  jest.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement);
    return new Proxy(style, {
      get(target, property) {
        if (property === "animationName") {
          const closed = element.getAttribute("data-state") === "closed";
          if (element.getAttribute("data-slot") === "sheet-content") {
            return closed ? "sheet-slide-out-to-bottom" : "sheet-slide-in-from-bottom";
          }
          if (element.getAttribute("data-slot") === "sheet-overlay") {
            return closed ? "sheet-fade-out" : "sheet-fade-in";
          }
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

function getOverlay() {
  const overlay = document.querySelector('[data-slot="sheet-overlay"]');
  if (!(overlay instanceof HTMLElement)) throw new Error("Sheet overlay is missing");
  return overlay;
}

function endAnimation(element: HTMLElement, animationName: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(element, event);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useSheetExit", () => {
  it("calls after exactly once when the dialog unmounts without an animation", () => {
    const after = jest.fn();
    render(<TestSheet after={after} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(after).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a second close request before the content unmounts", () => {
    const after = jest.fn();
    const second = jest.fn();
    render(<TestSheet after={after} second={second} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(after).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not call after on a StrictMode remount or an owner unmount without close", () => {
    const after = jest.fn();
    const owner = render(<StrictMode><TestSheet after={after} /></StrictMode>);
    expect(after).not.toHaveBeenCalled();

    owner.unmount();

    expect(after).not.toHaveBeenCalled();
  });

  it("keeps the closed dialog inert and waits for the exit animation before calling after", () => {
    stubAnimations();
    const after = jest.fn();
    render(<TestSheet after={after} />);
    const dialog = screen.getByRole("dialog");
    const overlay = getOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-state", "closed");
    expect(dialog).toHaveAttribute("inert");
    expect(after).not.toHaveBeenCalled();

    endAnimation(dialog, "sheet-slide-out-to-bottom");
    endAnimation(overlay, "sheet-fade-out");

    expect(dialog).not.toBeInTheDocument();
    expect(overlay).not.toBeInTheDocument();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("drops after when the owner unmounts before its exit animation ends", () => {
    stubAnimations();
    const after = jest.fn();
    const owner = render(<TestSheet after={after} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("data-state", "closed");
    expect(after).not.toHaveBeenCalled();
    owner.unmount();

    expect(after).not.toHaveBeenCalled();
  });
});
