import type { FrameLocator, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_POLL_MS,
    REQUEST_SEND_DIALOG_SELECTOR,
    findVisibleLocator,
    getEformsignGateSnapshot,
    isSuccessLatched,
} from "./eformsign-gate-utils";

const EFORMSIGN_FINALIZE_GATE_TIMEOUT_MS = 30_000;

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
): Promise<"success-latched" | "request-send-clicked"> {
    const deadline = Date.now() + EFORMSIGN_FINALIZE_GATE_TIMEOUT_MS;
    let lastAction = "none";

    while (Date.now() < deadline) {
        if (await isSuccessLatched(page)) {
            return "success-latched";
        }

        const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);

        const requestSendButton = await findVisibleLocator(
            requestSendDialog.getByRole("button", { name: "전송" }),
        );
        if (requestSendButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked popup 전송") ??
                console.log("[finalize-gate] clicked popup 전송");
            await requestSendButton.click();
            return "request-send-clicked";
        }

        const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
        const topLevelSendButton = requestSendDialogVisible
            ? null
            : await findVisibleLocator(eformsignFrame.getByRole("button", { name: "전송" }));
        if (topLevelSendButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked top-level 전송") ??
                console.log("[finalize-gate] clicked top-level 전송");
            await topLevelSendButton.click();
            lastAction = "clicked top-level 전송";
            await page.waitForTimeout(250);
            continue;
        }

        // mode:"02" sometimes shows a 확인 dialog before allowing 전송.
        const confirmButton = await findVisibleLocator(eformsignFrame.getByRole("button", { name: "확인" }));
        if (confirmButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked 확인") ??
                console.log("[finalize-gate] clicked 확인");
            await confirmButton.click();
            lastAction = "clicked 확인";
            await page.waitForTimeout(250);
            continue;
        }

        await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
    }

    const snapshot = await getEformsignGateSnapshot(eformsignFrame);
    throw new Error(
        `Timed out after ${EFORMSIGN_FINALIZE_GATE_TIMEOUT_MS}ms while advancing eformsign finalize gates. ` +
            `Last action: ${lastAction}. Snapshot: ${JSON.stringify(snapshot)}`,
    );
}
