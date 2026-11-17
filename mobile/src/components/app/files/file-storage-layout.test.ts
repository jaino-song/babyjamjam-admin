import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "../mobile-redesign/redesign.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsFor(selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",\n").some((part) => part.trim() === selector))
    .map((match) => match[2]).join("\n");
}

it("keeps the card at 92px with a 64px main inset and 28px list padding", () => {
  const main = declarationsFor('body:has([data-slot="files-content"]) [data-slot="main-content"]');
  const top = Number([...main.matchAll(/padding:\s*(\d+)px 0 0 !important/g)].at(-1)?.[1]);
  expect(top).toBe(64);
  const content = declarationsFor('body:has([data-slot="files-content"]) [data-slot="files-content"]');
  expect(content).toContain("padding: 12px 14px calc(var(--list-nav-height) + var(--list-nav-bottom) + 12px)");
  const listTop = Number([...content.matchAll(/padding-top:\s*(\d+)px/g)].at(-1)?.[1]);
  expect(listTop).toBe(28);
  expect(top + listTop).toBe(92);
});

it("keeps the detail sheet at 114px and the scrim flush with the 64px header", () => {
  const main = declarationsFor('body:has([data-slot="files-content"]) [data-slot="main-content"]');
  const mainTop = Number([...main.matchAll(/padding:\s*(\d+)px 0 0 !important/g)].at(-1)?.[1]);
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
