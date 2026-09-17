import { render, screen } from "@testing-library/react";

import { MiniBars } from "./MiniBars";

describe("MiniBars", () => {
  it("keeps every daily value while spacing the labels of a 30-day trend", () => {
    const values = Array.from({ length: 30 }, (_, index) => index + 1);
    const labels = values.map((day) => `2026.09.${String(day).padStart(2, "0")}`);
    const { container } = render(<MiniBars values={values} labels={labels} />);

    const bars = screen.getAllByLabelText(/2026\.09\.\d{2}: \d+/);
    expect(bars).toHaveLength(30);
    values.forEach((value, index) => {
      expect(bars[index]).toHaveAttribute("aria-label", `${labels[index]}: ${value}`);
    });
    const ticks = container.querySelectorAll("span");
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(ticks[0]).toHaveTextContent("09.01");
    expect(ticks[ticks.length - 1]).toHaveTextContent("09.30");
  });

  it("preserves all labels for a seven-day trend", () => {
    const labels = ["월", "화", "수", "목", "금", "토", "일"];
    render(<MiniBars values={[1, 2, 3, 4, 5, 6, 7]} labels={labels} />);

    labels.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });
});
