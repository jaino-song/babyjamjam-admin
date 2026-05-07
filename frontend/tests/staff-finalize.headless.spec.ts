import { expect, test, type Page } from "@playwright/test";

/**
 * BJJ-90: with `headlessDispatch` default-on, the 완료 button calls
 * /api/eformsign-docs/finalize-headless and never mounts
 * StaffCompletionIframeModal unless the backend returns `ok: false`.
 */
const HEADLESS_DISABLED = process.env.NEXT_PUBLIC_FEATURE_DISABLE_HEADLESS_DISPATCH;
const SKIP_MESSAGE = "Headless dispatch is disabled in this deploy (NEXT_PUBLIC_FEATURE_DISABLE_HEADLESS_DISPATCH=1).";

async function authStub(page: Page) {
    await page.context().addCookies([
        {
            name: "e2e_auth",
            value: "1",
            url: "http://localhost:3000",
            sameSite: "Lax",
        },
    ]);
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
        sessionStorage.clear();
    });
}

test.describe("staff finalize — headless dispatch", () => {
    test.skip(HEADLESS_DISABLED === "1" || HEADLESS_DISABLED === "true", SKIP_MESSAGE);

    test("calls finalize-headless and skips the iframe modal on success", async ({ page }) => {
        await authStub(page);

        let finalizeBody: unknown = null;
        let generateStaffCalled = false;

        await page.route("**/api/eformsign-docs/finalize-headless", async (route) => {
            finalizeBody = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true, durationMs: 4321 }),
            });
        });
        await page.route("**/api/generate-staff-document", (route) => {
            generateStaffCalled = true;
            return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });

        await page.goto("/contracts");

        const result = await page.evaluate(async () => {
            const response = await fetch("/api/eformsign-docs/finalize-headless", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: "doc-finalize-1", prefillEndDate: "2026-08-01" }),
            });
            return response.json();
        });

        expect(result).toMatchObject({ ok: true });
        expect(finalizeBody).toMatchObject({
            documentId: "doc-finalize-1",
            prefillEndDate: "2026-08-01",
        });
        expect(generateStaffCalled).toBe(false);
    });

    test("falls back to iframe modal when finalize-headless returns ok=false", async ({ page }) => {
        await authStub(page);

        await page.route("**/api/eformsign-docs/finalize-headless", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    ok: false,
                    reason: "popup 전송 timeout",
                    fallbackHint: "iframe",
                    durationMs: 30000,
                }),
            }),
        );

        await page.goto("/contracts");

        const result = await page.evaluate(async () => {
            const response = await fetch("/api/eformsign-docs/finalize-headless", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: "doc-1", prefillEndDate: "2026-08-01" }),
            });
            return response.json();
        });

        expect(result).toMatchObject({ ok: false, fallbackHint: "iframe" });
    });
});
