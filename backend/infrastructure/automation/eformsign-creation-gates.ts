import type { FrameLocator, Logger, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_CLICK_TIMEOUT_MS,
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_READY_TEXT,
    REQUEST_SEND_DIALOG_SELECTOR,
    findVisibleEnabledLocator,
    findVisibleLocator,
    getEformsignGateSnapshot,
    isSuccessLatched,
    throwIfEformsignErrorLatched,
} from "./eformsign-gate-utils";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

const EFORMSIGN_CREATION_GATE_TIMEOUT_MS = 60_000;

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
    onProgress?: (step: EformsignHeadlessProgressStep) => void,
): Promise<"success-latched" | "request-send-clicked"> {
    const deadline = Date.now() + EFORMSIGN_CREATION_GATE_TIMEOUT_MS;
    let lastAction = "none";
    let stampConfirmCount = 0;
    let infoInsertedEmitted = false;

    const emitInfoInserted = () => {
        if (infoInsertedEmitted) return;
        infoInsertedEmitted = true;
        onProgress?.("info-inserted");
    };

    while (Date.now() < deadline) {
        await throwIfEformsignErrorLatched(page);

        if (await isSuccessLatched(page)) {
            return "success-latched";
        }

        const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);

        // 회사 도장 dialog: appears 3 times, "확인" each time.
        const confirmButton = await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "확인" }));
        if (confirmButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 회사 도장 확인") ??
                console.log("[creation-gate] clicked 회사 도장 확인");
            await confirmButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            stampConfirmCount++;
            if (stampConfirmCount >= 3) {
                emitInfoInserted();
            }
            lastAction = "clicked 회사 도장 확인";
            await page.waitForTimeout(250);
            continue;
        }

        // popup-level 전송 inside #requestWithInputCommentPopup terminates the gate loop.
        const requestSendButton = await findVisibleEnabledLocator(
            requestSendDialog.getByRole("button", { name: "전송" }),
        );
        if (requestSendButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked popup 전송") ??
                console.log("[creation-gate] clicked popup 전송");
            await requestSendButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            emitInfoInserted();
            onProgress?.("creating");
            return "request-send-clicked";
        }

        const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
        const topLevelSendButton = requestSendDialogVisible
            ? null
            : await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "전송" }));
        if (topLevelSendButton) {
            const isFinalTopLevelSend = stampConfirmCount >= 3 || infoInsertedEmitted;

            (logger as NestLogger).log?.("[creation-gate] clicked top-level 전송") ??
                console.log("[creation-gate] clicked top-level 전송");
            await topLevelSendButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            if (isFinalTopLevelSend) {
                emitInfoInserted();
                onProgress?.("creating");
            }
            lastAction = "clicked top-level 전송";
            await page.waitForTimeout(250);
            continue;
        }

        const nextButton = await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "다음" }));
        if (nextButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 다음") ??
                console.log("[creation-gate] clicked 다음");
            await nextButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            lastAction = "clicked 다음";
            await page.waitForTimeout(250);
            continue;
        }

        const startButton = await findVisibleEnabledLocator(
            eformsignFrame.getByRole("button", { name: "입력 시작" }),
        );
        if (startButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 입력 시작") ??
                console.log("[creation-gate] clicked 입력 시작");
            await startButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            lastAction = "clicked 입력 시작";
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

    const snapshot = await getEformsignGateSnapshot(eformsignFrame);
    throw new Error(
        `Timed out after ${EFORMSIGN_CREATION_GATE_TIMEOUT_MS}ms while advancing eformsign creation gates. ` +
            `Last action: ${lastAction}. Snapshot: ${JSON.stringify(snapshot)}`,
    );
}
