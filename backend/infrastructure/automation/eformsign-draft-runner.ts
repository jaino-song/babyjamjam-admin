import type { Page } from "playwright-core";

export type EformsignDraftResult =
    | { ok: true; draftSaved: true; candidateDocumentId: string; receipt: { action: "01"; code: "-1" } }
    | { ok: false; reason: "invalid-options" | "open-denied" | "unsupported-stub" | "unsupported-action" | "invalid-response" | "provider-error" | "runtime-error"; uncertain: boolean };

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const TOP_KEYS = new Set(["mode", "company", "user", "prefill", "layout", "return_fields", "userdata"]);

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertJsonData(value: unknown): void {
    if (["function", "symbol", "bigint"].includes(typeof value)) throw new Error("Invalid draft options");
    if (!value || typeof value !== "object") return;
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        throw new Error("Invalid draft options");
    }
    for (let inherited = prototype; inherited; inherited = Object.getPrototypeOf(inherited)) {
        if (Object.getOwnPropertyDescriptor(inherited, "toJSON")) throw new Error("Invalid draft options");
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get || descriptor.set) throw new Error("Invalid draft options");
        assertJsonData(descriptor.value);
    }
}

/** Reject SDK extension hooks and existing-document options before any provider load. */
export function buildEformsignDraftHtml(documentOption: Record<string, unknown>): string {
    if (!record(documentOption)) throw new Error("Invalid draft options");
    assertJsonData(documentOption);
    const { mode, company, user } = documentOption;
    if (!record(mode) || mode["type"] !== "01" || !IDENTIFIER.test(String(mode["template_id"] ?? "")) ||
        typeof mode["template_id"] !== "string" || Object.keys(mode).some((key) => !["type", "template_id"].includes(key)) ||
        !record(company) || typeof company["id"] !== "string" || !IDENTIFIER.test(company["id"]) ||
        Object.keys(company).some((key) => !["id", "country_code", "location_code", "user_key"].includes(key)) ||
        !record(user) || user["type"] !== "01" ||
        Object.keys(user).some((key) => !["type", "id", "access_token", "refresh_token", "internal_token"].includes(key)) ||
        Object.keys(documentOption).some((key) => !TOP_KEYS.has(key))) {
        throw new Error("Invalid draft options");
    }
    const optionJson = JSON.stringify(documentOption, (key, value: unknown) => {
        if (/(?:url|script|callback|document_id|domain)/i.test(key) ||
            ["__proto__", "prototype", "constructor"].includes(key) ||
            typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
            throw new Error("Invalid draft options");
        }
        return value;
    }).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><title>draft</title></head><body>
<iframe id="eformsign_draft_iframe"></iframe>
<script>
(function () {
    var option = ${optionJson};
    var saving = false;
    var sdk;
    var ownedFrame = document.getElementById("eformsign_draft_iframe");
    // Capture runs before jQuery's vendor handlers, including setStorage.
    // Keep this guard installed until the isolated page/context is destroyed.
    window.addEventListener("message", function (event) {
        if (event.origin !== "https://www.eformsign.com" || !ownedFrame ||
            !ownedFrame.contentWindow || event.source !== ownedFrame.contentWindow) {
            event.stopImmediatePropagation();
        }
    }, true);
    function fail(reason) {
        if (!window.__eformsignDraftResult) {
            window.__eformsignDraftResult = { ok: false, reason: reason, uncertain: true };
        }
    }
    function saved(response) {
        if (window.__eformsignDraftResult) return;
        if (!saving || !response || response.type !== "document" || response.fn !== "saveSuccess" ||
            (response.code !== "-1" && response.code !== -1) || typeof response.document_id !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(response.document_id)) {
            return fail("invalid-response");
        }
        window.__eformsignDraftResult = {
            ok: true, draftSaved: true, candidateDocumentId: response.document_id,
            receipt: { action: "01", code: "-1" }
        };
    }
    function advertised(response) {
        if (window.__eformsignDraftResult || saving) return;
        if (!response || response.type !== "document" || response.fn !== "actionCallback" ||
            !Array.isArray(response.data) || !response.data.length || response.data.length > 100 ||
            !response.data.every(function (item) {
                return item && typeof item === "object" && typeof item.name === "string" && typeof item.code === "string";
            }) || !response.data.some(function (item) { return item.code === "01"; })) {
            return fail("unsupported-action");
        }
        saving = true; // Latch before SDK invocation; repeated advertisements cannot resave.
        try { sdk.sendAction({ type: "01", code: "01" }); }
        catch (_) { fail("runtime-error"); }
    }
    function open() {
        try {
            sdk = new window.EformSignDocument();
            sdk.document(option, "eformsign_draft_iframe", saved, function () { fail("provider-error"); }, advertised);
            sdk.open();
        } catch (_) { fail("runtime-error"); }
    }
    function load(src, done) {
        var script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = done;
        script.onerror = function () { fail("runtime-error"); };
        document.head.appendChild(script);
    }
    load("https://www.eformsign.com/plugins/jquery/jquery.min.js", function () {
        load("https://www.eformsign.com/lib/js/efs_embedded_v2.js", open);
    });
})();
</script></body></html>`;
}

/** Opens only through the service's intercepted local-page seam. No gates or retries. */
export async function runEformsignDraft(
    page: Page,
    html: string,
    openPage: (page: Page, html: string, purpose: string) => Promise<void>,
): Promise<EformsignDraftResult> {
    await openPage(page, html, "draft");
    await page.waitForFunction(
        () => Boolean((window as unknown as { __eformsignDraftResult?: unknown }).__eformsignDraftResult),
        undefined,
        { timeout: 30_000 },
    );
    return page.evaluate(() =>
        (window as unknown as { __eformsignDraftResult: EformsignDraftResult }).__eformsignDraftResult,
    );
}
