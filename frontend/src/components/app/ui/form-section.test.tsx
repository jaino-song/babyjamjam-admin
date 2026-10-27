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

  it("renders a pill with a switch per option under the expected data-components", () => {
    const { container } = renderRow({ saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() }, { sunday: true });

    const root = container.querySelector('[data-component="test_service-days"]');
    expect(root).toHaveAttribute("data-source-component", "FormSwitchGroupRow");
    for (const suffix of ["copy", "title", "description", "options"]) {
      expect(container.querySelector(`[data-component="test_service-days_${suffix}"]`)).not.toBeNull();
    }
    for (const key of ["saturday", "sunday", "holiday"]) {
      expect(container.querySelector(`[data-component="test_service-days_option-${key}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-component="test_service-days_option-${key}_button"]`)).not.toBeNull();
      expect(container.querySelector(`[data-component="test_service-days_option-${key}_thumb"]`)).not.toBeNull();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getByRole("switch", { name: "sunday" })).toBeChecked();
  });

  it("marks an on pill by border only: no tinted background and a dark label", () => {
    const { container } = renderRow({ saturday: jest.fn(), sunday: jest.fn(), holiday: jest.fn() }, { sunday: true });

    const on = container.querySelector('[data-component="test_service-days_option-sunday"]') as HTMLElement;
    const off = container.querySelector('[data-component="test_service-days_option-saturday"]') as HTMLElement;
    expect(on).toHaveClass("border-v3-primary/35", "bg-white");
    expect(on.className).not.toMatch(/bg-v3-primary/);
    expect(on.querySelector("span")).toHaveClass("text-v3-dark");
    expect(off).not.toHaveClass("border-v3-primary/35");
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
