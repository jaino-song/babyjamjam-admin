import type { FrameLocator, Locator, Logger, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS,
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT,
    EFORMSIGN_READY_TEXT,
    REQUEST_SEND_DIALOG_SELECTOR,
    classifyGateLocator,
    createGateDiagnostic,
    createGateErrorWithSnapshot,
    findVisibleEnabledLocatorWithSelection,
    findVisibleLocator,
    getEformsignDialogPresence,
    getGateClickOutcome,
    getEformsignGateSnapshot,
    hasTerminalDocumentId,
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

// How long eformsign gets to render the editor far enough to expose its first
// actionable gate button. Measured spread on the same template/client is wide —
// 6s on a healthy run, 64s when the vendor is slow — so this budget is sized for
// the slow end, not the median.
const EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS = 70_000;
// How long the click sequence itself gets, measured from the first successful
// click. Kept separate from the wait budget on purpose: sharing one deadline let
// a slow editor render starve the sequence, which needs only ~2s in practice.
const EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS = 30_000;
// Older templates open a confirmation popup from top-level 전송, while newer
// direct-send templates can submit immediately. Wait briefly for the popup,
// but never click the same top-level action twice when its outcome is ambiguous.
const EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS = 4;

/**
 * Drive the creation iframe (mode:"01") through the deterministic gate
 * sequence: 입력 시작 → 회사 도장 ×3 (확인 ×3) → 다음 ×2 → 전송 → popup 전송.
 * Lifted from `frontend/tests/contract-creation.smoke.spec.ts`. Selectors are
 * Korean accessibility names so they survive eformsign DOM refactors.
 */
export async function runEformsignCreationGates(
    page: Page,
    eformsignFrame: FrameLocator,
    logger: NestLogger | Logger | Console = console,
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>,
): Promise<"success-latched" | "request-send-clicked" | "request-send-attempted"> {
    const startedAt = Date.now();
    let deadline = startedAt + EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS;
    let lastAction = "none";
    let stampConfirmCount = 0;
    let infoInsertedEmitted = false;
    let lastDiagnosticAt = startedAt;
    let firstActionAt: number | null = null;
    let topLevelSendAttempted = false;
    let topLevelSendPopupWaitPolls = 0;
    let ignoredPostTopLevelSuccessLogged = false;
    let preSendClickTimeoutCount = 0;
    let sendAttemptedEmitted = false;

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
        const dialogPresence = await getEformsignDialogPresence(
            eformsignFrame,
            REQUEST_SEND_DIALOG_SELECTOR,
        );
        const sdkSummary = await readEformsignSdkDiagnosticSummary(page).catch(() => undefined);
        const diagnostic = createGateDiagnostic(
            "creation",
            action,
            selectedCategory,
            selection,
            dialogPresence,
            sdkSummary,
        );
        logMessage(`[creation-gate] diagnostic ${JSON.stringify(diagnostic)}`);
    };

    const classifySelection = async (
        selection: GateLocatorSelection,
    ): Promise<EformsignDiagnosticSelectedCategory> =>
        classifyGateLocator(selection.locator).catch(() => "unknown" as const);

    // Records a *successful* gate click. The first one hands the sequence its own
    // budget so however long the editor took to appear, the clicks still get a
    // full window. Failed-click retries deliberately don't come through here.
    const noteAction = (action: string): void => {
        lastAction = action;
        if (firstActionAt !== null) return;
        firstActionAt = Date.now();
        deadline = firstActionAt + EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS;
    };

    const emitIdleDiagnostic = async (): Promise<void> => {
        if (Date.now() - lastDiagnosticAt < EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS) return;
        lastDiagnosticAt = Date.now();
        const snapshot = await getEformsignGateSnapshot(eformsignFrame, REQUEST_SEND_DIALOG_SELECTOR).catch(
            () => null,
        );
        const sdkSummary = await readEformsignSdkDiagnosticSummary(page).catch(() => undefined);
        const diagnostic = createGateDiagnostic(
            "creation",
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
        logMessage(`[creation-gate] diagnostic ${JSON.stringify(diagnostic)}`);
    };

    const emitInfoInserted = async () => {
        if (infoInsertedEmitted) return;
        infoInsertedEmitted = true;
        await onProgress?.("info-inserted");
    };

    const emitSendAttempted = async () => {
        if (sendAttemptedEmitted) return;
        sendAttemptedEmitted = true;
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
                    "Pre-send eformsign creation click timed out twice; opening iframe fallback",
                );
            }
        } else {
            lastAction = `${action} click failed; retrying`;
        }
        return false;
    };

    try {
        while (Date.now() < deadline) {
            await throwIfEformsignErrorLatched(page);

            if (await isSuccessLatched(page)) {
                if (topLevelSendAttempted) {
                    if (await hasTerminalDocumentId(page)) {
                        logMessage("[creation-gate] terminal success latched after top-level send");
                        return "success-latched";
                    }
                    if (!ignoredPostTopLevelSuccessLogged) {
                        ignoredPostTopLevelSuccessLogged = true;
                        const message = "[creation-gate] ignoring SDK success latched before popup 전송";
                        logMessage(message);
                    }
                } else {
                    logMessage("[creation-gate] terminal success latched");
                    return "success-latched";
                }
            }

            await emitIdleDiagnostic();

            const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);

            // 회사 도장 dialog: appears 3 times, "확인" each time.
            const confirmButton = await findVisibleEnabledLocatorWithSelection(
                eformsignFrame.getByRole("button", { name: "확인" }),
            );
            if (confirmButton) {
                const selectedCategory = await classifySelection(confirmButton);
                if (!(await tryPreSendClick(confirmButton.locator, "confirm"))) {
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                await logActionDiagnostic("confirm", confirmButton, selectedCategory);
                stampConfirmCount++;
                if (stampConfirmCount >= 3) {
                    await emitInfoInserted();
                }
                noteAction("confirm");
                await page.waitForTimeout(250);
                continue;
            }

            // popup-level 전송 inside #requestWithInputCommentPopup terminates the gate loop.
            const requestSendButton = await findVisibleEnabledLocatorWithSelection(
                requestSendDialog.getByRole("button", { name: "전송" }),
            );
            if (requestSendButton) {
                const selectedCategory = await classifySelection(requestSendButton);
                // Persist the ambiguity fence before the provider can observe
                // the click. If persistence fails, abort without submitting.
                await emitInfoInserted();
                await emitSendAttempted();
                if (!(await tryClickGateLocator(requestSendButton.locator))) {
                    lastAction = "popup 전송 click outcome ambiguous; reconciling";
                    const message =
                        "[creation-gate] popup 전송 click outcome is ambiguous; reconciling without retry";
                    logMessage(message);
                    return "request-send-attempted";
                }
                await logActionDiagnostic("send_popup", requestSendButton, selectedCategory);
                return "request-send-clicked";
            }

            const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
            if (topLevelSendAttempted && !requestSendDialogVisible) {
                topLevelSendPopupWaitPolls += 1;
            }
            const popupWaitExpired =
                topLevelSendPopupWaitPolls >= EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS;
            if (popupWaitExpired) {
                lastAction = "top-level 전송 may have submitted directly; reconciling";
                logMessage(
                    "[creation-gate] confirmation popup did not appear after top-level 전송; " +
                        "reconciling without retry",
                );
                return "request-send-attempted";
            }

            const topLevelSendButton = requestSendDialogVisible
                || (topLevelSendAttempted && !popupWaitExpired)
                ? null
                : await findVisibleEnabledLocatorWithSelection(eformsignFrame.getByRole("button", { name: "전송" }));
            if (topLevelSendButton) {
                const selectedCategory = await classifySelection(topLevelSendButton);
                const isFinalTopLevelSend = stampConfirmCount >= 3 || infoInsertedEmitted;
                topLevelSendAttempted = true;
                topLevelSendPopupWaitPolls = 0;
                if (isFinalTopLevelSend) {
                    await emitInfoInserted();
                }
                await emitSendAttempted();

                if (!(await tryClickGateLocator(topLevelSendButton.locator))) {
                    lastAction = "top-level 전송 click outcome ambiguous; waiting for popup";
                    noteAction(lastAction);
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                await logActionDiagnostic("send_top_level", topLevelSendButton, selectedCategory);
                noteAction("send_top_level");
                await page.waitForTimeout(250);
                continue;
            }

            if (topLevelSendAttempted) {
                await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                continue;
            }

            const nextButton = await findVisibleEnabledLocatorWithSelection(
                eformsignFrame.getByRole("button", { name: "다음" }),
            );
            if (nextButton) {
                const selectedCategory = await classifySelection(nextButton);
                if (!(await tryPreSendClick(nextButton.locator, "다음"))) {
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                await logActionDiagnostic("next", nextButton, selectedCategory);
                noteAction("next");
                await page.waitForTimeout(250);
                continue;
            }

            const startButton = await findVisibleEnabledLocatorWithSelection(
                eformsignFrame.getByRole("button", { name: "입력 시작" }),
            );
            if (startButton) {
                const selectedCategory = await classifySelection(startButton);
                if (!(await tryPreSendClick(startButton.locator, "start"))) {
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                await logActionDiagnostic("start", startButton, selectedCategory);
                noteAction("start");
                await page.waitForTimeout(250);
                continue;
            }

            const readyMessage = await findVisibleLocator(
                eformsignFrame.getByText(EFORMSIGN_READY_TEXT, { exact: true }),
            );
            if (readyMessage) {
                await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                continue;
            }

            await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
        }
    } catch (error) {
        throw await createGateErrorWithSnapshot(
            error,
            eformsignFrame,
            REQUEST_SEND_DIALOG_SELECTOR,
        );
    }

    const phase = firstActionAt === null
        ? `no gate became actionable within ${EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS}ms`
        : `sequence stalled ${Date.now() - firstActionAt}ms after its first click `
            + `(budget ${EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS}ms)`;
    throw await createGateErrorWithSnapshot(
        new Error(
            `Timed out after ${Date.now() - startedAt}ms while advancing eformsign creation gates: ${phase}. ` +
                `Last action: ${lastAction}`,
        ),
        eformsignFrame,
        REQUEST_SEND_DIALOG_SELECTOR,
    );
}
