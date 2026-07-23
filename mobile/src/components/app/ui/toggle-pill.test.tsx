import { fireEvent, render, screen } from "@testing-library/react";

import { TogglePill } from "./toggle-pill";

describe("TogglePill", () => {
  it("renders the current customer type and changes to self-pay", () => {
    const onValueChange = jest.fn();

    render(
      <TogglePill
        value
        onValueChange={onValueChange}
        leftLabel="바우처 고객"
        rightLabel="자부담 고객"
        ariaLabel="고객 유형"
      />,
    );

    expect(screen.getByRole("tab", { name: "바우처 고객" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "자부담 고객" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "자부담 고객" }));

    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it("supports arrow-key switching between the two values", () => {
    const onValueChange = jest.fn();

    render(
      <TogglePill
        value={false}
        onValueChange={onValueChange}
        leftLabel="바우처 고객"
        rightLabel="자부담 고객"
        ariaLabel="고객 유형"
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "자부담 고객" }), { key: "ArrowLeft" });

    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
