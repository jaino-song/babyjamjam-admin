import { fireEvent, render, screen, within } from "@testing-library/react";

import { OptionButtonGroup, type OptionButtonGroupProps } from "./OptionButtonGroup";

const BASE = "desktop_service-record-admin_wizard_option-group";

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
    expect(container.querySelector(`[data-component="${BASE}_option-0_indicator"]`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("calls onToggle with the value on click; options are native buttons so Space and Enter work", () => {
        const { onToggle } = setup();

    fireEvent.click(screen.getByRole("button", { name: "부종" }));
    expect(onToggle).toHaveBeenLastCalledWith("swollen");

    fireEvent.click(screen.getByRole("button", { name: "이상없음" }));
    expect(onToggle).toHaveBeenLastCalledWith("none");
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "이상없음" })).toHaveAttribute("type", "button");
  });

  it("does not toggle disabled options", () => {
        const { onToggle } = setup();

    const pain = screen.getByRole("button", { name: "통증" });
    expect(pain).toBeDisabled();
    fireEvent.click(pain);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("disables every option when the group is disabled", () => {
        const { onToggle } = setup({ disabled: true });

    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "이상없음" }));
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
    expect(screen.getByRole("button", { name: "부종" })).toHaveClass("border-v3-burgundy!");
  });

  it("uses the admin option sizing: 36px, 12px radius, 12.5px text, 6px gap", () => {
    const { container } = setup();
    expect(screen.getByRole("group")).toHaveClass("flex-wrap", "gap-[calc(6px*var(--glint-ui-scale,1))]");
    const button = screen.getByRole("button", { name: "이상없음" });
    expect(button).toHaveClass(
      "min-h-[calc(36px*var(--glint-ui-scale,1))]",
      "rounded-[12px]",
      "text-[calc(12.5px*var(--glint-ui-scale,1))]",
    );
    expect(container.querySelector(`[data-component="${BASE}_option-0_indicator"]`)).toHaveClass("rounded-[5px]");
  });

  it("shapes the indicator round in single mode", () => {
    const { container } = setup({ mode: "single", selected: ["none"] });
    const indicator = container.querySelector(`[data-component="${BASE}_option-0_indicator"]`);
    expect(indicator).toHaveClass("rounded-full");
    expect(indicator).toHaveTextContent("●");
  });

  it("names its children from the root data-component, one unique base per option", () => {
    const { container } = setup();
    expect(container.querySelector(`[data-component="${BASE}"]`)).toHaveAttribute(
      "data-source-component",
      "OptionButtonGroup",
    );
    options.forEach((_, index) => {
      const optionBase = `${BASE}_option-${index}`;
      expect(container.querySelectorAll(`[data-component="${optionBase}"]`)).toHaveLength(1);
      expect(container.querySelectorAll(`[data-component="${optionBase}_indicator"]`)).toHaveLength(1);
      expect(container.querySelectorAll(`[data-component="${optionBase}_label"]`)).toHaveLength(1);
    });
  });

  it("gives every element a unique data-component value", () => {
    const { container } = setup({ selected: ["none"] });
    const values = Array.from(container.querySelectorAll("[data-component]")).map((el) =>
      el.getAttribute("data-component"),
    );
    expect(new Set(values).size).toBe(values.length);
  });
});
