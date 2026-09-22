import type { FrameLocator, Locator, Page } from "playwright-core";

export const EFORMSIGN_GATE_POLL_MS = 500;
export const EFORMSIGN_CLICK_TIMEOUT_MS = 2_000;
export const EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT = 2;
// The gate loop only logs when it clicks something, so a run that stalls waiting
// for the editor to expose its first actionable button leaves no trace at all.
// Emit a snapshot on this cadence while the loop is idle so a timeout report
// shows what the iframe was actually displaying, not just the final frame.
export const EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS = 5_000;
export const EFORMSIGN_READY_TEXT = "필수 입력 항목을 모두 작성했습니다.";
// eformsign uses two different popup IDs depending on the SDK mode:
//   - mode "01" (creation): #requestWithInputCommentPopup
//   - mode "02" (finalize):  #inputCommentPopup
// Keeping these as separate single-id selectors avoids Playwright's multi-match
// isVisible() throw, which the gate's catch() masks as `not visible` and makes
// the loop fall back to the (now-blocked) top-level 전송.
export const REQUEST_SEND_DIALOG_SELECTOR = "#requestWithInputCommentPopup";
export const FINALIZE_REQUEST_SEND_DIALOG_SELECTOR = "#inputCommentPopup";
// The only `code` an eformsign SDK success callback carries when the document
// actually finished. The SDK fires that same callback for non-terminal events —
// a top-level 전송 that merely opens the confirm popup is one — so latching on
// the callback's arrival alone reports success for a send that never happened.
// `frontend/src/hooks/useEformsign.ts` filters on the same value; the backend
// keeps its own copy because it does not depend on @babyjamjam/shared.
export const EFORMSIGN_SDK_COMPLETION_CODE = "-1";
// The embedded SDK's actionCallback uses document/template types and advertises
// fixed action codes. The separate sendAction bridge uses type 01 / code 22;
// that parameter is not an actionCallback payload and is never logged here.
export const EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE = "document";
export const EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE = "template";
export const EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE = "21";
export const EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE = "22";
export const EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE = "99";
export const EFORMSIGN_SDK_SEND_ACTION_TYPE = "01";
export const EFORMSIGN_SDK_SEND_ACTION_CODE = EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE;

const EFORMSIGN_DIAGNOSTIC_COUNT_CAP = 20;
const EFORMSIGN_DIAGNOSTIC_ATTRIBUTE_TIMEOUT_MS = 250;
const EFORMSIGN_DIAGNOSTIC_EVALUATE_TIMEOUT_MS = 250;

export type EformsignDiagnosticGate = "creation" | "finalize";
export type EformsignDiagnosticAction =
    | "confirm"
    | "send_popup"
    | "send_top_level"
    | "next"
    | "start"
    | "other";
export type EformsignDiagnosticSelectedCategory = "guide" | "header" | "other" | "unknown";
export type EformsignDiagnosticCount = number | "overflow";
export type EformsignDiagnosticIndex = number | "overflow" | "unknown";
export type EformsignDiagnosticBoolean = boolean | "unknown";
export type EformsignSdkActionType =
    | typeof EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE
    | typeof EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE
    | "other"
    | "unknown";
export type EformsignSdkActionCode =
    | typeof EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE
    | typeof EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE
    | typeof EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE
    | "other"
    | "unknown";
export type EformsignSdkSuccessCountBucket = "0" | "1" | "2+" | "unknown";
export type EformsignSdkSuccessCode = "terminal_success" | "other" | "unknown";

export interface EformsignSdkDiagnosticSummary {
    actionPresent: boolean;
    actionType: EformsignSdkActionType;
    actionCode: EformsignSdkActionCode;
    successCountBucket: EformsignSdkSuccessCountBucket;
    successCode: EformsignSdkSuccessCode;
    errorPresent: boolean;
    bootErrorPresent: boolean;
}

export interface GateDialogPresence {
    requestSendDialogVisible: EformsignDiagnosticBoolean;
    inputCommentDialogVisible: EformsignDiagnosticBoolean;
    anyDialogVisible: EformsignDiagnosticBoolean;
}

