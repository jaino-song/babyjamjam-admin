import { render, screen } from "@testing-library/react";

import { MobileDetailActions } from "../detail-sheet";

describe("MobileDetailActions", () => {
  it("disables button actions without a click handler or href", () => {
    render(
      <MobileDetailActions
        name="messages"
        actions={[{ label: "재발송", variant: "secondary" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "재발송" })).toBeDisabled();
  });
});
