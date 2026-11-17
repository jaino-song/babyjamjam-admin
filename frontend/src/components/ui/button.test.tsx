import { render, screen } from "@testing-library/react";

import { Button } from "./button";

describe("Button sizing", () => {
  it("renders a 32px icon button with an invisible hit area", () => {
    render(<Button size="icon" aria-label="열기" />);

    expect(screen.getByRole("button", { name: "열기" })).toHaveClass(
      "h-[calc(32px*var(--glint-ui-scale,1))]",
      "w-[calc(32px*var(--glint-ui-scale,1))]",
      "p-0",
      "relative",
      "after:absolute",
      "after:left-1/2",
      "after:top-1/2",
      "after:h-[calc(44px*var(--glint-ui-scale,1))]",
      "after:w-[calc(44px*var(--glint-ui-scale,1))]",
      "after:-translate-x-1/2",
      "after:-translate-y-1/2",
      "after:content-['']",
      "[&_svg]:size-4",
    );
  });

  it.each([
    [undefined, "px-4", "text-sm"],
    ["default", "px-4", "text-sm"],
    ["md", "px-6", "text-sm"],
    ["lg", "px-8", "text-base"],
  ] as const)("renders size %s at 40px with its original padding and font", (size, padding, font) => {
    render(<Button size={size}>저장</Button>);

    expect(screen.getByRole("button", { name: "저장" })).toHaveClass(
      "h-[calc(40px*var(--glint-ui-scale,1))]",
      "rounded-full",
      padding,
      font,
    );
  });
});
