import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright-core";
import { runEformsignCreationGates } from "./eformsign-creation-gates";
import { runEformsignFinalizeGates } from "./eformsign-finalize-gates";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import {
    EFORMSIGN_SDK_COMPLETION_CODE,
    EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE,
    EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE,
    EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE,
    EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE,
    EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE,
    readEformsignCallbackState,
    readEformsignSdkDiagnosticSummary,
} from "./eformsign-gate-utils";
import type { EformsignSdkDiagnosticSummary } from "./eformsign-gate-utils";
import { areE2EVendorStubsEnabled } from "infrastructure/vendor-stubs/e2e-vendor-stubs";

/**
 * Result envelope returned by the headless service. The frontend uses
 * `ok: false` + `reason` to fall back to the iframe path automatically.
 */
/**
 * How the gate loop ended. "request-send-clicked" means it clicked the popup
 * 전송 that submits the document; "success-latched" means it stopped on the SDK
 * callback instead, without necessarily having submitted anything.
 */
export type EformsignGateOutcome =
    | "success-latched"
    | "request-send-clicked"
    | "request-send-attempted";

export type HeadlessDispatchResult =
    | { ok: true; durationMs: number; documentId?: string; gateOutcome?: EformsignGateOutcome }
    | { ok: false; reason: string; durationMs: number; documentId?: string };

export interface DispatchCreationParams {
    documentOption: Record<string, unknown>;
    documentId?: string;
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>;
}

export interface DispatchFinalizeParams {
    documentOption: Record<string, unknown>;
    documentId: string;
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>;
}

const MAX_CONCURRENCY = 3;
const EFORMSIGN_SDK_URL = "https://www.eformsign.com/lib/js/efs_embedded_v2.js";
const EFORMSIGN_JQUERY_URL = "https://www.eformsign.com/plugins/jquery/jquery.min.js";
const EFORMSIGN_HEADED_MODE_VALUES = new Set(["false", "0", "no", "off", "headed"]);

function shouldLaunchHeadless(): boolean {
    const value = process.env["EFORMSIGN_BROWSER_HEADLESS"]?.trim().toLowerCase();
    if (!value) return true;
    return !EFORMSIGN_HEADED_MODE_VALUES.has(value);
}

class EformsignSdkDiagnosticError extends Error {
    constructor(readonly diagnostics: EformsignSdkDiagnosticSummary) {
        super("eformsign SDK diagnostic failure");
    }
}

