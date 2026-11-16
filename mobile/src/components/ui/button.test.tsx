import { render, screen } from "@testing-library/react";

import { Button } from "./button";

describe("Button", () => {
  it("renders a 32px icon button with an invisible 44px hit area", () => {
    render(<Button size="icon" aria-label="닫기">×</Button>);

    expect(screen.getByRole("button", { name: "닫기" })).toHaveClass(
      "h-8", "w-8", "p-0", "relative", "after:absolute", "after:-inset-1.5", "after:content-['']",
    );
  });

  it.each([
    ["default", "px-4", "text-sm"],
    ["md", "px-6", "text-sm"],
    ["lg", "px-8", "text-base"],
  ] as const)("renders size %s as a 40px pill with its existing padding and font", (size, padding, font) => {
    render(<Button size={size}>확인</Button>);

    expect(screen.getByRole("button")).toHaveClass("h-10", "rounded-full", padding, font);
  });

  it("keeps the small button height", () => {
    render(<Button size="sm">확인</Button>);
    expect(screen.getByRole("button")).toHaveClass("h-9", "px-3", "text-xs");
  });

  it("allows service-record callers to retain their previous height and radius", () => {
    render(<Button size="md" className="h-[46px] rounded-2xl">다음</Button>);

    expect(screen.getByRole("button")).toHaveClass("h-[46px]", "rounded-2xl");
    expect(screen.getByRole("button")).not.toHaveClass("h-10", "rounded-full");
  });
});
