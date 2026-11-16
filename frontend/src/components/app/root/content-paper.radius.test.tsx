import { render, screen } from "@testing-library/react";

import { ContentPaper } from "./content-paper";

it.each(["default", "v3"] as const)("keeps the %s paper corners at 16px", (variant) => {
  render(<ContentPaper variant={variant}>본문</ContentPaper>);
  expect(screen.getByTestId("ContentPaper")).toHaveClass("rounded-[16px]");
  expect(screen.getByTestId("ContentPaper")).not.toHaveClass("rounded-lg");
});
