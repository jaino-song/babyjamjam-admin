import { render, screen } from "@testing-library/react";

import { MobileBottomNav } from "../mobile-bottom-nav";

const mockUsePathname = jest.fn();
const mockUseReducedMotion = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

jest.mock("framer-motion", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

describe("MobileBottomNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
  });

  it("marks All active on the All route", () => {
    mockUsePathname.mockReturnValue("/all");

    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
  });

  it("does not mark All active on notification settings", () => {
    mockUsePathname.mockReturnValue("/notification");

    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the All indicator position when fading out on child pages", () => {
    mockUsePathname.mockReturnValue("/all");
    const { container, rerender } = render(<MobileBottomNav />);
    const indicator = container.querySelector('[data-component="mobile-bottom-indicator"]');

    expect(indicator).toHaveStyle({
      opacity: "1",
      transform: "translate3d(calc(400% + 8px), 0, 0)",
    });

    mockUsePathname.mockReturnValue("/notification");
    rerender(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).not.toHaveAttribute("aria-current");
    expect(indicator).toHaveStyle({
      opacity: "0",
      transform: "translate3d(calc(400% + 8px), 0, 0)",
      transition: "opacity 140ms ease-out",
    });
  });
});
