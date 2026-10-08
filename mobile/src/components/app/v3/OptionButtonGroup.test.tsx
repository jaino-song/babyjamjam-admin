import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OptionButtonGroup, type OptionButtonGroupProps } from "./OptionButtonGroup";

const BASE = "mobile_test_option-group";

const options = [
  { value: "none", label: "이상없음" },
  { value: "swollen", label: "부종" },
  { value: "pain", label: "통증", disabled: true },
];

function setup(overrides: Partial<OptionButtonGroupProps> = {}) {
  const onToggle = jest.fn();
  const utils = render(
    <>
      <span id="item-title">회음절개부위</span>
      <OptionButtonGroup
        data-component={BASE}
        mode="multi"
        labelledBy="item-title"
        options={options}
        selected={[]}
        onToggle={onToggle}
        {...overrides}
      />
    </>,
  );
  return { onToggle, ...utils };
}

describe("OptionButtonGroup", () => {
  it("multi mode is a labelled group of aria-pressed buttons", () => {
    setup({ selected: ["none"] });

    const group = screen.getByRole("group", { name: "회음절개부위" });
    const none = within(group).getByRole("button", { name: "이상없음" });
    expect(none).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "부종" })).toHaveAttribute("aria-pressed", "false");
    expect(none).toHaveAttribute("type", "button");
  });

  it("single mode is a radiogroup that still uses aria-pressed buttons", () => {
    setup({ mode: "single", selected: ["swollen"] });

    const group = screen.getByRole("radiogroup", { name: "회음절개부위" });
    expect(within(group).queryAllByRole("radio")).toHaveLength(0);
    expect(within(group).getByRole("button", { name: "부종" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "이상없음" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps option names plain (indicator is aria-hidden)", () => {
    const { container } = setup({ selected: ["none"] });
    expect(screen.getByRole("button", { name: "이상없음" })).toBeInTheDocument();
    expect(container.querySelector(`[data-component="${BASE}_option_indicator"]`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("calls onToggle with the value on click, and on keyboard Space and Enter", async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();

    await user.click(screen.getByRole("button", { name: "부종" }));
    expect(onToggle).toHaveBeenLastCalledWith("swollen");

    screen.getByRole("button", { name: "이상없음" }).focus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenLastCalledWith("none");
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it("does not toggle disabled options", async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();

    const pain = screen.getByRole("button", { name: "통증" });
    expect(pain).toBeDisabled();
    await user.click(pain);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("disables every option when the group is disabled", async () => {
    const user = userEvent.setup();
    const { onToggle } = setup({ disabled: true });

    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "이상없음" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("puts firstOptionId only on the first option", () => {
    setup({ firstOptionId: "first-option" });

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("id", "first-option");
    expect(buttons[1]).not.toHaveAttribute("id");
    expect(document.getElementById("first-option")).toBe(buttons[0]);
  });

  it("puts describedBy on every option button, not on the group", () => {
    setup({ describedBy: "item-message" });

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-describedby", "item-message");
    }
    expect(screen.getByRole("group")).not.toHaveAttribute("aria-describedby");
  });

  it("invalid is a visual error border only (no aria-invalid)", () => {
    setup({ invalid: true });

    expect(screen.getByRole("group")).not.toHaveAttribute("aria-invalid");
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("aria-invalid");
    }
    expect(screen.getByRole("button", { name: "부종" })).toHaveClass("border-v3-burgundy");
  });

  it("names its children from the root data-component", () => {
    const { container } = setup();
    expect(container.querySelector(`[data-component="${BASE}"]`)).toHaveAttribute(
      "data-source-component",
      "OptionButtonGroup",
    );
    expect(container.querySelectorAll(`[data-component="${BASE}_option"]`)).toHaveLength(3);
    expect(container.querySelectorAll(`[data-component="${BASE}_option_label"]`)).toHaveLength(3);
  });
});
