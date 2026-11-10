import { fireEvent, render, screen } from "@testing-library/react";

import { DayCard, DayCardGrid, type DayCardProps } from "./DayCardGrid";

const BASE = "desktop_service-record-admin_wizard_day-card";

function card(overrides: Partial<DayCardProps> = {}) {
  return (
    <DayCard
      data-component={BASE}
      dateLabel="2026.09.21"
      title="3"
      statusLabel="입력 가능"
      state="current"
      onClick={jest.fn()}
      {...overrides}
    />
  );
}

describe("DayCardGrid", () => {
  it("fills the available width with scaled 88px minimum columns", () => {
    const { container } = render(
      <DayCardGrid data-component="desktop_service-record-admin_wizard_day-grid">{card()}</DayCardGrid>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "DayCardGrid");
    expect(container.firstElementChild).toHaveClass("grid", "grid-cols-[repeat(auto-fill,minmax(calc(88px*var(--glint-ui-scale,1)),1fr))]", "gap-[calc(8px*var(--glint-ui-scale,1))]");
  });
});

describe("DayCard", () => {
  it("is a button whose default accessible name is its text including the date", () => {
    render(card());

    const button = screen.getByRole("button", { name: /2026\.09\.21/ });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("2026.09.21");
    expect(button).toHaveTextContent("3");
    expect(button).toHaveTextContent("입력 가능");
  });

  it("uses accessibleName when given (it must still include the date)", () => {
    render(card({ accessibleName: "2026.09.21 3회차 입력 가능" }));

    const button = screen.getByRole("button", { name: /2026\.09\.21/ });
    expect(button).toHaveAccessibleName("2026.09.21 3회차 입력 가능");
  });

  it("calls onClick when pressed", () => {
        const onClick = jest.fn();
    render(card({ onClick }));

    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
        const onClick = jest.fn();
    render(card({ onClick, disabled: true, state: "locked" }));

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("maps each state to its look", () => {
    const { rerender } = render(card({ state: "changed" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary-medium!", "bg-v3-primary-light");
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "changed");
    expect(screen.getByRole("button")).not.toHaveClass("ring-[3px]");

    rerender(card({ state: "locked" }));
    expect(screen.getByRole("button")).toHaveClass("opacity-50");

    rerender(card({ state: "done" }));
    expect(screen.getByRole("button")).toHaveClass("bg-v3-primary-light", "border-v3-primary-medium!");

    rerender(card({ state: "readonly" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary-medium!");

    rerender(card({ state: "current" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary!", "ring-[3px]");

    rerender(card({ state: "todo" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-border!");
  });

  it("is a vertically padded caregiver card", () => {
    render(card());
    expect(screen.getByRole("button")).toHaveClass(
      "flex",
      "flex-col",
      "items-center",
      "px-[calc(4px*var(--glint-ui-scale,1))]",
      "py-[calc(10px*var(--glint-ui-scale,1))]",
      "rounded-[calc(12px*var(--glint-ui-scale,1))]",
    );
  });

  it("puts an optional data-slot on its button, and none when not given", () => {
    const { rerender } = render(card({ "data-slot": "day" }));
    expect(screen.getByRole("button")).toHaveAttribute("data-slot", "day");

    rerender(card());
    expect(screen.getByRole("button")).not.toHaveAttribute("data-slot");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(card());
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "DayCard");
    for (const suffix of ["date", "title", "status"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