function safeHeadlessFailureReason(error: unknown, operation: string): string {
    if (error instanceof EformsignSdkDiagnosticError) {
        return `${operation} failed (sdk_error). Diagnostics: ${JSON.stringify(error.diagnostics)}`;
    }
    if (!(error instanceof Error)) return `${operation} failed (unknown)`;
    if (/(?:timeout|timed out)/i.test(error.message)) return `${operation} failed (timeout)`;
    if (/sdk/i.test(error.message)) return `${operation} failed (sdk_error)`;
    return `${operation} failed (error)`;
}

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

    constructor(private readonly configService: ConfigService) {}

    async onModuleDestroy(): Promise<void> {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                void error;
                this.logger.warn("Browser close failed during shutdown.");
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
        if (areE2EVendorStubsEnabled(this.configService)) {
            await params.onProgress?.("client-started");
            await params.onProgress?.("info-inserted");
            await params.onProgress?.("creating");
            await params.onProgress?.("sent");
            return {
                ok: true,
                durationMs: 0,
                documentId: `doc-stub-headless-${randomUUID()}`,
            };
        }

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
                const reason = safeHeadlessFailureReason(error, "headless creation dispatch");
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
        if (areE2EVendorStubsEnabled(this.configService)) {
            await params.onProgress?.("client-started");
            await params.onProgress?.("info-inserted");
            await params.onProgress?.("creating");
            await params.onProgress?.("sent");
            return {
                ok: true,
                durationMs: 0,
                documentId: params.documentId,
            };
        }

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
                const reason = safeHeadlessFailureReason(error, "headless finalize dispatch");
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
        await this.gotoEmbeddedSdkPage(page, html, "creation");

        const eformsignFrame = page.frameLocator("iframe#eformsign_iframe");
        await this.waitForEformsignIframe(page, "eformsign_iframe");
        await params.onProgress?.("client-started");

        let gateOutcome: EformsignGateOutcome;
        try {
            gateOutcome = await runEformsignCreationGates(
                page,
                eformsignFrame,
                this.logger,
                params.onProgress,
            );
        } catch (gateError) {
            // Multi-step templates can submit directly from the top-level 전송
            // and never render the confirmation popup used by older templates.
            // The terminal SDK callback includes the newly created document id;
            // once that durable vendor identity exists, opening a fresh mode:01
            // iframe would risk sending a duplicate contract.
            const callbackState = await readEformsignCallbackState(page);
            const callbackDocumentId = callbackState.hasSuccess
                ? this.readDocumentIdFromCallback(callbackState.success)
                : undefined;
            if (!callbackState.hasError && callbackDocumentId) {
                void gateError;
                this.logger.warn("[creation] gate ended after terminal vendor success; treating creation as success.");
                await params.onProgress?.("sent");
                return {
                    ok: true,
                    durationMs: Date.now() - start,
                    documentId: callbackDocumentId,
                    gateOutcome: "success-latched",
                };
            }
            throw gateError;
        }
        this.logger.log(`[creation] gate sequence ended: ${gateOutcome}`);

        // The gate runner only confirms the click sequence completed; the
        // actual dispatch is acknowledged by the SDK success callback
        // (`__eformsignSuccess`). If that never fires, surface ok=false; the
        // caller uses the emitted creating progress to reconcile remotely
        // instead of reopening mode:01.
        const documentId = await this.waitForTerminalSdkCallback(page, 30_000);
        await params.onProgress?.("sent");

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: documentId ?? params.documentId,
            gateOutcome,
        };
    }

    private async driveFinalize(
        page: Page,
        params: DispatchFinalizeParams,
        start: number,
    ): Promise<HeadlessDispatchResult> {
        const html = this.buildEmbeddedSdkHtml(params.documentOption, "eformsign_finalize_iframe");
        await this.gotoEmbeddedSdkPage(page, html, "finalize");

        const eformsignFrame = page.frameLocator("iframe#eformsign_finalize_iframe");
        await this.waitForEformsignIframe(page, "eformsign_finalize_iframe");
        await params.onProgress?.("client-started");

        const gateOutcome = await runEformsignFinalizeGates(page, eformsignFrame, this.logger, params.onProgress);
        this.logger.log(`[finalize] gate sequence ended: ${gateOutcome}`);

        const documentId = await this.waitForTerminalSdkCallback(page, 30_000);
        await params.onProgress?.("sent");

        return {
            ok: true,
            durationMs: Date.now() - start,
            documentId: documentId ?? params.documentId,
            gateOutcome,
        };
    }

    private async waitForTerminalSdkCallback(page: Page, timeoutMs: number): Promise<string | undefined> {
        try {
            await page.waitForFunction(
                () => {
                    const w = window as unknown as {
                        __eformsignSuccess?: unknown;
                        __eformsignError?: unknown;
                    };
                    return w.__eformsignSuccess !== undefined || w.__eformsignError !== undefined;
                },
                { timeout: timeoutMs },
            );
        } catch {
            const diagnostics = await readEformsignSdkDiagnosticSummary(page);
            throw new EformsignSdkDiagnosticError(diagnostics);
        }

        const state = await readEformsignCallbackState(page);
        if (state.hasError) {
            throw new EformsignSdkDiagnosticError(await readEformsignSdkDiagnosticSummary(page));
        }
        if (!state.hasSuccess) {
            throw new EformsignSdkDiagnosticError(await readEformsignSdkDiagnosticSummary(page));
        }
        return this.readDocumentIdFromCallback(state.success);
    }

    private readDocumentIdFromCallback(payload: unknown): string | undefined {
        if (!payload || typeof payload !== "object" || !("document_id" in payload)) {
            return undefined;
        }
        const documentId = (payload as { document_id?: unknown }).document_id;
        return typeof documentId === "string" && documentId.trim() ? documentId : undefined;
    }

    private async gotoEmbeddedSdkPage(page: Page, html: string, purpose: string): Promise<void> {
        const url = `http://localhost:3000/__eformsign-headless/${purpose}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;

        await page.route(url, (route) =>
            route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: html,
            }),
        );

        // eformsign's embedded SDK miscomputes the iframe URL when opened from
        // about:blank. Serve the same HTML through an intercepted local origin
        // so the SDK builds a full https://www.eformsign.com iframe src.
        await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    private async waitForEformsignIframe(page: Page, iframeId: string): Promise<void> {
        await page.waitForFunction(
            (targetIframeId) => {
                const w = window as unknown as { __eformsignBootError?: unknown };
                if (w.__eformsignBootError) {
                    return true;
                }
                const frame = document.getElementById(targetIframeId);
                return Boolean(
                    frame instanceof HTMLIFrameElement &&
                        frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            iframeId,
            { timeout: 30_000 },
        );

        const bootError = await page.evaluate(() => {
            const w = window as unknown as { __eformsignBootError?: unknown };
            return w.__eformsignBootError;
        });
        if (bootError) {
            throw new Error("eformsign SDK failed to load");
        }
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
<script>
(function () {
    var option = ${optionJson};
    var diagnostics = {
        actionPresent: false,
        actionType: "unknown",
        actionCode: "unknown",
        successCountBucket: "0",
        successCode: "unknown",
        errorPresent: false,
        bootErrorPresent: false
    };
    window.__eformsignDiagnostics = diagnostics;
    function fail() {
        diagnostics.bootErrorPresent = true;
        window.__eformsignBootError = true;
    }
    function loadScript(src, done) {
        var script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = function () { done(); };
        script.onerror = function () { fail(); };
        document.head.appendChild(script);
    }
    function classifyActionType(value) {
        if (value === "${EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE}") {
            return "${EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE}";
        }
        if (value === "${EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE}") {
            return "${EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE}";
        }
        if (typeof value === "string" || typeof value === "number") return "other";
        return "unknown";
    }
    function classifyActionCode(value) {
        var normalized = typeof value === "string" || typeof value === "number"
            ? String(value)
            : null;
        if (normalized === "${EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE}") {
            return "${EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE}";
        }
        if (normalized === "${EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE}") {
            return "${EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE}";
        }
        if (normalized === "${EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE}") {
            return "${EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE}";
        }
        if (typeof value === "string" || typeof value === "number") return "other";
        return "unknown";
    }
    function classifyAction(response) {
        diagnostics.actionPresent = true;
        try {
            if (!response || typeof response !== "object") {
                diagnostics.actionType = "unknown";
                diagnostics.actionCode = "unknown";
                return;
            }
            diagnostics.actionType = classifyActionType(response.type);
            var data = Array.isArray(response.data) ? response.data : [];
            var dataLimit = data.length > 20 ? 20 : data.length;
            var sawScalarCode = false;
            var preferredCode = null;
            var returnFieldsCodeSeen = false;
            for (var i = 0; i < dataLimit; i += 1) {
                var item = data[i];
                if (!item || typeof item !== "object") {
                    continue;
                }
                var code = classifyActionCode(item.code);
                if (code === "${EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE}"
                    || code === "${EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE}") {
                    if (preferredCode === null) preferredCode = code;
                    continue;
                }
                if (code === "${EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE}") {
                    returnFieldsCodeSeen = true;
                    continue;
                }
                if (code === "other") sawScalarCode = true;
            }
            if (data.length > dataLimit && preferredCode === null && !returnFieldsCodeSeen) sawScalarCode = true;
            if (preferredCode !== null) {
                diagnostics.actionCode = preferredCode;
            } else if (returnFieldsCodeSeen) {
                diagnostics.actionCode = "${EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE}";
            } else if (sawScalarCode) {
                diagnostics.actionCode = "other";
            } else {
                diagnostics.actionCode = "unknown";
            }
        } catch {
            diagnostics.actionType = "unknown";
            diagnostics.actionCode = "unknown";
        }
    }
    function recordSuccess(response) {
        diagnostics.successCountBucket = diagnostics.successCountBucket === "0"
            ? "1"
            : "2+";
        try {
            if (response && (typeof response === "object" || typeof response === "function")) {
                var responseCode = response.code;
                var responseCodeString = typeof responseCode === "string" || typeof responseCode === "number"
                    ? String(responseCode)
                    : null;
                diagnostics.successCode = responseCodeString === "${EFORMSIGN_SDK_COMPLETION_CODE}"
                    ? "terminal_success"
                    : responseCodeString !== null
                        ? "other"
                        : "unknown";
                if (diagnostics.successCode === "terminal_success") {
                    // The terminal payload is intentionally retained only for the
                    // internal document_id return path; it is never logged/projected.
                    window.__eformsignSuccess = response;
                }
            } else {
                diagnostics.successCode = "unknown";
            }
        } catch {
            diagnostics.successCode = "unknown";
        }
    }
    function open() {
        if (typeof window.EformSignDocument !== "function") {
            return fail();
        }
        var sdk = new window.EformSignDocument();
        sdk.document(
            option,
            "${iframeId}",
            function (resp) {
                recordSuccess(resp);
            },
            function (resp) {
                // Preserve the SDK bridge's current latch semantics: an
                // undefined callback clears the current error latch, while a
                // concrete callback latches a fixed boolean. The diagnostic
                // flag records that a concrete error was observed separately.
                if (resp === undefined) {
                    window.__eformsignError = undefined;
                    return;
                }
                diagnostics.errorPresent = true;
                window.__eformsignError = true;
            },
            function (resp) { classifyAction(resp); }
        );
        sdk.open();
    }
    loadScript("${EFORMSIGN_JQUERY_URL}", function () {
        loadScript("${EFORMSIGN_SDK_URL}", open);
    });
})();
</script></body></html>`;
    }

    private async getBrowser(): Promise<Browser> {
        if (this.browser && this.browser.isConnected()) {
            return this.browser;
        }
        const headless = shouldLaunchHeadless();
        if (!headless) {
            this.logger.warn("Launching eformsign automation browser in headed mode.");
        }
        this.browser = await chromium.launch({
            headless,
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
