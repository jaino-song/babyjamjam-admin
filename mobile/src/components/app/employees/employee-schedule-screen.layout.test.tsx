import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

it("stacks schedule search and protects the magnifier and input at narrow widths", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(__dirname, "employee-schedule-screen.module.css"), "utf8");
  document.head.append(style);
  try {
    const { container } = render(<div className="toolbar"><div data-slot="search-bar"><svg aria-label="Search" /><input aria-label="Schedule search" /></div><div data-slot="month-controls">Month</div></div>);
    expect(container.firstElementChild).toHaveStyle({ flexDirection: "column", alignItems: "stretch" });
    expect(screen.getByRole("textbox").parentElement).toHaveStyle({ width: "100%", margin: "0px", padding: "0px 12px", boxSizing: "border-box" });
    expect(screen.getByRole("textbox")).toHaveStyle({ minWidth: "0", width: "0px" });
    expect(screen.getByLabelText("Search")).toHaveStyle({ flexShrink: "0" });
  } finally {
    style.remove();
  }
});
