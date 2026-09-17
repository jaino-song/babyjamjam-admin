import type { FrameLocator, Locator, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS,
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT,
    FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    classifyGateLocator,
    createGateDiagnostic,
    createGateErrorWithSnapshot,
    findVisibleEnabledLocatorWithSelection,
    getGateClickOutcome,
    getEformsignDialogPresence,
    getEformsignGateSnapshot,
    isSuccessLatched,
    readEformsignSdkDiagnosticSummary,
    throwIfEformsignErrorLatched,
    tryClickGateLocator,
} from "./eformsign-gate-utils";
import type {
    EformsignDiagnosticAction,
    EformsignDiagnosticSelectedCategory,
    GateLocatorSelection,
} from "./eformsign-gate-utils";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

// Same split as the creation gates: eformsign's editor render time varies by an
// order of magnitude, so waiting for the first actionable gate gets its own
// budget and must not eat into the click sequence that follows.
const EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS = 70_000;
const EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS = 30_000;
const EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS = 4;

/**
 * Drive the staff-finalize iframe (mode:"02") through its short gate sequence:
 * top-level 전송 → popup 전송. The doc is already filled, so there is no
 * 입력 시작 / 회사 도장 / 다음 cycle. Selectors mirror the creation gates so
 * an eformsign UI refactor only needs one update.
 */
