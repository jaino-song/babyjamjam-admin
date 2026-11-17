import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "page.module.css"), "utf8");
const source = fs.readFileSync(require.resolve("./page"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("mobile contracts form unified styles", () => {
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
    expect(source).toContain("styles.wizardButton");
    const secondaryAt = source.indexOf("styles.secondaryButton)");
    expect(secondaryAt).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("styles.primaryButton)")).toBeGreaterThan(secondaryAt);
    for (const declaration of ["border-radius: 9999px;", "height: 40px;", "min-height: 0;", "box-sizing: border-box;", "flex: 1 1 0;", "min-width: 0;"]) {
      expect(rule(".wizardButton")).toContain(declaration);
    }
    expect(rule(".primaryButton")).toContain("flex: 2 1 0;");
  });

  it.each(['.pageRoot [data-slot="autocomplete-input"]', '.formInput'])("sizes %s as a 44px control with 16px type", (selector) => {
    for (const declaration of ["height: 44px;", "font-size: 16px;", "border-radius: 12px;", "background: white;"]) {
      expect(rule(selector)).toContain(declaration);
    }
  });
});

it("uses the approved outline for the not-proceeding action", () => {
  for (const declaration of ["background: #fff;", "border: 2px solid #004bad;", "color: #004bad;", "box-shadow: none;"]) {
    expect(rule(".secondaryButton")).toContain(declaration);
  }
});

it("uses exact grid tracks for padded wizard actions", () => {
  expect(rule(".wizardActions")).toContain("display: grid;");
  expect(rule(".wizardActions")).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);");
  expect(rule(".wizardActions > :only-child")).toContain("grid-column: 1 / -1;");
});
