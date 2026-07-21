import { render, screen } from "@testing-library/react";

import { ListCardHeader } from "../ListCardHeader";

describe("ListCardHeader", () => {
  it("preserves the list title DOM contract with a disabled submit action", () => {
    const { container } = render(
      <ListCardHeader
        title="새 메시지"
        actionLabel="즉시 발송"
        actionType="submit"
        actionDisabled
      />,
    );

    expect(container.querySelector('[data-component="mobile-redesign-list-title"]'))
      .toHaveClass("list-title");
    expect(screen.getByRole("button", { name: "즉시 발송" }))
      .toHaveAttribute("data-component", "mobile-redesign-list-action");
    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
  });
});
