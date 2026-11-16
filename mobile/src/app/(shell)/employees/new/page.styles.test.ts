import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "page.module.css"), "utf8");
const source = fs.readFileSync(require.resolve("./page"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("mobile employees form unified styles", () => {
  it("keeps the navbar class with a 32px face and 44px hit area", () => {
    expect(source).toContain("styles.navbarIconButton");
    expect(rule(".navbarIconButton")).toContain("width: 32px;");
    expect(rule(".navbarIconButton")).toContain("height: 32px;");
    expect(rule(".navbarIconButton")).toContain("position: relative;");
    expect(rule(".navbarIconButton::after")).toContain("position: absolute;");
    expect(rule(".navbarIconButton::after")).toContain("inset: -6px;");
    expect(rule(".navbarIconButton::after")).toContain('content: "";');
  });

  it("keeps the card class with the shared white surface", () => {
    expect(source).toContain("styles.formCard");
    for (const declaration of ["background: #fff;", "border: 0;", "border-radius: 16px;", "box-shadow: 0 4px 24px rgba(25, 48, 77, 0.06);"]) {
      expect(rule(".formCard")).toContain(declaration);
    }
  });

  it("keeps the action classes with 40px pills and a 1:2 ratio", () => {
    expect(source).toContain("styles.actionButton");
    const secondaryAt = source.indexOf("styles.secondary)");
    expect(secondaryAt).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("styles.primary)")).toBeGreaterThan(secondaryAt);
    for (const declaration of ["border-radius: 9999px;", "height: 40px;", "min-height: 0;", "box-sizing: border-box;", "flex: 1 1 0;", "min-width: 0;"]) {
      expect(rule(".actionButton")).toContain(declaration);
    }
    expect(rule(".primary")).toContain("flex: 2 1 0;");
  });

  it.each(['.formInput'])("sizes %s as a 44px control with 16px type", (selector) => {
    for (const declaration of ["height: 44px;", "font-size: 16px;", "border-radius: 12px;", "background: white;"]) {
      expect(rule(selector)).toContain(declaration);
    }
  });
});

it("preserves the employee secondary action colors", () => {
  expect(rule(".secondary")).toContain("background: hsl(var(--v3-border));");
  expect(rule(".secondary")).toContain("color: hsl(var(--v3-text));");
});

it("keeps the label class with 12px type and no uppercase transformation", () => {
  expect(source).toContain("styles.formLabel");
  expect(rule(".formLabel")).toContain("font-size: 12px;");
  expect(rule(".formLabel")).toContain("text-transform: none;");
});
