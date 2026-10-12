import { fireEvent, render, screen } from "@testing-library/react";

import { CountUnitField, CountUnitFieldRow, type CountUnitFieldProps } from "./CountUnitField";

const BASE = "desktop_service-record-admin_wizard_count-field";

function Harness(props: Partial<CountUnitFieldProps>) {
  return (
    <CountUnitField
      data-component={BASE}
      id="breast-count"
      label="횟수"
      unit="회"
      ariaLabel="모유수유 횟수"
      value=""
      onChange={jest.fn()}
      {...props}
    />
  );
}

describe("CountUnitField", () => {
  it("is found by its ariaLabel, shows label/unit text and is a text input with numeric inputMode", () => {
    render(<Harness value="3" />);

    const input = screen.getByLabelText("모유수유 횟수");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveValue("3");
    expect(screen.getByText("횟수")).toBeInTheDocument();
    expect(screen.getByText("회")).toBeInTheDocument();
  });

  it("is a native number input with min/step when type is number, and a text input otherwise", () => {
    const { rerender } = render(<Harness ariaLabel="체온" type="number" min={30} step={0.1} inputMode="decimal" />);
    const input = screen.getByLabelText("체온");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "30");
    expect(input).toHaveAttribute("step", "0.1");

    rerender(<Harness ariaLabel="체온" min={30} step={0.1} />);
    expect(screen.getByLabelText("체온")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("체온")).not.toHaveAttribute("min");
    expect(screen.getByLabelText("체온")).not.toHaveAttribute("step");
  });

  it("stays unique when the visible label repeats the accessible name", () => {
    render(<Harness label="식사" ariaLabel="식사" unit={undefined} id="meal" />);
    expect(screen.getAllByLabelText(/식사/)).toHaveLength(1);
  });

  it("supports decimal inputMode, placeholder and maxLength", () => {
    render(<Harness ariaLabel="체온" inputMode="decimal" placeholder="36.5" maxLength={4} />);

    const input = screen.getByLabelText("체온");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("placeholder", "36.5");
    expect(input).toHaveAttribute("maxlength", "4");
  });

  it("forwards change, focus and blur", () => {
        const onChange = jest.fn();
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    render(<Harness onChange={onChange} onFocus={onFocus} onBlur={onBlur} />);

    const input = screen.getByLabelText("모유수유 횟수");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith("7");
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("forwards aria-invalid and aria-describedby", () => {
    const { rerender } = render(<Harness invalid describedBy="count-message" />);

    const input = screen.getByLabelText("모유수유 횟수");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "count-message");

    rerender(<Harness />);
    expect(screen.getByLabelText("모유수유 횟수")).not.toHaveAttribute("aria-invalid");
  });

  it("disables the input", () => {
    render(<Harness disabled />);
    expect(screen.getByLabelText("모유수유 횟수")).toBeDisabled();
  });

  it("is one 38px horizontal box with a 13px radius and a 1.35px border", () => {
    const { container } = render(<Harness />);
    const box = container.firstElementChild;
    expect(box?.tagName).toBe("LABEL");
    expect(box).toHaveClass(
      "flex",
      "h-[calc(38px*var(--glint-ui-scale,1))]",
      "rounded-[13px]",
      "border-[1.35px]",
    );
    expect(box).not.toHaveClass("flex-col", "flex-wrap");
    expect(screen.getByLabelText("모유수유 횟수")).toHaveClass("text-right", "font-semibold");
  });

  it("marks an invalid box with the error border", () => {
    const { container } = render(<Harness invalid />);
    expect(container.firstElementChild).toHaveClass("border-v3-burgundy!");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(<Harness />);
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "CountUnitField");
    for (const suffix of ["label", "input", "unit"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});

describe("CountUnitFieldRow", () => {
  it("lays children out as an equal-share horizontal row", () => {
    const { container } = render(
      <CountUnitFieldRow data-component="desktop_service-record-admin_wizard_count-row">
        <Harness id="a" ariaLabel="분유수유 횟수" />
        <Harness id="b" ariaLabel="분유수유 회당" />
      </CountUnitFieldRow>,
    );

    const row = container.firstElementChild;
    expect(row).toHaveAttribute("data-source-component", "CountUnitFieldRow");
    expect(row).toHaveClass("flex", "gap-[calc(8px*var(--glint-ui-scale,1))]", "[&>*]:flex-1");
    expect(screen.getByLabelText("분유수유 횟수")).toBeInTheDocument();
    expect(screen.getByLabelText("분유수유 회당")).toBeInTheDocument();
  });
});
