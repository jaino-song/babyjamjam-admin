import type { FrameLocator, Locator, Page } from "playwright-core";

export const EFORMSIGN_GATE_POLL_MS = 500;
export const EFORMSIGN_READY_TEXT = "필수 입력 항목을 모두 작성했습니다.";
export const REQUEST_SEND_DIALOG_SELECTOR = "#requestWithInputCommentPopup";

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

export interface GateSnapshot {
    visibleButtons: string[];
    guideButtonLabel: string | null;
    footerMessages: string[];
    requestSendDialogVisible: boolean;
}

export async function getEformsignGateSnapshot(eformsignFrame: FrameLocator): Promise<GateSnapshot> {
    return eformsignFrame.locator("body").evaluate(
        (body, { readyText, requestDialogSelector }) => {
            const normalize = (value: string | null | undefined): string =>
                (value ?? "").replace(/\s+/g, " ").trim();

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

            const visibleButtons = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
                .filter((button) => isVisible(button))
                .map((button) => normalize(button.innerText))
                .filter(Boolean);

            const footerMessages = Array.from(body.querySelectorAll<HTMLElement>("*"))
                .filter((element) => isVisible(element))
                .map((element) => normalize(element.innerText))
                .filter((text) => text.includes(readyText) || text.startsWith("필수 입력 항목("));

            const guideButton = body.querySelector<HTMLElement>("#guideBtn");
            const requestSendDialog = body.querySelector<HTMLElement>(requestDialogSelector);

            return {
                visibleButtons: Array.from(new Set(visibleButtons)),
                guideButtonLabel: isVisible(guideButton) ? normalize(guideButton.innerText) : null,
                footerMessages: Array.from(new Set(footerMessages)).slice(0, 5),
                requestSendDialogVisible: isVisible(requestSendDialog),
            };
        },
        {
            readyText: EFORMSIGN_READY_TEXT,
            requestDialogSelector: REQUEST_SEND_DIALOG_SELECTOR,
        },
    );
}

/**
 * Watches `window.__eformsignSuccess`, set by the SDK success callback wired
 * in `buildEmbeddedSdkHtml`. Returns true once the dispatch is confirmed,
 * false if the timeout elapsed first.
 */
export async function isSuccessLatched(page: Page): Promise<boolean> {
    return page
        .evaluate(() => Boolean((window as unknown as { __eformsignSuccess?: unknown }).__eformsignSuccess))
        .catch(() => false);
}

export async function pollSuccess(page: Page): Promise<boolean> {
    return isSuccessLatched(page);
}
