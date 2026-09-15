import { render, screen } from "@testing-library/react";

import { StatsBar } from "./StatsBar";

function TestIcon({ className }: { className?: string; strokeWidth?: number }) {
  return <svg aria-label="test icon" className={className} />;
}

const items = [
  { icon: TestIcon, value: 4, label: "전체", tone: "primary" as const },
  { icon: TestIcon, value: 2, label: "미확인", tone: "burgundy" as const, urgent: true },
];

describe("StatsBar", () => {
  it("renders the compact dashboard stats pattern", () => {
    const { container } = render(
      <StatsBar data-component="mobile_test_stats" items={items} variant="compact" />,
    );

    expect(container.querySelector('[data-slot="stats-grid"]')).toHaveClass("stats-grid");
    expect(container.querySelectorAll('[data-slot="stat-mini"]')).toHaveLength(2);
    expect(screen.getByText("미확인")).toHaveClass("mini-stat-label");
    expect(screen.getByText("2")).toHaveClass("mini-stat-num", "urgent");
  });

  it("preserves the existing default presentation", () => {
    const { container } = render(<StatsBar data-component="mobile_test_stats" items={items} />);

    expect(container.querySelector('[data-slot="stats-grid"]')).toHaveClass("grid", "gap-4");
    expect(container.querySelector('[data-slot="stats-grid"]')).not.toHaveClass("stats-grid");
  });
});