export interface GateSnapshot extends GateDialogPresence {
    visibleButtonCount: EformsignDiagnosticCount;
    guideButtonVisible: boolean;
    headerButtonVisible: boolean;
}

export interface GateLocatorSelection {
    locator: Locator;
    candidateCount: EformsignDiagnosticCount;
    selectedIndex: EformsignDiagnosticIndex;
}

export interface EformsignGateDiagnostic extends GateDialogPresence {
    gate: EformsignDiagnosticGate;
    action: EformsignDiagnosticAction;
    selectedCategory: EformsignDiagnosticSelectedCategory;
    candidateCount: EformsignDiagnosticCount;
    selectedIndex: EformsignDiagnosticIndex;
    sdkActionPresent: boolean;
    sdkActionType: EformsignSdkActionType;
    sdkActionCode: EformsignSdkActionCode;
    successCountBucket: EformsignSdkSuccessCountBucket;
    successCode: EformsignSdkSuccessCode;
    errorPresent: boolean;
}

const EMPTY_SDK_DIAGNOSTIC_SUMMARY: EformsignSdkDiagnosticSummary = {
    actionPresent: false,
    actionType: "unknown",
    actionCode: "unknown",
    successCountBucket: "unknown",
    successCode: "unknown",
    errorPresent: false,
    bootErrorPresent: false,
};

const UNKNOWN_DIALOG_PRESENCE: GateDialogPresence = {
    requestSendDialogVisible: "unknown",
    inputCommentDialogVisible: "unknown",
    anyDialogVisible: "unknown",
};

function capDiagnosticCount(value: number): EformsignDiagnosticCount {
    if (!Number.isSafeInteger(value) || value < 0) return "overflow";
    return value > EFORMSIGN_DIAGNOSTIC_COUNT_CAP ? "overflow" : value;
}

function capDiagnosticIndex(value: number): EformsignDiagnosticIndex {
    if (!Number.isSafeInteger(value) || value < 0) return "unknown";
    return value >= EFORMSIGN_DIAGNOSTIC_COUNT_CAP ? "overflow" : value;
}

function normalizeSdkActionType(value: unknown): EformsignSdkActionType {
    if (
        value === EFORMSIGN_SDK_ACTION_CALLBACK_DOCUMENT_TYPE
        || value === EFORMSIGN_SDK_ACTION_CALLBACK_TEMPLATE_TYPE
    ) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") return "other";
    return "unknown";
}

function normalizeSdkActionCode(value: unknown): EformsignSdkActionCode {
    const normalized = typeof value === "string" || typeof value === "number"
        ? String(value)
        : undefined;
    if (
        normalized === EFORMSIGN_SDK_ACTION_CALLBACK_CREATE_CODE
        || normalized === EFORMSIGN_SDK_ACTION_CALLBACK_PROCESS_CODE
        || normalized === EFORMSIGN_SDK_ACTION_CALLBACK_RETURN_FIELDS_CODE
    ) {
        return normalized;
    }
    if (typeof value === "string" || typeof value === "number") return "other";
    return "unknown";
}

function normalizeSdkSuccessCode(value: unknown): EformsignSdkSuccessCode {
    if (value === "terminal_success" || value === "other" || value === "unknown") {
        return value;
    }
    return "unknown";
}

function normalizeSdkSuccessCountBucket(value: unknown): EformsignSdkSuccessCountBucket {
    if (value === "0" || value === "1" || value === "2+" || value === "unknown") {
        return value;
    }
    return "unknown";
}

function readProjectedSdkSummary(value: unknown): EformsignSdkDiagnosticSummary {
    if (typeof value !== "object" || value === null) return { ...EMPTY_SDK_DIAGNOSTIC_SUMMARY };
    const record = value as Record<string, unknown>;
    return {
        actionPresent: record["actionPresent"] === true,
        actionType: normalizeSdkActionType(record["actionType"]),
        actionCode: normalizeSdkActionCode(record["actionCode"]),
        successCountBucket: normalizeSdkSuccessCountBucket(record["successCountBucket"]),
        successCode: normalizeSdkSuccessCode(record["successCode"]),
        errorPresent: record["errorPresent"] === true,
        bootErrorPresent: record["bootErrorPresent"] === true,
    };
}

