import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "../mobile-redesign/redesign.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsFor(selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",\n").some((part) => part.trim() === selector))
    .map((match) => match[2]).join("\n");
}

it("restores the snapshot's 80px main inset plus 12px list padding (card top 92px)", () => {
  const main = declarationsFor('body:has([data-slot="files-content"]) [data-slot="main-content"]');
  const top = Number([...main.matchAll(/padding:\s*(\d+)px 0 0 !important/g)].at(-1)?.[1]);
  expect(top).toBe(80);
  const content = declarationsFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(content).toContain("padding: 12px 14px calc(var(--list-nav-height) + var(--list-nav-bottom) + 12px)");
  expect(top + 12).toBe(92);
});

it("keeps the file card 12px above the default nav, including safe-area and capped-shell offsets", () => {
  const content = declarationsFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(content).toContain("--list-nav-height: 50px;");
  expect(content).toContain("--list-nav-bottom: max(calc(1rem + env(safe-area-inset-bottom)), calc(100dvh - var(--mobile-shell-max-height, 932px) + 1rem));");
  expect(content).toContain("padding: 12px 14px calc(var(--list-nav-height) + var(--list-nav-bottom) + 12px)");
  expect(content).toContain("min-height: 0;");
  expect(content).toContain("overflow-y: auto;");
});
