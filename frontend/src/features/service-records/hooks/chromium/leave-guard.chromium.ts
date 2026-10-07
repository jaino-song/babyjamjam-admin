import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import ts from "typescript";

/**
 * Drives the real `createLeaveGuardController` (transpiled, no stubs) in Chromium
 * against genuine session history: back, long-press-style multi-entry traversal,
 * hash entries, and a stand-in for Next's popstate handler (registered first, as in
 * the app). Run twice: with the Navigation API (traversals are vetoed before they
 * happen) and with it removed (the popstate fallback used by browsers without it).
 */

const ORIGIN = "http://guard.test";
const EDITOR = "/clients/42/records?tab=edit";
const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { marker: "editor-tree" } };

const controllerJs = ts.transpileModule(
    readFileSync(join(__dirname, "..", "leave-guard-controller.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

const pageHtml = `<!doctype html><html><body>
<a id="hash" href="#section">hash</a>
<div id="modal" hidden>
  <button id="stay">머무르기</button><button id="leave">나가기</button>
</div>
<script>
  window.exports = {};
  (function (exports) { ${controllerJs} })(window.exports);
  window.nextPops = [];
  // Stand-in for Next's app-router popstate handler (registered before the guard).
  window.addEventListener("popstate", () => window.nextPops.push(location.pathname + location.search));
  window.promptOpen = false;
  window.guard = window.exports.createLeaveGuardController({
    onPromptChange: (open) => { window.promptOpen = open; document.getElementById("modal").hidden = !open; },
  });
  document.getElementById("stay").onclick = () => window.guard.stay();
  document.getElementById("leave").onclick = () => window.guard.leave(() => { window.left = true; });
</script></body></html>`;

interface HarnessWindow {
    guard: { arm: () => void; release: () => void };
    promptOpen: boolean;
    nextPops: string[];
    left?: boolean;
}

const MODES = ["navigation-api", "popstate-fallback"] as const;

async function setup(page: Page, mode: (typeof MODES)[number]) {
    if (mode === "popstate-fallback") {
        await page.addInitScript(() => {
            Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
        });
    }
    await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body: pageHtml }));
    await page.goto(`${ORIGIN}/earlier`);
    await page.evaluate(
        ({ editor, state }) => {
            history.pushState(null, "", "/previous");
            history.pushState(state, "", editor);
        },
        { editor: EDITOR, state: NEXT_STATE },
    );
}

const arm = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).guard.arm());
const where = (page: Page) => page.evaluate(() => location.pathname + location.search + location.hash);
const modalOpen = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).promptOpen as boolean);
const historyState = (page: Page) => page.evaluate(() => history.state);
const historyLength = (page: Page) => page.evaluate(() => history.length);
const nextPops = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).nextPops as string[]);
// Same-document traversals are async in Chromium; wait for the guard (or Next) to react.
const settle = (page: Page) => page.waitForTimeout(150);
// Browser-level Back (like the toolbar button). A vetoed traversal never "loads", so do not wait for it.
const browserBack = (page: Page) => page.goBack({ timeout: 1000 }).catch(() => null);

