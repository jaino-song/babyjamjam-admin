import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DayCard, DayCardGrid, type DayCardProps } from "./DayCardGrid";

const BASE = "mobile_test_day-card";

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
  it("is a responsive auto-fill grid with 8px gap", () => {
    const { container } = render(
      <DayCardGrid data-component="mobile_test_day-grid">{card()}</DayCardGrid>,
    );

    const grid = container.firstElementChild;
    expect(grid).toHaveAttribute("data-source-component", "DayCardGrid");
    expect(grid).toHaveClass("grid", "gap-2", "grid-cols-[repeat(auto-fill,minmax(88px,1fr))]");
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

  it("calls onClick when pressed", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(card({ onClick }));

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(card({ onClick, disabled: true, state: "locked" }));

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("maps each state to its look", () => {
    const { rerender } = render(card({ state: "changed" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary", "bg-v3-primary-light", "ring-[3px]");
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "changed");

    rerender(card({ state: "locked" }));
    expect(screen.getByRole("button")).toHaveClass("opacity-50");

    rerender(card({ state: "done" }));
    expect(screen.getByRole("button")).toHaveClass("bg-v3-primary-light", "border-v3-primary-medium");

    rerender(card({ state: "readonly" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary-medium");

    rerender(card({ state: "current" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-primary", "ring-[3px]");

    rerender(card({ state: "todo" }));
    expect(screen.getByRole("button")).toHaveClass("border-v3-border");
  });

  it("names its children from the root data-component", () => {
    const { container } = render(card());
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "DayCard");
    for (const suffix of ["date", "title", "status"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
