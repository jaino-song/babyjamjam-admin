import type { Locator } from "playwright-core";

import {
    EFORMSIGN_CLICK_TIMEOUT_MS,
    classifyGateLocator,
    findVisibleEnabledLocator,
    findVisibleEnabledLocatorWithSelection,
    getEformsignDialogPresence,
    getEformsignGateSnapshot,
    tryClickGateLocator,
} from "../../infrastructure/automation/eformsign-gate-utils";

describe("eformsign gate utils", () => {
    function candidate(overrides: Partial<Locator> = {}): Locator {
        return {
            isVisible: jest.fn().mockResolvedValue(true),
            isEnabled: jest.fn().mockResolvedValue(true),
            getAttribute: jest.fn().mockResolvedValue(null),
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

    it("skips class-disabled and natively disabled candidates", async () => {
        const classDisabled = candidate({
            getAttribute: jest.fn().mockResolvedValue("btn_header_main disabled"),
        });
        const nativeDisabled = candidate({
            isEnabled: jest.fn().mockResolvedValue(false),
        });
        const active = candidate();

        const result = await findVisibleEnabledLocator(
            locatorList([classDisabled, nativeDisabled, active]),
        );

        expect(result).toBe(active);
    });

    it("returns false when a gate click times out so the caller can retry", async () => {
        const locator = candidate({
            click: jest.fn().mockRejectedValue(new Error("Timeout 2000ms exceeded")),
        });

        const result = await tryClickGateLocator(locator);

        expect(result).toBe(false);
        expect(locator.click).toHaveBeenCalledWith({
            timeout: EFORMSIGN_CLICK_TIMEOUT_MS,
        });
    });

    it("keeps the initial match count and original ordinal while selecting the first enabled duplicate", async () => {
        const hidden = candidate({ isVisible: jest.fn().mockResolvedValue(false) });
        const classDisabled = candidate({
            getAttribute: jest.fn().mockResolvedValue("duplicate disabled"),
        });
        const active = candidate({
            getAttribute: jest.fn().mockResolvedValue("btn_unstructured_process_request"),
        });
        const later = candidate();
        const locator = locatorList([hidden, classDisabled, active, later]);

        const selection = await findVisibleEnabledLocatorWithSelection(locator);

        expect(selection?.locator).toBe(active);
        expect(selection?.candidateCount).toBe(4);
        expect(selection?.selectedIndex).toBe(2);
        expect(active.click).not.toHaveBeenCalled();
        await selection?.locator.click();
        expect(active.click).toHaveBeenCalledTimes(1);
        expect(later.isVisible).not.toHaveBeenCalled();
        expect(locator.nth).toHaveBeenCalledTimes(3);
    });

    it("classifies only fixed observed IDs with a bounded best-effort read", async () => {
        const guide = candidate({
            getAttribute: jest.fn().mockResolvedValue("guideBtn"),
        });
        const header = candidate({
            getAttribute: jest.fn().mockResolvedValue("btn_unstructured_active"),
        });
        const unknown = candidate({
            getAttribute: jest.fn().mockResolvedValue("sensitive-id-sentinel"),
        });
        const broken = candidate({
            getAttribute: jest.fn().mockRejectedValue(new Error("sensitive attribute failure")),
        });

        await expect(classifyGateLocator(guide)).resolves.toBe("guide");
        await expect(classifyGateLocator(header)).resolves.toBe("header");
        await expect(classifyGateLocator(unknown)).resolves.toBe("other");
        await expect(classifyGateLocator(broken)).resolves.toBe("unknown");
        expect(guide.getAttribute).toHaveBeenCalledWith("id", { timeout: expect.any(Number) });
        expect(guide.getAttribute).toHaveBeenCalledTimes(1);
    });

    it("caps visible button counts before a snapshot can reach diagnostics", async () => {
        const body = {
            evaluate: jest.fn().mockResolvedValue({
                visibleButtonCount: 999,
                guideButtonVisible: true,
                headerButtonVisible: true,
                requestSendDialogVisible: true,
                inputCommentDialogVisible: false,
                anyDialogVisible: true,
            }),
        };
        const frame = {
            locator: jest.fn().mockReturnValue(body),
        } as never;

        await expect(getEformsignGateSnapshot(frame)).resolves.toEqual({
            visibleButtonCount: "overflow",
            guideButtonVisible: true,
            headerButtonVisible: true,
            requestSendDialogVisible: true,
            inputCommentDialogVisible: false,
            anyDialogVisible: true,
        });
    });

    it("marks action dialog state unknown when the bounded diagnostic snapshot is unavailable", async () => {
        const body = {
            evaluate: jest.fn().mockRejectedValue(new Error("frame detached")),
        };
        const frame = {
            locator: jest.fn().mockReturnValue(body),
        } as never;

        await expect(getEformsignDialogPresence(frame, "#requestWithInputCommentPopup")).resolves.toEqual({
            requestSendDialogVisible: "unknown",
            inputCommentDialogVisible: "unknown",
            anyDialogVisible: "unknown",
        });
        expect(body.evaluate).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ requestDialogSelector: "#requestWithInputCommentPopup" }),
            { timeout: 250 },
        );
    });
});
