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
  it("is 3 full-width columns below sm and 5 centred columns (max 560px) from sm up", () => {
    const { container } = render(
      <DayCardGrid data-component="desktop_service-record-admin_wizard_day-grid">{card()}</DayCardGrid>,
    );

    const grid = container.firstElementChild;
    expect(grid).toHaveAttribute("data-source-component", "DayCardGrid");
    expect(grid).toHaveClass(
      "grid",
      "w-full",
      "grid-cols-3",
      "gap-[calc(8px*var(--glint-ui-scale,1))]",
      "sm:grid-cols-5",
      "sm:max-w-[560px]",
      "sm:mx-auto",
    );
    expect(grid?.className).not.toContain("auto-fill");
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
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary!", "bg-v3-primary-light", "ring-[3px]");
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "changed");

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

  it("is a square, centred card", () => {
    render(card());
    expect(screen.getByRole("button")).toHaveClass(
      "aspect-square",
      "flex",
      "flex-col",
      "items-center",
      "justify-center",
      "rounded-[12px]",
    );
  });

  it("names its children from the root data-component", () => {
    const { container } = render(card());
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "DayCard");
    for (const suffix of ["date", "title", "status"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
