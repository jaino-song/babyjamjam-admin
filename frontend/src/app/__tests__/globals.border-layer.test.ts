import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("globals.css default border reset", () => {
  it("keeps the reset only in the base layer, below border utilities", () => {
    const css = readFileSync(join(__dirname, "..", "globals.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks: string[] = [];
    const resetScopes: string[][] = [];
    let statementStart = 0;

    // Track block nesting; quoted content must not introduce CSS delimiters.
    for (const token of css.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]/g)) {
      const delimiter = token[0];
      if (delimiter !== "{" && delimiter !== "}" && delimiter !== ";") continue;
      const statement = css.slice(statementStart, token.index).trim();

      if (delimiter === "{") {
        blocks.push(statement);
      } else {
        if (
          blocks[blocks.length - 1] === "*" &&
          statement.replace(/\s/g, "") === "border-color:hsl(var(--border))"
        ) {
          resetScopes.push([...blocks]);
        }
        if (delimiter === "}") blocks.pop();
      }
      statementStart = token.index + 1;
    }

    expect(resetScopes).toEqual([["@layer base", "*"]]);
  });
});
