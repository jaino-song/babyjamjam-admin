import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright-core";
import { runEformsignCreationGates } from "./eformsign-creation-gates";
import { runEformsignFinalizeGates } from "./eformsign-finalize-gates";

/**
 * Result envelope returned by the headless service. The frontend uses
 * `ok: false` + `reason` to fall back to the iframe path automatically.
 */
export type HeadlessDispatchResult =
    | { ok: true; durationMs: number; documentId?: string }
    | { ok: false; reason: string; durationMs: number; documentId?: string };

export interface DispatchCreationParams {
    documentOption: Record<string, unknown>;
    documentId?: string;
}

export interface DispatchFinalizeParams {
    documentOption: Record<string, unknown>;
    documentId: string;
}

const MAX_CONCURRENCY = 3;

/**
 * Drives the eformsign embedded SDK off-screen so the iframe gate sequence
 * (입력 시작 → 회사 도장 ×3 → 다음 ×2 → 전송 → popup 전송) runs on the backend
 * instead of the staff's browser. The SDK is the only path eformsign exposes
 * to advance a workflow step — see memory: `eformsign — no REST approve endpoint`.
 *
 * Authentication mirrors the frontend: `documentOption.user.access_token` is
 * generated server-side via the eformsign API-key + private-key signature,
 * and the SDK uses it directly. No service-account login or cookies needed —
 * the headless browser is just a way to render the SDK and click its buttons.
 */
@Injectable()
export class EformsignHeadlessService implements OnModuleDestroy {
    private readonly logger = new Logger(EformsignHeadlessService.name);

    private browser: Browser | null = null;
    private readonly inflight = new Set<Promise<unknown>>();
    private readonly waitQueue: Array<() => void> = [];

