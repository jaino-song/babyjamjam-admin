import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("mobile redesign list rows", () => {
  it("prevents shrinking in the base rule for every list card", () => {
    const css = readFileSync(join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"), "utf8");
    const baseRule = css.match(/^\.list-item \{([^}]+)\}/m)?.[1];

    expect(baseRule).toMatch(/^\s*flex-shrink:\s*0;/m);
  });
});
