import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormChip, FormTextInput } from "../form-section";

function SelectionFixture() {
  const [selected, setSelected] = useState("고객");
  return (
    <>
      {["고객", "주 제공인력"].map((label) => (
        <FormChip
          key={label}
          data-component={`desktop_test_recipient-chip_${label === "고객" ? "client" : "primary"}`}
          selected={selected === label}
          onClick={() => setSelected(label)}
        >
          {label}
        </FormChip>
      ))}
    </>
  );
}

describe("FormChip selection frame", () => {
  it("switches selection without submitting and restores the old chip's gray hover frame", () => {
    const onSubmit = jest.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><SelectionFixture /></form>);
    const client = screen.getByRole("button", { name: "고객" });
    const primary = screen.getByRole("button", { name: "주 제공인력" });

    expect(client).toHaveAttribute("aria-pressed", "true");
    expect(client).toHaveAttribute("data-selected", "true");
    expect(client).toHaveAttribute("data-source-component", "FormChip");
    expect(client).toHaveAttribute("data-slot", "form-chip");
    expect(client).toHaveClass("border-2", "border-v3-primary", "bg-v3-primary-light", "hover:border-v3-primary", "hover:bg-v3-primary-light");
    expect(primary).toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border", "hover:bg-white");

    fireEvent.click(primary);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(primary).toHaveAttribute("aria-pressed", "true");
    expect(primary).toHaveAttribute("data-selected", "true");
    expect(client).toHaveAttribute("aria-pressed", "false");
    expect(client).toHaveAttribute("data-selected", "false");
    expect(client).toHaveClass("border-v3-selectable-border", "hover:border-v3-selectable-border", "bg-white");
    expect(client).not.toHaveClass("border-v3-primary", "bg-v3-primary-light");
    for (const chip of [client, primary]) {
      expect(chip).toHaveClass("focus-visible:ring-2", "focus-visible:ring-v3-primary", "focus-visible:ring-offset-2");
    }
  });

  it("preserves native disabled behavior", () => {
    const onClick = jest.fn();
    render(<FormChip selected disabled onClick={onClick}>제공인력</FormChip>);
    const chip = screen.getByRole("button", { name: "제공인력" });
    fireEvent.click(chip);
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the text input's independent border and focus treatment", () => {
    render(<FormTextInput aria-label="이름" />);
    const input = screen.getByRole("textbox", { name: "이름" });
    expect(input).toHaveClass("border-[1.35px]", "border-input", "focus-visible:ring-inset");
    expect(input).not.toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border");
    expect(input).not.toHaveAttribute("data-selected");
  });
});
