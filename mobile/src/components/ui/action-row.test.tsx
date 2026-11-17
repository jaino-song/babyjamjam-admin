import { render, screen } from "@testing-library/react";

import { ActionRow } from "./action-row";
import { Button } from "./button";

it("keeps padded actions in exact grid tracks and forwards caller context", () => {
  const { container } = render(<ActionRow data-component="mobile_test_modal_actions" className="mt-5"><Button className="px-2">취소</Button><Button className="px-8">진행</Button></ActionRow>);
  const row = container.firstElementChild;
  expect(row).toHaveClass("grid!", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]", "[&>*]:min-w-0", "mt-5");
  expect(row).toHaveAttribute("data-component", "mobile_test_modal_actions");
  expect(row).toHaveAttribute("data-slot", "action-row");
  expect(row).toHaveAttribute("data-source-component", "ActionRow");
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["취소", "진행"]);
});
