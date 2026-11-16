import { render } from "@testing-library/react";

import { Card } from "./card";
import { CardShell } from "./card-shell";
import { SurfaceCard } from "./surface-card";

describe("Card surfaces", () => {
  it.each(["default", "v3"] as const)("renders the %s Card with the unified surface", (variant) => {
    const { container } = render(<Card variant={variant}>내용</Card>);

    expect(container.firstElementChild).toHaveAttribute("data-source-component", "Card");
    expect(container.firstElementChild).toHaveClass("bg-white", "border-0", "shadow-v3", "rounded-[16px]");
    expect(container.firstElementChild).not.toHaveClass("rounded-lg", "rounded-[24px]");
  });

  it("applies the 16px radius to SurfaceCard without changing other CardShell consumers", () => {
    const { container, rerender } = render(
      <SurfaceCard animated={false} data-component="desktop_auth_tests_surface-card">내용</SurfaceCard>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-source-component", "SurfaceCard");
    expect(container.firstElementChild).toHaveClass("bg-white", "border-0", "shadow-v3", "rounded-[16px]");
    expect(container.firstElementChild).not.toHaveClass("rounded-[28px]");

    rerender(<CardShell animated={false}>내용</CardShell>);
    expect(container.firstElementChild).toHaveClass("rounded-[28px]");
  });
});
