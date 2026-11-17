import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

it("keeps template and other list rows at natural height with the shared base rule", () => {
  const css = readFileSync(join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = [
    css.match(/^\.list-item \{[^}]+\}/m)?.[0],
    css.match(/^\.list-card-scroll \{[^}]+\}/m)?.[0],
  ].join("\n");
  document.head.append(style);
  try {
    render(<><section data-page="messages-templates"><div className="list-card-scroll"><div className="section-block"><div className="list-item">Template with two-line metadata</div></div></div></section><section><div className="list-card-scroll"><div className="list-item">Other list</div></div></section></>);
    const template = screen.getByText("Template with two-line metadata");
    const other = screen.getByText("Other list");
    expect(template).toHaveStyle({ flexShrink: "0", padding: "12px 0", height: "auto" });
    expect(template.closest(".list-card-scroll")).toHaveStyle({ overflowY: "auto" });
    expect(getComputedStyle(other).flexShrink).toBe("0");
    expect(other).toHaveStyle({ padding: "12px 0", height: "auto", border: "0px" });
  } finally {
    style.remove();
  }
});
