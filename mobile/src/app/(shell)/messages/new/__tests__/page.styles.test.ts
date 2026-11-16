import fs from "node:fs";
import path from "node:path";

it("keeps the shared label row and 12px local label rule", () => {
  const source = fs.readFileSync(require.resolve("../page"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../page.module.css"), "utf8");
  expect(source).toContain("<FieldLabelRow");
  expect(source).toContain("styles.formSectionLabel");
  const label = css.match(/\.formLabel \{[^}]*}/)?.[0];
  expect(label).toContain("font-size: 12px;");
  expect(label).toContain("text-transform: none;");
});
