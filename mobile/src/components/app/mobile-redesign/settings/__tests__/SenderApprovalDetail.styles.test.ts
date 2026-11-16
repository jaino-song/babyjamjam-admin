import fs from "node:fs";
import path from "node:path";

it("keeps the form label class with 12px type and no uppercase transformation", () => {
  const source = fs.readFileSync(require.resolve("../SenderApprovalDetail"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../sender-approval-detail.module.css"), "utf8");
  expect(source).toContain("styles.formLabel");
  const label = css.match(/\.formLabel \{[^}]*}/)?.[0];
  expect(label).toContain("font-size: 12px;");
  expect(label).toContain("text-transform: none;");
});