function normalizeGateError(error: unknown): string {
    if (!(error instanceof Error)) return "eformsign gate failed";
    const message = error.message;
    if (message.startsWith("Pre-send eformsign creation click timed out twice;")) {
        return "Pre-send eformsign creation click timed out twice; opening iframe fallback";
    }
    if (message.startsWith("Pre-send eformsign finalize click timed out twice;")) {
        return "Pre-send eformsign finalize click timed out twice; opening iframe fallback";
    }
    if (message.startsWith("Pre-send eformsign finalize confirmation popup timed out twice;")) {
        return "Pre-send eformsign finalize confirmation popup timed out twice; opening iframe fallback";
    }
    if (message.startsWith("Timed out after ")) return "eformsign gate timed out";
    return "eformsign gate failed";
}

function normalizeGateSnapshot(snapshot: unknown): GateSnapshot {
    if (typeof snapshot !== "object" || snapshot === null) {
        return {
            visibleButtonCount: "overflow",
            guideButtonVisible: false,
            headerButtonVisible: false,
            requestSendDialogVisible: false,
            inputCommentDialogVisible: false,
            anyDialogVisible: false,
        };
    }
    const value = snapshot as Record<string, unknown>;
    const isCount = value["visibleButtonCount"];
    return {
        visibleButtonCount: typeof isCount === "number" ? capDiagnosticCount(isCount) : "overflow",
        guideButtonVisible: value["guideButtonVisible"] === true,
        headerButtonVisible: value["headerButtonVisible"] === true,
        requestSendDialogVisible: value["requestSendDialogVisible"] === true,
        inputCommentDialogVisible: value["inputCommentDialogVisible"] === true,
        anyDialogVisible: value["anyDialogVisible"] === true,
    };
}

export async function getEformsignDialogPresence(
    eformsignFrame: FrameLocator,
    requestDialogSelector: string,
): Promise<GateDialogPresence> {
    try {
        const snapshot = await getEformsignGateSnapshot(
            eformsignFrame,
            requestDialogSelector,
            EFORMSIGN_DIAGNOSTIC_ATTRIBUTE_TIMEOUT_MS,
        );
        return {
            requestSendDialogVisible: snapshot.requestSendDialogVisible,
            inputCommentDialogVisible: snapshot.inputCommentDialogVisible,
            anyDialogVisible: snapshot.anyDialogVisible,
        };
    } catch {
        return { ...UNKNOWN_DIALOG_PRESENCE };
    }
}

/**
 * Returns the first visible match in `locator`, or null if none are visible.
 * Selectors like getByRole(...) often resolve to multiple DOM nodes inside
 * the eformsign iframe (hidden duplicates for mobile/desktop). We need the
 * one currently shown on screen.
 */
export async function findVisibleLocator(locator: Locator): Promise<Locator | null> {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }
    return null;
}

export async function findVisibleEnabledLocatorWithSelection(
    locator: Locator,
): Promise<GateLocatorSelection | null> {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;
        const className = await candidate.getAttribute("class").catch(() => null);
        const classDisabled = className?.split(/\s+/).includes("disabled") ?? false;
        if (classDisabled) continue;
        const enabled = await candidate.isEnabled().catch(() => false);
        if (enabled) {
            return {
                locator: candidate,
                candidateCount: capDiagnosticCount(count),
                selectedIndex: capDiagnosticIndex(index),
            };
        }
    }
    return null;
}

export async function findVisibleEnabledLocator(locator: Locator): Promise<Locator | null> {
    return (await findVisibleEnabledLocatorWithSelection(locator))?.locator ?? null;
}

/**
 * Classifies only fixed DOM attributes. It never returns labels, classes, IDs,
 * or any other user/vendor text to the caller.
 */
