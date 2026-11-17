import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "../mobile-redesign/redesign.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsFor(selector: string, source = css): string {
  const declarations: string[] = [];
  let depth = 0;
  let start = 0;
  let matchesSelector = false;
  // Only collect direct declarations of a matching top-level rule. Conditional
  // blocks (including nested at-rules) cannot establish unconditional spacing.
  for (const token of source.matchAll(/[{};]/g)) {
    const index = token.index;
    if (token[0] === "{") {
      if (depth === 0) {
        matchesSelector = source.slice(start, index).split(",").some((part) => part.trim() === selector);
      }
      depth += 1;
    } else {
      if (depth === 1 && matchesSelector) {
        declarations.push(`${source.slice(start, index)};`);
      }
      if (token[0] === "}") depth -= 1;
    }
    start = index + 1;
  }
  return declarations.join("\n");
}

// These exact-selector rules have equal specificity. A later padding shorthand
// resets padding-top too; !important declarations retain their higher priority.
function paddingTopFor(selector: string, source = css): number {
  let top = NaN;
  let important = false;
  for (const declaration of declarationsFor(selector, source).split(";")) {
    const statement = declaration.trim();
    const property = statement.match(/^([^\s:]*padding[^\s:]*)\s*:/i)?.[1];
    // Fail closed for padding properties that this cascade resolver cannot model.
    if (property && !/^(padding|padding-top)$/i.test(property)) {
      throw new Error(`Unsupported padding property for ${selector}: ${property}. Update file-storage-layout.test.ts before adding it.`);
    }
    const match = statement.match(/^(padding|padding-top)\s*:\s*(.*?)\s*(!important)?$/i);
    if (!match) continue;
    const nextImportant = Boolean(match[3]);
    if (important && !nextImportant) continue;
    // Both shorthand and longhand start with the top value in these rules.
    const pixels = match[2].match(/^(\d+)px(?:\s|$)/);
    if (!pixels) throw new Error(`Unsupported padding value: ${match[2]}`);
    top = Number(pixels[1]);
    important = nextImportant;
  }
  return top;
}

function assertNoAtRulePadding(selector: string, source = css): void {
  const blocks: { atRule: boolean; matchesSelector: boolean }[] = [];
  let start = 0;
  for (const token of source.matchAll(/[{};]/g)) {
    const index = token.index;
    const statement = source.slice(start, index).trim();
    if (token[0] === "{") {
      const parent = blocks.at(-1);
      const atRule = statement.startsWith("@");
      blocks.push({
        atRule: atRule || Boolean(parent?.atRule),
        matchesSelector: atRule
          ? Boolean(parent?.matchesSelector)
          : statement.split(",").some((part) => part.trim() === selector),
      });
    } else {
      const block = blocks.at(-1);
      if (block?.atRule && block.matchesSelector && /^[^\s:]*padding[^\s:]*\s*:/i.test(statement)) {
        throw new Error(`Update file-storage-layout.test.ts before adding padding inside at-rules for ${selector}: ${statement}`);
      }
      if (token[0] === "}") blocks.pop();
    }
    start = index + 1;
  }
}

it.each([
  "@media (min-width: 99999px) { .files { padding-top: 0; } }",
  "@media (min-width: 0px) { .files { padding-top: 0; } }",
  "@media (min-width:0) { .files { padding-block-start: 0 } }",
  "@media (min-width:0) { .files { padding-block: 0 } }",
  "@media (min-width:0) { .files { -webkit-padding-before: 0 } }",
  "@supports (display: grid) { .files { padding: 0 } }",
  "@container (min-width: 0px) { .other, .files { padding-top: 0; } }",
  "@layer layout { .files { padding: 0 !important; } }",
  "@media (min-width: 0px) { @supports (display: grid) { .files { padding-top: 0; } } }",
  ".files { @media (min-width: 0px) { padding-top: 0; } }",
  ".files { @media (min-width: 0px) { @supports (display: grid) { padding: 0 } } }",
  ".files { @media (min-width:0) { padding-block-start: 0 } }",
])("rejects file-list padding inside at-rules: %s", (source) => {
  expect(() => assertNoAtRulePadding(".files", source)).toThrow("Update file-storage-layout.test.ts");
});

const unsupportedPaddingProperties = [
  "padding-block-start",
  "padding-block-end",
  "padding-block",
  "padding-inline-start",
  "padding-inline-end",
  "padding-inline",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "PADDING-BLOCK-START",
  "padding-future-property",
  "-webkit-padding-before",
  "-webkit-padding-start",
  "-moz-padding-start",
  "-WEBKIT-PADDING-BEFORE",
  "future-padding",
];

it.each(unsupportedPaddingProperties)("rejects %s inside at-rules", (property) => {
  expect(() => assertNoAtRulePadding(".files", `
    @media (min-width:0) { @supports (display: grid) { .other, .files { ${property}: 0 } } }
  `)).toThrow("Update file-storage-layout.test.ts");
});

