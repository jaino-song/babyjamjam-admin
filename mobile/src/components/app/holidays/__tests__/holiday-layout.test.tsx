import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

import { HolidayPageShell } from "../HolidayPageShell";

it("constrains the holiday card above the nav and gives only its list the scrolling space", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(__dirname, "../holiday-page-shell.module.css"), "utf8");
  document.head.append(style);
  try {
    const { container } = render(<HolidayPageShell title="지점 공휴일"><div>Controls</div><div className="listScroll" data-slot="holiday-list-scroll">List</div></HolidayPageShell>);
    expect(container.querySelector('[data-slot="holiday-settings-content"]')).toHaveStyle({ display: "flex", overflow: "hidden", padding: "12px 14px 76px" });
    expect(container.querySelector('[data-slot="holiday-settings-card"]')).toHaveStyle({ flex: "1", minHeight: "0", overflow: "hidden", marginBottom: "0" });
    expect(container.querySelector('[data-slot="holiday-settings-body"]')).toHaveStyle({ display: "flex", minHeight: "0", overflow: "hidden" });
    expect(screen.getByText("Controls")).toHaveStyle({ flexShrink: "0" });
    expect(screen.getByText("List")).toHaveStyle({ overflowY: "auto", minHeight: "0", flex: "1" });
  } finally {
    style.remove();
  }
});
