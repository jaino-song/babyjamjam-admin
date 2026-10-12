import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

import { StickyActionBar } from "./StickyActionBar";

const BASE = "desktop_service-record-admin_wizard_action-bar";

describe("StickyActionBar", () => {
  it("is sticky to the bottom of the scroll container, not fixed", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="default">다음</Button>
      </StickyActionBar>,
    );

    const bar = container.firstElementChild;
    expect(bar).toHaveAttribute("data-source-component", "StickyActionBar");
    expect(bar).toHaveClass("sticky", "bottom-0", "z-10", "border-t", "flex", "bg-white");
    expect(bar).not.toHaveClass("fixed");
    expect(bar?.className).not.toContain("safe-area");
  });

  it("shares the width equally below sm and right-aligns natural-width children from sm up", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="outline">이전</Button>
        <Button variant="default">다음</Button>
      </StickyActionBar>,
    );

    expect(container.firstElementChild).toHaveClass(
      "[&>*]:flex-1",
      "sm:[&>*]:flex-none",
      "sm:justify-end",
      "px-[calc(16px*var(--glint-ui-scale,1))]",
      "sm:px-[calc(24px*var(--glint-ui-scale,1))]",
    );
    expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeInTheDocument();
  });

  it("renders the leading slot before the children", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE} leading={<Button variant="outline">기본정보 수정</Button>}>
        <Button variant="default">확인</Button>
      </StickyActionBar>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["기본정보 수정", "확인"]);
    const leading = container.querySelector(`[data-component="${BASE}_leading"]`);
    expect(leading).not.toBeNull();
    expect(leading).toContainElement(buttons[0]);
    expect(leading).toHaveClass("sm:mr-auto");
    expect(container.firstElementChild?.firstElementChild).toBe(leading);
  });

  it("renders no leading wrapper without the slot", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="default">확인</Button>
      </StickyActionBar>,
    );
    expect(container.querySelector(`[data-component="${BASE}_leading"]`)).toBeNull();
  });

  it("renders role=group with a name only when aria-label is given", () => {
    const { rerender } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="default">다음</Button>
      </StickyActionBar>,
    );
    expect(screen.queryByRole("group")).toBeNull();

    rerender(
      <StickyActionBar data-component={BASE} aria-label="페이지 이동">
        <Button variant="default">다음</Button>
      </StickyActionBar>,
    );
    expect(screen.getByRole("group", { name: "페이지 이동" })).toBeInTheDocument();
  });
});