for (const mode of MODES) {
    test.describe(`leave guard in real Chromium history (${mode})`, () => {
        test("hash-only traversal inside the editor does not prompt", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            await page.click("#hash"); // [.., E, G, E#section]
            await browserBack(page); // onto G
            await settle(page);
            expect(await modalOpen(page)).toBe(false);
            expect(await where(page)).toBe(EDITOR);
        });

        test("hash-only Forward onto the editor entry does not prompt", async ({ page }) => {
            await setup(page, mode);
            await page.evaluate(
                ({ editor, state }) => {
                    history.replaceState(state, "", `${editor}#a`);
                    history.pushState(state, "", `${editor}#b`);
                },
                { editor: EDITOR, state: NEXT_STATE },
            );
            await arm(page);
            await page.evaluate(() => history.go(-2)); // guard -> editor(#b) -> #a
            await settle(page);
            expect(await where(page)).toBe(`${EDITOR}#a`);
            expect(await modalOpen(page)).toBe(false);

            await page.evaluate(() => history.forward()); // #a -> editor(#b)
            await settle(page);
            expect(await where(page)).toBe(`${EDITOR}#b`);
            expect(await modalOpen(page)).toBe(false);

            // Still guarded: Back from the guard entry onto the editor entry is held.
            await page.evaluate(() => history.forward());
            await settle(page);
            await browserBack(page);
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
        });

        test("single Back: prompt, 머무르기 keeps the editor URL, still guarded", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            await browserBack(page);
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
            expect(await where(page)).toBe(EDITOR);
            expect(await historyState(page)).toMatchObject(NEXT_STATE);

            await page.click("#stay");
            expect(await where(page)).toBe(EDITOR);
            await browserBack(page);
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
            expect(await where(page)).toBe(EDITOR);
        });

        test("single Back: 나가기 lands exactly on the previous entry", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            await browserBack(page);
            await settle(page);
            await page.click("#leave");
            await settle(page);
            expect(await where(page)).toBe("/previous");
            expect(await page.evaluate(() => (window as unknown as HarnessWindow).left)).toBe(true);
        });

        test("multi-entry Back: stays on the editor with Next's state, 머무르기 keeps it", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            const lengthBefore = await historyLength(page);
            await page.evaluate(() => history.go(-3)); // long-press: guard -> editor -> previous -> earlier
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
            expect(await where(page)).toBe(EDITOR);
            expect(await historyState(page)).toMatchObject(NEXT_STATE);
            if (mode === "navigation-api") {
                // Vetoed before it happened: the router stand-in never heard of it, nothing moved.
                expect(await nextPops(page)).toEqual([]);
                expect(await historyLength(page)).toBe(lengthBefore);
            }

            await page.click("#stay");
            expect(await where(page)).toBe(EDITOR);
            expect(await historyState(page)).toMatchObject(NEXT_STATE);
            await browserBack(page);
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
            expect(await where(page)).toBe(EDITOR);
        });

        test("multi-entry Back: 나가기 reaches the entry the user was heading to", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            await page.evaluate(() => history.go(-3));
            await settle(page);
            await page.click("#leave");
            await settle(page);
            expect(await where(page)).toBe("/earlier");
            if (mode === "navigation-api") {
                // Exact traversal: the skipped entries are still there to go Forward through.
                await page.evaluate(() => history.forward());
                await settle(page);
                expect(await where(page)).toBe("/previous");
            }
        });

        test("release leaves no extra entry between the editor and the previous page, and does not navigate", async ({ page }) => {
            await setup(page, mode);
            const lengthBefore = await historyLength(page);
            await arm(page);
            await page.evaluate(() => (window as unknown as HarnessWindow).guard.release());
            await settle(page);
            expect(await where(page)).toBe(EDITOR);
            expect(await historyState(page)).toMatchObject(NEXT_STATE);
            expect(await historyLength(page)).toBe(lengthBefore + 1); // the guard entry stays in the list...
            await browserBack(page); // ...but is no longer between the editor and the previous page
            await settle(page);
            expect(await where(page)).toBe("/previous");
        });

        // Release must never navigate or rewrite history: arm, tamper with the history the
        // way a router or a plain link would, release, and compare before/after.
        const SAFETY_SCENARIOS: Array<{ name: string; tamper: (editor: string) => void; url: string }> = [
            {
                name: "replace-hash: replaceState(state, '', editor#new)",
                tamper: (editor) => history.replaceState(history.state, "", `${editor}#new`),
                url: `${EDITOR}#new`,
            },
            {
                name: "replace-hash with router state lacking our tag",
                tamper: (editor) => history.replaceState({ __NA: true, marker: "r" }, "", `${editor}#new`),
                url: `${EDITOR}#new`,
            },
            {
                name: "replace-other: replaceState(state, '', /different)",
                tamper: () => history.replaceState(history.state, "", "/different"),
                url: "/different",
            },
            {
                name: "replace-other with router state lacking our tag",
                tamper: () => history.replaceState({ __NA: true, marker: "r" }, "", "/different"),
                url: "/different",
            },
            {
                name: "replace-above-other: push editor#a, then replace to /different",
                tamper: (editor) => {
                    history.pushState({ n: 1 }, "", `${editor}#a`);
                    history.replaceState({ n: 2 }, "", "/different");
                },
                url: "/different",
            },
            {
                name: "router hash push above the guard entry",
                tamper: (editor) => history.pushState({ __NA: true, marker: "hash-tree" }, "", `${editor}#x`),
                url: `${EDITOR}#x`,
            },
            {
                name: "tag lost, URL kept (router.refresh-style replace)",
                tamper: (editor) => history.replaceState({ __NA: true, marker: "refresh" }, "", editor),
                url: EDITOR,
            },
        ];

        for (const scenario of SAFETY_SCENARIOS) {
            test(`release safety, ${scenario.name}: nothing moves`, async ({ page }) => {
                await setup(page, mode);
                await page.evaluate(() => {
                    const w = window as unknown as Record<string, unknown>;
                    w.origPush = history.pushState;
                    w.origReplace = history.replaceState;
                });
                await arm(page);
                await page.evaluate(`(${scenario.tamper.toString()})(${JSON.stringify(EDITOR)})`);
                await settle(page);
                const before = {
                    url: await where(page),
                    state: await historyState(page),
                    length: await historyLength(page),
                };
                await page.evaluate(() => {
                    const w = window as unknown as { pops: number };
                    w.pops = 0;
                    window.addEventListener("popstate", () => { w.pops += 1; });
                    (window as unknown as HarnessWindow).guard.release();
                });
                await page.waitForTimeout(400);

                expect(before.url).toBe(scenario.url);
                expect(await where(page)).toBe(before.url);
                expect(await historyState(page)).toEqual(before.state);
                expect(await historyLength(page)).toBe(before.length);
                expect(await page.evaluate(() => (window as unknown as { pops: number }).pops)).toBe(0);
                expect(
                    await page.evaluate(() => {
                        const w = window as unknown as { origPush: unknown; origReplace: unknown };
                        return history.pushState === w.origPush && history.replaceState === w.origReplace;
                    }),
                ).toBe(true);
                expect(await modalOpen(page)).toBe(false);
            });
        }

        test("release safety, plain <a href=#x> fragment navigation: nothing moves", async ({ page }) => {
            await setup(page, mode);
            await arm(page);
            await page.click("#hash");
            await settle(page);
            const before = { url: await where(page), state: await historyState(page), length: await historyLength(page) };
            expect(before.url).toBe(`${EDITOR}#section`);
            await page.evaluate(() => {
                const w = window as unknown as { pops: number };
                w.pops = 0;
                window.addEventListener("popstate", () => { w.pops += 1; });
                (window as unknown as HarnessWindow).guard.release();
            });
            await page.waitForTimeout(400);
            expect(await where(page)).toBe(before.url);
            expect(await historyState(page)).toEqual(before.state);
            expect(await historyLength(page)).toBe(before.length);
            expect(await page.evaluate(() => (window as unknown as { pops: number }).pops)).toBe(0);
        });

        test("release after a router hash push leaves a redundant guard entry but never moves the user", async ({ page }) => {
            const hashState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { marker: "hash-tree" } };
            await setup(page, mode);
            await arm(page);
            await page.evaluate(
                ({ editor, state }) => history.pushState(state, "", `${editor}#x`),
                { editor: EDITOR, state: hashState },
            );
            await page.evaluate(() => (window as unknown as HarnessWindow).guard.release());
            await page.waitForTimeout(400);

            expect(await where(page)).toBe(`${EDITOR}#x`);
            expect(await historyState(page)).toEqual(hashState);
            expect(await modalOpen(page)).toBe(false);

            // Documented limitation: hash entry -> redundant guard entry -> editor entry -> previous page.
            for (const expected of [EDITOR, EDITOR, "/previous"]) {
                await browserBack(page);
                await settle(page);
                expect(await where(page)).toBe(expected);
            }
        });

        test("two controllers released in reverse order never leave the editor page", async ({ page }) => {
            await setup(page, mode);
            await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown> & { exports: { createLeaveGuardController: (o: object) => { arm: () => void; release: () => void } } };
                const make = () => w.exports.createLeaveGuardController({ onPromptChange: () => undefined });
                const first = make();
                const second = make();
                first.arm();
                second.arm();
                w.pair = { first, second };
                w.pops = 0;
                window.addEventListener("popstate", () => { (w.pops as number) += 1; });
            });
            await settle(page);
            const lengthBefore = await historyLength(page);
            await page.evaluate(() => {
                const { first, second } = (window as unknown as { pair: Record<"first" | "second", { release: () => void }> }).pair;
                second.release();
                first.release();
            });
            await page.waitForTimeout(400);
            expect(await where(page)).toBe(EDITOR);
            expect(await historyLength(page)).toBe(lengthBefore);
            expect(await page.evaluate(() => (window as unknown as { pops: number }).pops)).toBeLessThanOrEqual(1);
        });

        test("release immediately followed by arm (StrictMode) keeps a single guard entry", async ({ page }) => {
            await setup(page, mode);
            const lengthBefore = await historyLength(page);
            await page.evaluate(() => {
                const guard = (window as unknown as HarnessWindow).guard;
                guard.arm();
                guard.release();
                guard.arm();
            });
            await settle(page);
            expect(await where(page)).toBe(EDITOR);
            expect(await historyLength(page)).toBe(lengthBefore + 1);
            await browserBack(page);
            await settle(page);
            expect(await modalOpen(page)).toBe(true);
            expect(await where(page)).toBe(EDITOR);
            await page.click("#leave");
            await settle(page);
            expect(await where(page)).toBe("/previous");
        });
    });
}
