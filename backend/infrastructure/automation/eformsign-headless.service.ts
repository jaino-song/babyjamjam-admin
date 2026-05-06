import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Cookie,
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

interface CookieCache {
    cookies: Cookie[];
    capturedAt: number;
}

const COOKIE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONCURRENCY = 3;

const EFORMSIGN_LOGIN_URL = "https://www.eformsign.com/auth/login";
const EFORMSIGN_HOME_URL = "https://www.eformsign.com/";

/**
 * Drives the eformsign embedded SDK off-screen so the iframe gate sequence
 * (입력 시작 → 회사 도장 ×3 → 다음 ×2 → 전송 → popup 전송) runs on the backend
 * instead of the staff's browser. The SDK is the only path eformsign exposes
 * to advance a workflow step — see memory: `eformsign — no REST approve endpoint`.
 */
@Injectable()
export class EformsignHeadlessService implements OnModuleDestroy {
    private readonly logger = new Logger(EformsignHeadlessService.name);

    private readonly userEmail: string;
    private readonly servicePassword: string;
    private readonly companyId: string;
    private readonly isConfigured: boolean;

    private browser: Browser | null = null;
    private cookieCache: CookieCache | null = null;
    private readonly inflight = new Set<Promise<unknown>>();
    private readonly waitQueue: Array<() => void> = [];

    constructor(private readonly configService: ConfigService) {
        this.userEmail = this.configService.get<string>("EFORMSIGN_USER_EMAIL") || "";
        this.servicePassword = this.configService.get<string>("EFORMSIGN_SERVICE_ACCOUNT_PASSWORD") || "";
        this.companyId = this.configService.get<string>("EFORMSIGN_COMPANY_ID") || "";
        this.isConfigured = Boolean(this.userEmail && this.servicePassword);

        if (!this.isConfigured) {
            this.logger.warn(
                "EformsignHeadlessService disabled: set EFORMSIGN_USER_EMAIL and EFORMSIGN_SERVICE_ACCOUNT_PASSWORD to enable headless dispatch.",
            );
        }
    }

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
     * on selector miss / timeout / login redirect — the caller should fall
     * back to surfacing the iframe to the user.
     */
    async dispatchCreation(params: DispatchCreationParams): Promise<HeadlessDispatchResult> {
        return this.runWithSlot(async () => {
            const start = Date.now();
            try {
                this.assertConfigured();
                const context = await this.getAuthedContext();
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
                this.assertConfigured();
                const context = await this.getAuthedContext();
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

        await successPromise.catch(() => undefined);

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: params.documentId,
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

        await successPromise.catch(() => undefined);

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: params.documentId,
        };
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

    private assertConfigured(): void {
        if (!this.isConfigured) {
            throw new Error("Headless dispatch is not configured (missing service-account credentials).");
        }
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

    private async getAuthedContext(): Promise<BrowserContext> {
        const browser = await this.getBrowser();
        const cookies = await this.loginIfStale();
        const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        });
        if (cookies.length > 0) {
            await context.addCookies(cookies);
        }
        return context;
    }

    /**
     * Lazily acquire (and refresh) eformsign session cookies for the service
     * account. Cookies are cached in memory for `COOKIE_CACHE_TTL_MS`; on
     * staleness or absence we run a fresh login flow.
     */
    private async loginIfStale(): Promise<Cookie[]> {
        const now = Date.now();
        if (
            this.cookieCache &&
            now - this.cookieCache.capturedAt < COOKIE_CACHE_TTL_MS &&
            this.cookieCache.cookies.length > 0
        ) {
            return this.cookieCache.cookies;
        }

        this.logger.log("Refreshing eformsign service-account session (headless login).");

        const browser = await this.getBrowser();
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await page.goto(EFORMSIGN_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const emailInput = page.locator('input[type="email"], input[name="email"], input[name="id"]').first();
            const passwordInput = page.locator('input[type="password"]').first();
            await emailInput.waitFor({ timeout: 15_000 });
            await emailInput.fill(this.userEmail);
            await passwordInput.fill(this.servicePassword);

            const submit = page.getByRole("button", { name: /로그인|Log\s*in/i }).first();
            await submit.click();

            await page.waitForURL((url) => !url.toString().includes("/auth/login"), { timeout: 20_000 });

            const cookies = await context.cookies(EFORMSIGN_HOME_URL);
            if (cookies.length === 0) {
                throw new Error("eformsign login produced no cookies");
            }

            this.cookieCache = { cookies, capturedAt: Date.now() };
            return cookies;
        } finally {
            await page.close().catch(() => undefined);
            await context.close().catch(() => undefined);
        }
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

    /** For tests. */
    invalidateCookieCacheForTest(): void {
        this.cookieCache = null;
    }
}
