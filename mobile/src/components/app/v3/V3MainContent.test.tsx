import { render } from "@testing-library/react";

import { V3MainContent } from "./V3MainContent";

const mockUsePathname = jest.fn(() => "/dashboard");

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("V3MainContent", () => {
  it("removes the outer content padding on the consultations route", () => {
    mockUsePathname.mockReturnValue("/consultations");

    const { container } = render(
      <V3MainContent data-component="mobile_shell_main-content">content</V3MainContent>,
    );
    const main = container.querySelector('[data-component="mobile_shell_main-content"]');

    expect(main).toHaveClass("p-0", "pt-20");
    expect(main).not.toHaveClass("p-4", "pb-24");
  });

  it("keeps the default shell padding on other routes", () => {
    mockUsePathname.mockReturnValue("/dashboard");

    const { container } = render(
      <V3MainContent data-component="mobile_shell_main-content">content</V3MainContent>,
    );
    const main = container.querySelector('[data-component="mobile_shell_main-content"]');

    expect(main).toHaveClass("p-4", "pb-24", "pt-20");
  });
});
