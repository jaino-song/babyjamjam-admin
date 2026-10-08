import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

import { StickyActionBar } from "./StickyActionBar";

const BASE = "mobile_test_action-bar";

describe("StickyActionBar", () => {
  it("is sticky to the bottom of the scroll container, not fixed", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="v3">다음</Button>
      </StickyActionBar>,
    );

    const bar = container.firstElementChild;
    expect(bar).toHaveAttribute("data-source-component", "StickyActionBar");
    expect(bar).toHaveClass("sticky", "bottom-0", "border-t", "flex", "gap-2");
    expect(bar).not.toHaveClass("fixed");
    expect(bar?.className).toContain("env(safe-area-inset-bottom)");
  });

  it("makes each child button take an equal share", () => {
    const { container } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="v3-soft">이전</Button>
        <Button variant="v3">다음</Button>
      </StickyActionBar>,
    );

    expect(container.firstElementChild).toHaveClass("[&>*]:flex-1");
    expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeInTheDocument();
  });

  it("renders role=group with a name only when aria-label is given", () => {
    const { rerender } = render(
      <StickyActionBar data-component={BASE}>
        <Button variant="v3">다음</Button>
      </StickyActionBar>,
    );
    expect(screen.queryByRole("group")).toBeNull();

    rerender(
      <StickyActionBar data-component={BASE} aria-label="페이지 이동">
        <Button variant="v3">다음</Button>
      </StickyActionBar>,
    );
    expect(screen.getByRole("group", { name: "페이지 이동" })).toBeInTheDocument();
  });
});