it.each(unsupportedPaddingProperties)("rejects unresolved top-level %s", (property) => {
  expect(() => paddingTopFor(".files", `.files { padding-top: 28px; ${property}: 0 }`))
    .toThrow(`Unsupported padding property for .files: ${property}`);
});

it("allows top-level padding, unrelated selectors and non-padding at-rule declarations", () => {
  expect(() => assertNoAtRulePadding(".files", `
    .files { padding: 12px 14px; }
    @media (min-width: 0px) { .other { padding-top: 0; } .files { color: red; } }
    .files { @supports (display: grid) { display: grid; } padding-top: 28px; }
  `)).not.toThrow();
});

it("requires updating this test before file-list padding is added inside any at-rule", () => {
  expect(() => assertNoAtRulePadding('body:has([data-slot="files-content"]) [data-slot="files-content"]')).not.toThrow();
});

it.each([
  "@media (min-width: 99999px) { .files { padding-top: 28px; } }",
  "@supports (display: grid) { .files { padding-top: 28px; } }",
  "@layer layout { .files { padding-top: 28px; } }",
  "@media (min-width: 99999px) { @supports (display: grid) { .files { padding-top: 28px; } } }",
])("ignores at-rule declarations: %s", (nestedRule) => {
  expect(paddingTopFor(".files", `.files { padding: 12px 14px; } ${nestedRule}`)).toBe(12);
});

it("does not find an unconditional padding when only an at-rule defines it", () => {
  expect(paddingTopFor(".files", "@media (min-width: 99999px) { .files { padding-top: 28px; } }")).toBeNaN();
});

it("ignores nested at-rules inside a matching rule and resumes after them", () => {
  expect(paddingTopFor(".files", `
    .files { padding: 12px 14px; @media (min-width: 99999px) { padding-top: 28px; } }
  `)).toBe(12);
  expect(paddingTopFor(".files", `
    .files {
      padding: 12px 14px;
      @media (min-width: 99999px) { padding-top: 28px; }
      padding-top: 16px;
    }
    @supports (display: grid) { .files { padding-top: 28px; } }
    .other, .files { padding-top: 20px }
  `)).toBe(20);
});

it("rejects a 28px file-list padding moved into a never-matching media query", () => {
  const selector = 'body:has([data-slot="files-content"]) [data-slot="files-content"]';
  const rule = `${selector} {\n  padding-top: 28px;\n}`;
  expect(css).toContain(rule);
  const mutatedCss = css.replace(rule, `@media (min-width: 99999px) { ${rule} }`);
  expect(paddingTopFor(selector, mutatedCss)).toBe(12);
});

it.each([
  [".files { padding-top: 28px; } .files { padding: 12px 14px; }", 12],
  [".files { padding: 12px 14px; } .files { padding-top: 28px; }", 28],
  [".files { padding-top: 28px !important; } .files { padding: 12px 14px; }", 28],
  [".files { padding-top: 28px !important; } .files { padding: 12px 14px !important; }", 12],
])("preserves cascade priority for %s", (source, expected) => {
  expect(paddingTopFor(".files", source)).toBe(expected);
});

it("keeps the card at 92px with a 64px main inset and 28px list padding", () => {
  const top = paddingTopFor('body:has([data-slot="files-content"]) [data-slot="main-content"]');
  expect(top).toBe(64);
  const content = declarationsFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(content).toContain("padding: 12px 14px calc(var(--list-nav-height) + var(--list-nav-bottom) + 12px)");
  const listTop = paddingTopFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(top + listTop).toBe(92);
  expect(listTop).toBe(28);
});

it("keeps the detail sheet at 114px and the scrim flush with the 64px header", () => {
  const mainTop = paddingTopFor('body:has([data-slot="files-content"]) [data-slot="main-content"]');
  expect(mainTop).toBe(64);
  const track = declarationsFor('body:has([data-slot="files-content"]) [data-slot="mobile-detail-stack-track"]');
  expect(track).toContain("inset: 0;");
  const detail = declarationsFor('body:has([data-slot="files-content"]) [data-slot="mobile-detail-stack-detail-page"]');
  const detailTop = Number([...detail.matchAll(/top:\s*(\d+)px/g)].at(-1)?.[1]);
  expect(detailTop).toBe(50);
  expect(mainTop + detailTop).toBe(114);
  expect(declarationsFor(".scrim")).toContain("inset: 0;");
});

it("keeps the file card 12px above the default nav, including safe-area and capped-shell offsets", () => {
  const content = declarationsFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(content).toContain("--list-nav-height: 50px;");
  expect(content).toContain("--list-nav-bottom: max(calc(1rem + env(safe-area-inset-bottom)), calc(100dvh - var(--mobile-shell-max-height, 932px) + 1rem));");
  expect(content).toContain("padding: 12px 14px calc(var(--list-nav-height) + var(--list-nav-bottom) + 12px)");
  expect(content).toContain("min-height: 0;");
  expect(content).toContain("overflow-y: auto;");
});
