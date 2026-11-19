import { render, screen } from "@testing-library/react";

import NewTemplatePage from "./page";

it("keeps the asChild back link at 32px with a 44px hit area", () => {
  render(<NewTemplatePage />);
  const back = screen.getAllByRole("link").find((link) => link.getAttribute("data-size") === "icon");
  expect(back).toHaveAttribute("href", "/messages/templates");
  expect(back).toHaveClass("relative", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']");
  expect(back).not.toHaveClass("h-[44px]", "w-[44px]");
});