export async function runEformsignFinalizeGates(
    page: Page,
    eformsignFrame: FrameLocator,
    logger: NestLogger | Console = console,
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>,
): Promise<"success-latched" | "request-send-clicked" | "request-send-attempted"> {
    const startedAt = Date.now();
    let deadline = startedAt + EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS;
    let lastAction = "none";
    let creatingEmitted = false;
    let lastDiagnosticAt = startedAt;
    let firstActionAt: number | null = null;
    let topLevelSendAttempted = false;
    let topLevelSendClickCount = 0;
    let topLevelSendPopupWaitPolls = 0;
    let preSendClickTimeoutCount = 0;

    const logMessage = (message: string): void => {
        const log = (logger as NestLogger).log;
        if (typeof log === "function") log.call(logger, message);
        else console.log(message);
    };

    const logActionDiagnostic = async (
        action: EformsignDiagnosticAction,
        selection: GateLocatorSelection | null,
        selectedCategory: EformsignDiagnosticSelectedCategory,
    ): Promise<void> => {
        try {
            const dialogPresence = await getEformsignDialogPresence(
                eformsignFrame,
                FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
            );
            const sdkSummary = await readEformsignSdkDiagnosticSummary(page).catch(() => undefined);
            const diagnostic = createGateDiagnostic(
                "finalize",
                action,
                selectedCategory,
                selection,
                dialogPresence,
                sdkSummary,
            );
            logMessage(`[finalize-gate] diagnostic ${JSON.stringify(diagnostic)}`);
        } catch {
            // Diagnostics are best-effort and must never alter the gate outcome.
        }
    };

    const classifySelection = async (
        selection: GateLocatorSelection,
    ): Promise<EformsignDiagnosticSelectedCategory> =>
        classifyGateLocator(selection.locator).catch(() => "unknown" as const);

    const noteAction = (action: string): void => {
        lastAction = action;
        if (firstActionAt !== null) return;
        firstActionAt = Date.now();
        deadline = firstActionAt + EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS;
    };

    const emitIdleDiagnostic = async (): Promise<void> => {
        if (Date.now() - lastDiagnosticAt < EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS) return;
        lastDiagnosticAt = Date.now();
        const snapshot = await getEformsignGateSnapshot(
            eformsignFrame,
            FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
        ).catch(() => null);
        const sdkSummary = await readEformsignSdkDiagnosticSummary(page).catch(() => undefined);
        const diagnostic = createGateDiagnostic(
            "finalize",
            "other",
            "unknown",
            null,
            snapshot ?? {
                requestSendDialogVisible: "unknown",
                inputCommentDialogVisible: "unknown",
                anyDialogVisible: "unknown",
            },
            sdkSummary,
        );
        logMessage(`[finalize-gate] diagnostic ${JSON.stringify(diagnostic)}`);
    };

    // Finalize prefill (서비스 종료일) is applied via the SDK options before the
    // iframe even renders, so as soon as we reach the gate loop the data is
    // effectively "inserted". Mirrors creation's info-inserted semantics.
    await onProgress?.("info-inserted");

    const emitCreating = async () => {
        if (creatingEmitted) return;
        creatingEmitted = true;
        await onProgress?.("creating");
    };

    const tryPreSendClick = async (locator: Locator, action: string): Promise<boolean> => {
        const outcome = await getGateClickOutcome(locator);
        if (outcome === "clicked") return true;

        if (outcome === "timed-out") {
            preSendClickTimeoutCount += 1;
            lastAction =
                `${action} click timed out ` +
                `(${preSendClickTimeoutCount}/${EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT})`;
            if (preSendClickTimeoutCount >= EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT) {
                throw new Error(
                    "Pre-send eformsign finalize click timed out twice; opening iframe fallback",
                );
            }
        } else {
            lastAction = `${action} click failed; retrying`;
        }
        return false;
    };

    const tryPreSendClickWithDiagnostic = async (
        locator: Locator,
        clickAction: string,
        diagnosticAction: EformsignDiagnosticAction,
        selection: GateLocatorSelection,
        selectedCategory: EformsignDiagnosticSelectedCategory,
    ): Promise<boolean> => {
        try {
            const clicked = await tryPreSendClick(locator, clickAction);
            await logActionDiagnostic(diagnosticAction, selection, selectedCategory);
            return clicked;
        } catch (error) {
            await logActionDiagnostic(diagnosticAction, selection, selectedCategory);
            throw error;
        }
    };

    try {
        while (Date.now() < deadline) {
            await throwIfEformsignErrorLatched(page);

            if (await isSuccessLatched(page)) {
                // A no-popup template can complete or advance directly from the
                // top-level 전송. The caller always verifies this latch against the
                // vendor's current workflow state; an unchanged document is still
                // rejected and sent to the iframe fallback.
                logMessage("[finalize-gate] terminal success latched");
                return "success-latched";
            }

            await emitIdleDiagnostic();

            const requestSendDialog = eformsignFrame.locator(FINALIZE_REQUEST_SEND_DIALOG_SELECTOR);

            const requestSendButton = await findVisibleEnabledLocatorWithSelection(
                requestSendDialog.getByRole("button", { name: "전송" }),
            );
            if (requestSendButton) {
                const selectedCategory = await classifySelection(requestSendButton);
                // The durable fence must commit before any provider-side send.
                await emitCreating();
                let clicked = false;
                try {
                    clicked = await tryClickGateLocator(requestSendButton.locator);
                } finally {
                    await logActionDiagnostic("send_popup", requestSendButton, selectedCategory);
                }
                if (!clicked) {
                    lastAction = "popup 전송 click outcome ambiguous; reconciling";
                    const message =
                        "[finalize-gate] popup 전송 click outcome is ambiguous; reconciling without retry";
                    logMessage(message);
                    return "request-send-attempted";
                }
                return "request-send-clicked";
            }

            const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
            if (topLevelSendAttempted && !requestSendDialogVisible) {
                topLevelSendPopupWaitPolls += 1;
            }
            const popupWaitExpired =
                topLevelSendPopupWaitPolls >= EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS;
            if (
                popupWaitExpired
                && topLevelSendClickCount >= EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT
            ) {
                throw new Error(
                    "Pre-send eformsign finalize confirmation popup timed out twice; opening iframe fallback",
                );
            }

            const topLevelSendButton = requestSendDialogVisible
                || (topLevelSendAttempted && !popupWaitExpired)
                ? null
                : await findVisibleEnabledLocatorWithSelection(eformsignFrame.getByRole("button", { name: "전송" }));
            if (topLevelSendButton) {
                const selectedCategory = await classifySelection(topLevelSendButton);
                topLevelSendAttempted = true;
                topLevelSendClickCount += 1;
                topLevelSendPopupWaitPolls = 0;
                await emitCreating();
                let clicked = false;
                try {
                    clicked = await tryClickGateLocator(topLevelSendButton.locator);
                } finally {
                    await logActionDiagnostic("send_top_level", topLevelSendButton, selectedCategory);
                }
                if (!clicked) {
                    lastAction = "top-level 전송 click outcome ambiguous; waiting for popup";
                    noteAction(lastAction);
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                noteAction("send_top_level");
                await page.waitForTimeout(250);
                continue;
            }

            if (topLevelSendAttempted) {
                await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                continue;
            }

            // mode:"02" sometimes shows a 확인 dialog before allowing 전송.
            const confirmButton = await findVisibleEnabledLocatorWithSelection(
                eformsignFrame.getByRole("button", { name: "확인" }),
            );
            if (confirmButton) {
                const selectedCategory = await classifySelection(confirmButton);
                if (!(await tryPreSendClickWithDiagnostic(
                    confirmButton.locator,
                    "confirm",
                    "confirm",
                    confirmButton,
                    selectedCategory,
                ))) {
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                noteAction("confirm");
                await page.waitForTimeout(250);
                continue;
            }

            await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
        }
    } catch (error) {
        throw await createGateErrorWithSnapshot(
            error,
            eformsignFrame,
            FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
        );
    }

    const phase = firstActionAt === null
        ? `no gate became actionable within ${EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS}ms`
        : `sequence stalled ${Date.now() - firstActionAt}ms after its first click `
            + `(budget ${EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS}ms)`;
    throw await createGateErrorWithSnapshot(
        new Error(
            `Timed out after ${Date.now() - startedAt}ms while advancing eformsign finalize gates: ${phase}. ` +
                `Last action: ${lastAction}`,
        ),
        eformsignFrame,
        FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    );
}
