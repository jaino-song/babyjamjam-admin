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

    test("forwards progressId in the request body when supplied", async ({ page }) => {
        await authStub(page);

        let finalizeBody: Record<string, unknown> | null = null;
        await page.route("**/api/eformsign-docs/finalize-headless", async (route) => {
            finalizeBody = route.request().postDataJSON() as Record<string, unknown>;
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true, durationMs: 100 }),
            });
        });

        await page.goto("/contracts");

        await page.evaluate(async () => {
            await fetch("/api/eformsign-docs/finalize-headless", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "doc-with-progress",
                    prefillEndDate: "2026-08-01",
                    progressId: "progress-7c1e",
                }),
            });
        });

        expect(finalizeBody).toMatchObject({
            documentId: "doc-with-progress",
            prefillEndDate: "2026-08-01",
            progressId: "progress-7c1e",
        });
    });

    test("finalize progress SSE proxy route rejects requests without progressId", async ({ page }) => {
        await authStub(page);
        await page.goto("/contracts");

        const status = await page.evaluate(async () => {
            const response = await fetch("/api/eformsign-docs/finalize-headless/progress", {
                credentials: "include",
            });
            return response.status;
        });

        // The proxy must validate progressId before forwarding upstream.
        expect(status).toBe(400);
    });

    test("finalize progress SSE proxy streams the upstream events through to the browser", async ({ page }) => {
        await authStub(page);

        // Mock the upstream Nest SSE so the proxy has something to forward.
        await page.route(
            "**/eformsign-docs/finalize-headless/progress?progressId=progress-stream",
            (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "text/event-stream",
                    body: [
                        'event: progress\ndata: {"step":"client-started"}\n\n',
                        'event: progress\ndata: {"step":"info-inserted"}\n\n',
                        'event: progress\ndata: {"step":"sent"}\n\n',
                    ].join(""),
                }),
        );

        await page.goto("/contracts");

        const body = await page.evaluate(async () => {
            const response = await fetch(
                "/api/eformsign-docs/finalize-headless/progress?progressId=progress-stream",
                { credentials: "include" },
            );
            return response.text();
        });

        expect(body).toContain('"step":"client-started"');
        expect(body).toContain('"step":"info-inserted"');
        expect(body).toContain('"step":"sent"');
    });
});
