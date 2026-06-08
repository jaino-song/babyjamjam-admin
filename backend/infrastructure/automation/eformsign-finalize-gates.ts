import type { FrameLocator, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_CLICK_TIMEOUT_MS,
    EFORMSIGN_GATE_POLL_MS,
    FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    findVisibleEnabledLocator,
    getEformsignGateSnapshot,
    isSuccessLatched,
    throwIfEformsignErrorLatched,
} from "./eformsign-gate-utils";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

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
    onProgress?: (step: EformsignHeadlessProgressStep) => void,
): Promise<"success-latched" | "request-send-clicked"> {
    const deadline = Date.now() + EFORMSIGN_FINALIZE_GATE_TIMEOUT_MS;
    let lastAction = "none";
    let creatingEmitted = false;

    // Finalize prefill (서비스 종료일) is applied via the SDK options before the
    // iframe even renders, so as soon as we reach the gate loop the data is
    // effectively "inserted". Mirrors creation's info-inserted semantics.
    onProgress?.("info-inserted");

    const emitCreating = () => {
        if (creatingEmitted) return;
        creatingEmitted = true;
        onProgress?.("creating");
    };

    while (Date.now() < deadline) {
        await throwIfEformsignErrorLatched(page);

        if (await isSuccessLatched(page)) {
            return "success-latched";
        }

        const requestSendDialog = eformsignFrame.locator(FINALIZE_REQUEST_SEND_DIALOG_SELECTOR);

        const requestSendButton = await findVisibleEnabledLocator(
            requestSendDialog.getByRole("button", { name: "전송" }),
        );
        if (requestSendButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked popup 전송") ??
                console.log("[finalize-gate] clicked popup 전송");
            emitCreating();
            await requestSendButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            return "request-send-clicked";
        }

        const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
        const topLevelSendButton = requestSendDialogVisible
            ? null
            : await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "전송" }));
        if (topLevelSendButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked top-level 전송") ??
                console.log("[finalize-gate] clicked top-level 전송");
            emitCreating();
            await topLevelSendButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
            lastAction = "clicked top-level 전송";
            await page.waitForTimeout(250);
            continue;
        }

        // mode:"02" sometimes shows a 확인 dialog before allowing 전송.
        const confirmButton = await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "확인" }));
        if (confirmButton) {
            (logger as NestLogger).log?.("[finalize-gate] clicked 확인") ??
                console.log("[finalize-gate] clicked 확인");
            await confirmButton.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
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
