import type { FrameLocator, Logger, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_READY_TEXT,
    REQUEST_SEND_DIALOG_SELECTOR,
    findVisibleLocator,
    getEformsignGateSnapshot,
    isSuccessLatched,
} from "./eformsign-gate-utils";

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
): Promise<"success-latched" | "request-send-clicked"> {
    const deadline = Date.now() + EFORMSIGN_CREATION_GATE_TIMEOUT_MS;
    let lastAction = "none";

    while (Date.now() < deadline) {
        if (await isSuccessLatched(page)) {
            return "success-latched";
        }

        const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);

        // 회사 도장 dialog: appears 3 times, "확인" each time.
        const confirmButton = await findVisibleLocator(eformsignFrame.getByRole("button", { name: "확인" }));
        if (confirmButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 회사 도장 확인") ??
                console.log("[creation-gate] clicked 회사 도장 확인");
            await confirmButton.click();
            lastAction = "clicked 회사 도장 확인";
            await page.waitForTimeout(250);
            continue;
        }

        // popup-level 전송 inside #requestWithInputCommentPopup terminates the gate loop.
        const requestSendButton = await findVisibleLocator(
            requestSendDialog.getByRole("button", { name: "전송" }),
        );
        if (requestSendButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked popup 전송") ??
                console.log("[creation-gate] clicked popup 전송");
            await requestSendButton.click();
            return "request-send-clicked";
        }

        const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
        const topLevelSendButton = requestSendDialogVisible
            ? null
            : await findVisibleLocator(eformsignFrame.getByRole("button", { name: "전송" }));
        if (topLevelSendButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked top-level 전송") ??
                console.log("[creation-gate] clicked top-level 전송");
            await topLevelSendButton.click();
            lastAction = "clicked top-level 전송";
            await page.waitForTimeout(250);
            continue;
        }

        const nextButton = await findVisibleLocator(eformsignFrame.getByRole("button", { name: "다음" }));
        if (nextButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 다음") ??
                console.log("[creation-gate] clicked 다음");
            await nextButton.click();
            lastAction = "clicked 다음";
            await page.waitForTimeout(250);
            continue;
        }

        const startButton = await findVisibleLocator(
            eformsignFrame.getByRole("button", { name: "입력 시작" }),
        );
        if (startButton) {
            (logger as NestLogger).log?.("[creation-gate] clicked 입력 시작") ??
                console.log("[creation-gate] clicked 입력 시작");
            await startButton.click();
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