export async function classifyGateLocator(locator: Locator): Promise<EformsignDiagnosticSelectedCategory> {
    try {
        // Locator attribute reads auto-wait by default. Classification is
        // best-effort and runs before the click so DOM replacement cannot make
        // the selected ordinal point at a different button; keep the read
        // bounded and inspect only fixed IDs observed in the native QA template.
        const id = await locator.getAttribute("id", {
            timeout: EFORMSIGN_DIAGNOSTIC_ATTRIBUTE_TIMEOUT_MS,
        });
        if (id === "guideBtn") return "guide";
        if (id === "btn_unstructured_process_request" || id === "btn_unstructured_active") {
            return "header";
        }
        return "other";
    } catch {
        return "unknown";
    }
}

export function createGateDiagnostic(
    gate: EformsignDiagnosticGate,
    action: EformsignDiagnosticAction,
    selectedCategory: EformsignDiagnosticSelectedCategory,
    selection: GateLocatorSelection | null,
    dialogPresence: GateDialogPresence,
    sdkSummary: EformsignSdkDiagnosticSummary = EMPTY_SDK_DIAGNOSTIC_SUMMARY,
): EformsignGateDiagnostic {
    const candidateCount = selection?.candidateCount;
    const selectedIndex = selection?.selectedIndex;
    return {
        gate,
        action,
        selectedCategory,
        candidateCount:
            typeof candidateCount === "number"
                ? capDiagnosticCount(candidateCount)
                : candidateCount === "overflow" ? "overflow" : 0,
        selectedIndex:
            typeof selectedIndex === "number"
                ? capDiagnosticIndex(selectedIndex)
                : selectedIndex === "overflow" ? "overflow" : "unknown",
        ...dialogPresence,
        sdkActionPresent: sdkSummary.actionPresent,
        sdkActionType: sdkSummary.actionType,
        sdkActionCode: sdkSummary.actionCode,
        successCountBucket: sdkSummary.successCountBucket,
        successCode: sdkSummary.successCode,
        errorPresent: sdkSummary.errorPresent,
    };
}

export type EformsignGateClickOutcome = "clicked" | "timed-out" | "failed";

export async function getGateClickOutcome(locator: Locator): Promise<EformsignGateClickOutcome> {
    try {
        await locator.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
        return "clicked";
    } catch (error) {
        const reason = error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
        return /(?:timeout|timed out)/i.test(reason) ? "timed-out" : "failed";
    }
}

export async function tryClickGateLocator(locator: Locator): Promise<boolean> {
    return (await getGateClickOutcome(locator)) === "clicked";
}

export interface EformsignCallbackState {
    hasSuccess: boolean;
    hasError: boolean;
    success?: unknown;
    error?: unknown;
}

export function formatEformsignCallbackPayload(payload: unknown): string {
    // Kept as a compatibility shim for callers compiled against the old helper.
    // Callback payloads are intentionally never formatted or returned.
    void payload;
    return "redacted";
}

export async function readEformsignCallbackState(page: Page): Promise<EformsignCallbackState> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __eformsignSuccess?: unknown;
            __eformsignError?: unknown;
        };
        return {
            hasSuccess: w.__eformsignSuccess !== undefined,
            hasError: w.__eformsignError === true,
            success: w.__eformsignSuccess,
            error: undefined,
        };
    });
}

/**
 * Reads the fixed SDK projection created inside the embedded page. No callback
 * payload crosses into Node, including non-terminal or action payloads.
 */
export async function readEformsignSdkDiagnosticSummary(page: Page): Promise<EformsignSdkDiagnosticSummary> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const projected = await Promise.race([
        Promise.resolve().then(() => page.evaluate(() => {
            const w = window as unknown as { __eformsignDiagnostics?: unknown };
            return w.__eformsignDiagnostics;
        })),
        new Promise<undefined>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(undefined), EFORMSIGN_DIAGNOSTIC_EVALUATE_TIMEOUT_MS);
        }),
    ]).catch(() => undefined);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return readProjectedSdkSummary(projected);
}

/** @deprecated Use readEformsignSdkDiagnosticSummary. */
export async function readObservedSuccessCallbacks(page: Page): Promise<EformsignSdkDiagnosticSummary> {
    return readEformsignSdkDiagnosticSummary(page);
}

