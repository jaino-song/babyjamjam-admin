import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

import { ActionRow } from "./action-row";
import { Button } from "./button";

it("keeps padded actions in exact grid tracks and forwards caller context", () => {
  const { container } = render(<ActionRow data-component="mobile_test_modal_actions" className="mt-5"><Button className="px-2">취소</Button><Button className="px-8">진행</Button></ActionRow>);
  const row = container.firstElementChild;
  expect(row).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]", "[&>*]:min-w-0", "mt-5");
  expect(row).not.toHaveClass("grid!");
  expect(row).toHaveAttribute("data-component", "mobile_test_modal_actions");
  expect(row).toHaveAttribute("data-slot", "action-row");
  expect(row).toHaveAttribute("data-source-component", "ActionRow");
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["취소", "진행"]);
});

it("allows callers to hide the row or change its display at a breakpoint", () => {
  const { container, rerender } = render(<ActionRow className="hidden" />);
  expect(container.firstElementChild).toHaveClass("hidden");
  expect(container.firstElementChild).not.toHaveClass("grid");
  expect(container.firstElementChild).not.toHaveClass("grid!");

  rerender(<ActionRow className="sm:flex" />);
  expect(container.firstElementChild).toHaveClass("grid", "sm:flex");
  expect(container.firstElementChild).not.toHaveClass("grid!");
});

it.each(["auth-actions", "detail-actions"])("keeps exact grid tracks in %s without overriding hidden rows", (className) => {
  const css = readFileSync(join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"), "utf8");
  const style = document.createElement("style");
  // jsdom does not load Tailwind; include the display utilities before the real unlayered row rules.
  style.textContent = `.grid { display: grid; } .hidden { display: none; }\n${
    css.match(/[^{}]*\.(?:auth-actions|detail-actions)[^{}]*\{[^{}]*\}/g)?.join("\n") ?? ""
  }`;
  document.head.append(style);

  try {
    const { container, rerender } = render(
      <div data-slot="auth-register-page">
        <ActionRow className={className}><Button>이전</Button><Button>다음</Button></ActionRow>
        <div className={className}>Single action</div>
      </div>,
    );
    const row = container.querySelector<HTMLElement>(`[data-slot="action-row"]`)!;
    expect(getComputedStyle(row).display).toBe("grid");
    expect(row).toHaveClass("grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
    expect(getComputedStyle(row.nextElementSibling!).display).toBe("flex");

    rerender(<div data-slot="auth-register-page"><ActionRow className={`${className} hidden`} /></div>);
    expect(getComputedStyle(container.querySelector('[data-slot="action-row"]')!).display).toBe("none");
  } finally {
    style.remove();
  }
});
