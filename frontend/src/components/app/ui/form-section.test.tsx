import { fireEvent, render, screen } from "@testing-library/react";

import { FormGrid, FormSwitchGroupRow } from "./form-section";

describe("FormGrid", () => {
  it("top-aligns fields with different helper-text heights", () => {
    const { getByTestId } = render(
      <FormGrid data-testid="form-grid">
        <div>Field with helper text</div>
        <div>Field without helper text</div>
      </FormGrid>,
    );

    expect(getByTestId("form-grid")).toHaveClass("items-start");
  });
});

describe("FormSwitchGroupRow", () => {
  const renderRow = (handlers: Record<string, jest.Mock>, checked: Record<string, boolean> = {}) =>
    render(
      <FormSwitchGroupRow
        data-component="test_service-days"
        title="주말·공휴일 서비스"
        description="설명"
        options={["saturday", "sunday", "holiday"].map((key) => ({
          key,
          label: key,
          checked: checked[key] ?? false,
          onToggle: handlers[key],
        }))}
      />,
    );

  it("renders a heading block and one FormSwitchRow per option under the expected data-components", () => {
    const { container } = renderRow({ saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() }, { sunday: true });

    const root = container.querySelector('[data-component="test_service-days"]');
    expect(root).toHaveAttribute("data-source-component", "FormSwitchGroupRow");
    for (const suffix of ["copy", "title", "description", "options"]) {
      expect(container.querySelector(`[data-component="test_service-days_${suffix}"]`)).not.toBeNull();
    }
    for (const key of ["saturday", "sunday", "holiday"]) {
      const row = container.querySelector(`[data-component="test_service-days_option-${key}"]`);
      expect(row).toHaveAttribute("data-source-component", "FormSwitchRow");
      expect(container.querySelector(`[data-component="test_service-days_option-${key}_button"]`)).not.toBeNull();
      expect(container.querySelector(`[data-component="test_service-days_option-${key}_thumb"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll('[data-source-component="FormSwitchRow"]')).toHaveLength(3);
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getByRole("switch", { name: "sunday" })).toBeChecked();
  });

  it("has no outer card border and lays the rows out in a three-column grid like sibling switch rows", () => {
    const { container } = renderRow({ saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() }, { sunday: true });

    const root = container.querySelector('[data-component="test_service-days"]') as HTMLElement;
    expect(root.className).not.toMatch(/border/);
    const options = container.querySelector('[data-component="test_service-days_options"]') as HTMLElement;
    expect(options).toHaveClass("grid", "lg:grid-cols-3");
    expect(options.className).toContain("gap-[calc(12px*var(--glint-ui-scale,1))]");
  });

  it("lets the call site override the options grid columns", () => {
    const { container } = render(
      <FormSwitchGroupRow
        data-component="test_service-days"
        title="t"
        optionsClassName="lg:grid-cols-2"
        options={[{ key: "a", label: "a", checked: false, onToggle: jest.fn() }]}
      />,
    );

    const options = container.querySelector('[data-component="test_service-days_options"]') as HTMLElement;
    expect(options).toHaveClass("lg:grid-cols-2");
    expect(options).not.toHaveClass("lg:grid-cols-3");
  });

  it("renders a checked option exactly like an unchecked one apart from the switch state", () => {
    const { container } = renderRow({ saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() }, { sunday: true });

    const on = container.querySelector('[data-component="test_service-days_option-sunday"]') as HTMLElement;
    const off = container.querySelector('[data-component="test_service-days_option-saturday"]') as HTMLElement;
    expect(on.className).toBe(off.className);
    expect(on.className).not.toMatch(/border-v3-primary/);
  });

  it("keeps a disabled option's switch disabled", () => {
    render(
      <FormSwitchGroupRow
        data-component="test_service-days"
        title="t"
        options={[{ key: "a", label: "a", checked: false, onToggle: jest.fn(), disabled: true }]}
      />,
    );

    expect(screen.getByRole("switch", { name: "a" })).toBeDisabled();
  });

  it("calls only the toggled option's handler", () => {
    const handlers = { saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() };
    renderRow(handlers);

    fireEvent.click(screen.getByRole("switch", { name: "holiday" }));

    expect(handlers.holiday).toHaveBeenCalledTimes(1);
    expect(handlers.saturday).not.toHaveBeenCalled();
    expect(handlers.sunday).not.toHaveBeenCalled();
  });
});