export function formatObservedSuccessCallbacks(
    summary: EformsignSdkDiagnosticSummary | readonly unknown[],
): string {
    // Keep the old formatter call shape source-compatible while ensuring an
    // accidental legacy array can never reintroduce raw callback payloads.
    return JSON.stringify(Array.isArray(summary) ? EMPTY_SDK_DIAGNOSTIC_SUMMARY : readProjectedSdkSummary(summary));
}

export async function throwIfEformsignErrorLatched(page: Page): Promise<void> {
    const state = await readEformsignCallbackState(page).catch(() => null);
    if (!state?.hasError) return;
    throw new Error("eformsign SDK reported an error");
}

export async function getEformsignGateSnapshot(
    eformsignFrame: FrameLocator,
    requestDialogSelector = REQUEST_SEND_DIALOG_SELECTOR,
    timeoutMs = 3_000,
): Promise<GateSnapshot> {
    const snapshot = await eformsignFrame.locator("body").evaluate(
        (body, { requestDialogSelector }) => {
            const isVisible = (element: Element | null): element is HTMLElement => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                const style = window.getComputedStyle(element);
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                    return false;
                }
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const visibleButtonCount = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
                .filter((button) => isVisible(button)).length;
            const guideButtonVisible = isVisible(body.querySelector<HTMLElement>("#guideBtn"));
            const headerButtonVisible = Array.from(
                body.querySelectorAll<HTMLElement>("header button, [role='banner'] button, .header button"),
            ).some((button) => isVisible(button));
            const requestSendDialogVisible = isVisible(body.querySelector<HTMLElement>(requestDialogSelector));
            const inputCommentDialogVisible = isVisible(body.querySelector<HTMLElement>("#inputCommentPopup"));
            const anyDialogVisible = Array.from(
                body.querySelectorAll<HTMLElement>("dialog, [role='dialog'], #inputCommentPopup, #requestWithInputCommentPopup"),
            ).some((dialog) => isVisible(dialog));

            return {
                visibleButtonCount,
                guideButtonVisible,
                headerButtonVisible,
                requestSendDialogVisible,
                inputCommentDialogVisible,
                anyDialogVisible,
            };
        },
        {
            requestDialogSelector,
        },
        // Diagnostics must never stall a failing dispatch: the body walk is
        // expensive and evaluate would otherwise inherit Playwright's 30s default.
        { timeout: timeoutMs },
    );
    return normalizeGateSnapshot(snapshot);
}

export async function createGateErrorWithSnapshot(
    error: unknown,
    eformsignFrame: FrameLocator,
    requestDialogSelector: string,
): Promise<Error> {
    const reason = normalizeGateError(error);
    try {
        const snapshot = await getEformsignGateSnapshot(eformsignFrame, requestDialogSelector);
        return new Error(`${reason}. Snapshot: ${JSON.stringify(normalizeGateSnapshot(snapshot))}`);
    } catch {
        return new Error(`${reason}. Snapshot: unavailable`);
    }
}

/**
 * Watches `window.__eformsignSuccess`, which `buildEmbeddedSdkHtml` sets only
 * for a success callback carrying `EFORMSIGN_SDK_COMPLETION_CODE`. A gate loop
 * exits on this, so it must stay the *terminal* signal: latching on any success
 * callback would let the loop stop before it clicked the popup 전송 that
 * actually submits the document.
 */
export async function isSuccessLatched(page: Page): Promise<boolean> {
    return page
        .evaluate(() => {
            const w = window as unknown as { __eformsignSuccess?: unknown };
            return w.__eformsignSuccess !== undefined;
        })
        .catch(() => false);
}

/**
 * Checks for the terminal document identity inside the page. Only the boolean
 * crosses the frame boundary; the raw identity remains internal for the service
 * result path.
 */
export async function hasTerminalDocumentId(page: Page): Promise<boolean> {
    return page
        .evaluate(() => {
            const w = window as unknown as { __eformsignSuccess?: unknown };
            const payload = w.__eformsignSuccess;
            if (typeof payload !== "object" || payload === null) return false;
            const documentId = (payload as { document_id?: unknown }).document_id;
            return typeof documentId === "string" && documentId.trim().length > 0;
        })
        .catch(() => false);
}

export async function pollSuccess(page: Page): Promise<boolean> {
    return isSuccessLatched(page);
}