    async onModuleDestroy(): Promise<void> {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                this.logger.warn(`Browser close failed during shutdown: ${error}`);
            }
            this.browser = null;
        }
    }

    /**
     * Drive the creation iframe gate sequence (mode:"01"). Returns ok=false
     * on selector miss / timeout / SDK error — the caller falls back to
     * surfacing the iframe to the user.
     */
    async dispatchCreation(params: DispatchCreationParams): Promise<HeadlessDispatchResult> {
        return this.runWithSlot(async () => {
            const start = Date.now();
            try {
                const context = await this.newContext();
                const page = await context.newPage();
                try {
                    return await this.driveCreation(page, params, start);
                } finally {
                    await page.close().catch(() => undefined);
                    await context.close().catch(() => undefined);
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : "unknown headless dispatch error";
                this.logger.error(`dispatchCreation failed: ${reason}`);
                return {
                    ok: false,
                    reason,
                    durationMs: Date.now() - start,
                    documentId: params.documentId,
                };
            }
        });
    }

    /**
     * Drive the staff-finalize iframe gate sequence (mode:"02"). Shorter than
     * creation (no 회사 도장, no 다음). Falls back to ok=false on errors.
     */
    async dispatchFinalize(params: DispatchFinalizeParams): Promise<HeadlessDispatchResult> {
        return this.runWithSlot(async () => {
            const start = Date.now();
            try {
                const context = await this.newContext();
                const page = await context.newPage();
                try {
                    return await this.driveFinalize(page, params, start);
                } finally {
                    await page.close().catch(() => undefined);
                    await context.close().catch(() => undefined);
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : "unknown headless finalize error";
                this.logger.error(`dispatchFinalize failed: ${reason}`);
                return {
                    ok: false,
                    reason,
                    durationMs: Date.now() - start,
                    documentId: params.documentId,
                };
            }
        });
    }

    private async driveCreation(
        page: Page,
        params: DispatchCreationParams,
        start: number,
    ): Promise<HeadlessDispatchResult> {
        const html = this.buildEmbeddedSdkHtml(params.documentOption, "eformsign_iframe");
        await page.setContent(html, { waitUntil: "domcontentloaded" });

        const eformsignFrame = page.frameLocator("iframe#eformsign_iframe");
        await page.waitForFunction(
            () => {
                const frame = document.getElementById("eformsign_iframe");
                return Boolean(
                    frame instanceof HTMLIFrameElement &&
                        frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            { timeout: 30_000 },
        );

        const successPromise = page.waitForFunction(
            () => (window as unknown as { __eformsignSuccess?: unknown }).__eformsignSuccess !== undefined,
            { timeout: 90_000 },
        );

        await runEformsignCreationGates(page, eformsignFrame, this.logger);

        // The gate runner only confirms the click sequence completed; the
        // actual dispatch is acknowledged by the SDK success callback
        // (`__eformsignSuccess`). If that never fires, the document was not
        // sent — surface that as ok=false so the frontend falls back.
        await successPromise;
        const documentId = await this.readSuccessDocumentId(page);

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: documentId ?? params.documentId,
        };
    }

    private async driveFinalize(
        page: Page,
        params: DispatchFinalizeParams,
        start: number,
    ): Promise<HeadlessDispatchResult> {
        const html = this.buildEmbeddedSdkHtml(params.documentOption, "eformsign_finalize_iframe");
        await page.setContent(html, { waitUntil: "domcontentloaded" });

        const eformsignFrame = page.frameLocator("iframe#eformsign_finalize_iframe");
        await page.waitForFunction(
            () => {
                const frame = document.getElementById("eformsign_finalize_iframe");
                return Boolean(
                    frame instanceof HTMLIFrameElement &&
                        frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            { timeout: 30_000 },
        );

        const successPromise = page.waitForFunction(
            () => (window as unknown as { __eformsignSuccess?: unknown }).__eformsignSuccess !== undefined,
            { timeout: 60_000 },
        );

        await runEformsignFinalizeGates(page, eformsignFrame, this.logger);

        await successPromise;
        const documentId = await this.readSuccessDocumentId(page);

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: documentId ?? params.documentId,
        };
    }

    private async readSuccessDocumentId(page: Page): Promise<string | undefined> {
        return page
            .evaluate(() => {
                const w = window as unknown as { __eformsignSuccess?: { document_id?: string } };
                return w.__eformsignSuccess?.document_id;
            })
            .catch(() => undefined);
    }

    /**
     * Build a minimal HTML page that loads the eformsign embedded SDK script
     * and opens the supplied documentOption in an iframe with the given id.
     * Mirrors what `useEformsign` does on the frontend.
     */
    private buildEmbeddedSdkHtml(documentOption: Record<string, unknown>, iframeId: string): string {
        const optionJson = JSON.stringify(documentOption).replace(/</g, "\\u003c");
        return `<!doctype html>
<html><head><meta charset="utf-8"><title>headless</title></head>
<body style="margin:0">
<iframe id="${iframeId}" style="width:100vw;height:100vh;border:0"></iframe>
<script src="https://www.eformsign.com/embedded/sdk/eformsigndocument.min.js"></script>
<script>
(function () {
    var option = ${optionJson};
    function open() {
        if (typeof window.EformSignDocument !== "function") {
            return setTimeout(open, 100);
        }
        var sdk = new window.EformSignDocument();
        sdk.document(
            option,
            "${iframeId}",
            function (resp) { window.__eformsignSuccess = resp; },
            function (resp) { window.__eformsignError = resp; },
            function (resp) { window.__eformsignAction = resp; }
        );
        sdk.open();
    }
    open();
})();
</script></body></html>`;
    }

    private async getBrowser(): Promise<Browser> {
        if (this.browser && this.browser.isConnected()) {
            return this.browser;
        }
        this.browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        });
        return this.browser;
    }

    private async newContext(): Promise<BrowserContext> {
        const browser = await this.getBrowser();
        return browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        });
    }

    /**
     * Concurrency cap: never run more than MAX_CONCURRENCY headless dispatches
     * simultaneously. Each Chromium context is ~150MB, so 3 concurrent ≈ 500MB
     * of additional RSS — beyond that the Railway service starts to thrash.
     */
    private async runWithSlot<T>(fn: () => Promise<T>): Promise<T> {
        if (this.inflight.size >= MAX_CONCURRENCY) {
            await new Promise<void>((resolve) => this.waitQueue.push(resolve));
        }
        const promise = fn();
        this.inflight.add(promise);
        try {
            return await promise;
        } finally {
            this.inflight.delete(promise);
            const next = this.waitQueue.shift();
            if (next) {
                next();
            }
        }
    }
}
