import type { FrameLocator, Locator, Page } from "playwright-core";

import { runEformsignFinalizeGates } from "../../infrastructure/automation/eformsign-finalize-gates";

describe("runEformsignFinalizeGates", () => {
    function visibleLocator(overrides: Partial<Locator> = {}): Locator {
        return {
            isVisible: jest.fn().mockResolvedValue(true),
            isEnabled: jest.fn().mockResolvedValue(true),
            click: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        } as unknown as Locator;
    }

    function locatorList(items: Locator[]): Locator {
        return {
            count: jest.fn().mockResolvedValue(items.length),
            nth: jest.fn((index: number) => items[index]),
        } as unknown as Locator;
    }

    it("clicks the #inputCommentPopup send button instead of retrying top-level send", async () => {
        const popupSendButton = visibleLocator();
        const requestSendDialog = visibleLocator({
            getByRole: jest.fn().mockReturnValue(locatorList([popupSendButton])),
        });
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: jest.fn(),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn().mockResolvedValue(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const log = jest.fn();
        const logger = { log } as unknown as Console;

        const result = await runEformsignFinalizeGates(page, eformsignFrame, logger);

        expect(result).toBe("request-send-clicked");
        expect((eformsignFrame as unknown as { locator: jest.Mock }).locator).toHaveBeenCalledWith(
            "#inputCommentPopup",
        );
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect((eformsignFrame as unknown as { getByRole: jest.Mock }).getByRole).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith("[finalize-gate] clicked popup 전송");
    });
});
