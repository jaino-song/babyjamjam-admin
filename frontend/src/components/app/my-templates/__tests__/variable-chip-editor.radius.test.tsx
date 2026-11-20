import { render, screen } from "@testing-library/react";

import { VariableChipEditor } from "../variable-chip-editor";

describe("VariableChipEditor radius", () => {
  it.each([
    { state: "default", error: false, disabled: false },
    { state: "error", error: true, disabled: false },
    { state: "disabled", error: false, disabled: true },
  ])("keeps the $state editor corners at 12px", async ({ error, disabled }) => {
    render(
      <VariableChipEditor
        value=""
        onChange={jest.fn()}
        variables={[]}
        error={error}
        disabled={disabled}
      />
    );

    const editor = await screen.findByRole("textbox", { name: "메시지 본문" });
    expect(editor).toHaveClass("rounded-[12px]");
    expect(editor).not.toHaveClass("rounded-[13px]");
  });
});
