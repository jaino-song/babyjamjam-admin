/**
 * Headless service spec. Playwright is heavyweight, so we mock chromium.launch
 * and verify:
 *   - creation dispatch reaches the gate runner with the iframe found
 *   - SDK success callback (`__eformsignSuccess.document_id`) is propagated
 *   - failures (gate runner throws, success callback timeout) are wrapped
 *     into ok=false envelopes
 */

const launchMock = jest.fn();

jest.mock("playwright-core", () => ({
    chromium: { launch: (...args: unknown[]) => launchMock(...args) },
}));

jest.mock("../../infrastructure/automation/eformsign-creation-gates", () => ({
    runEformsignCreationGates: jest.fn().mockResolvedValue("success-latched"),
}));

jest.mock("../../infrastructure/automation/eformsign-finalize-gates", () => ({
    runEformsignFinalizeGates: jest.fn().mockResolvedValue("success-latched"),
}));

import { EformsignHeadlessService } from "../../infrastructure/automation/eformsign-headless.service";
import { runEformsignCreationGates } from "../../infrastructure/automation/eformsign-creation-gates";
import { runEformsignFinalizeGates } from "../../infrastructure/automation/eformsign-finalize-gates";

describe("EformsignHeadlessService", () => {
    let service: EformsignHeadlessService;
    const configGetMock = jest.fn();
    let pageMock: ReturnType<typeof buildPageMock>;
    let contextMock: ReturnType<typeof buildContextMock>;
    let browserMock: ReturnType<typeof buildBrowserMock>;

    function buildPageMock() {
        return {
            setContent: jest.fn().mockResolvedValue(undefined),
            route: jest.fn().mockResolvedValue(undefined),
            goto: jest.fn().mockResolvedValue(undefined),
            waitForFunction: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn().mockImplementation((fn: unknown) => {
                const source = String(fn);
                if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                    return Promise.resolve({
                        hasSuccess: true,
                        hasError: false,
                        success: { document_id: "doc-from-callback" },
                    });
                }
                if (source.includes("__eformsignSuccess")) {
                    return Promise.resolve(true);
                }
                return Promise.resolve(undefined);
            }),
            frameLocator: jest.fn().mockReturnValue({}),
        };
    }

    function buildContextMock() {
        return {
            newPage: jest.fn().mockImplementation(() => Promise.resolve(pageMock)),
            close: jest.fn().mockResolvedValue(undefined),
        };
    }

    function buildBrowserMock() {
        return {
            isConnected: jest.fn().mockReturnValue(true),
            newContext: jest.fn().mockImplementation(() => Promise.resolve(contextMock)),
            close: jest.fn().mockResolvedValue(undefined),
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        configGetMock.mockReturnValue(undefined);
        delete process.env["EFORMSIGN_BROWSER_HEADLESS"];
        pageMock = buildPageMock();
        contextMock = buildContextMock();
        browserMock = buildBrowserMock();
        launchMock.mockResolvedValue(browserMock);
        service = new EformsignHeadlessService({ get: configGetMock } as never);
    });

    it("dispatchCreation short-circuits vendor stubs without launching Chromium", async () => {
        configGetMock.mockImplementation((key: string) => key === "E2E_VENDOR_STUBS" ? "1" : undefined);
        const onProgress = jest.fn();

        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
            onProgress,
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            documentId: expect.stringMatching(/^doc-stub-headless-/),
        }));
        expect(onProgress.mock.calls.map(([step]) => step)).toEqual([
            "client-started",
            "info-inserted",
            "creating",
            "sent",
        ]);
        expect(launchMock).not.toHaveBeenCalled();
    });

    it("dispatchCreation runs the creation gates and returns the SDK document_id", async () => {
        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignCreationGates).toHaveBeenCalledTimes(1);
        // Authentication piggybacks on documentOption.user.access_token, so
        // exactly one context per dispatch.
        expect(browserMock.newContext).toHaveBeenCalledTimes(1);
    });

    it("launches Chromium headed when EFORMSIGN_BROWSER_HEADLESS=false", async () => {
        process.env["EFORMSIGN_BROWSER_HEADLESS"] = "false";

        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
        });

        expect(result.ok).toBe(true);
        expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
            headless: false,
        }));
    });

    it("dispatchCreation returns ok=false when the SDK success callback never fires", async () => {
        // First waitForFunction (iframe src) resolves; second (terminal SDK callback)
        // rejects to simulate eformsign never confirming dispatch.
        (pageMock.waitForFunction as jest.Mock)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Timeout 30000ms exceeded"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("Timeout");
        }
    });

    it("dispatchCreation returns ok=false when the SDK error callback fires", async () => {
        pageMock.evaluate = jest.fn().mockImplementation((fn: unknown) => {
            const source = String(fn);
            if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                return Promise.resolve({
                    hasSuccess: false,
                    hasError: true,
                    error: { code: "EFORM_TEST", message: "request rejected" },
                });
            }
            if (source.includes("__eformsignSuccess")) {
                return Promise.resolve(false);
            }
            return Promise.resolve(undefined);
        });

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("eformsign SDK error");
            expect(result.reason).toContain("request rejected");
        }
    });

    it("dispatchCreation falls back to ok=false when the gate runner throws", async () => {
        (runEformsignCreationGates as jest.Mock).mockRejectedValueOnce(new Error("selector miss"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("selector miss");
        }
    });

    it("dispatchFinalize calls the finalize gate runner", async () => {
        const result = await service.dispatchFinalize({
            documentOption: { mode: { type: "02", document_id: "doc-9" } },
            documentId: "doc-9",
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            // SDK callback is preferred; falls back to the param when the callback omits the id.
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignFinalizeGates).toHaveBeenCalledTimes(1);
    });

    it("dispatchFinalize forwards onProgress and emits client-started + sent", async () => {
        const onProgress = jest.fn();
        (runEformsignFinalizeGates as jest.Mock).mockImplementationOnce(
            async (
                _page: unknown,
                _frame: unknown,
                _logger: unknown,
                cb?: (step: string) => void,
            ) => {
                cb?.("info-inserted");
                cb?.("creating");
                return "success-latched";
            },
        );

        const result = await service.dispatchFinalize({
            documentOption: { mode: { type: "02", document_id: "doc-9" } },
            documentId: "doc-9",
            onProgress,
        });

        expect(result.ok).toBe(true);
        // Driver emits client-started after iframe boot, then forwards
        // info-inserted/creating from the gate runner, then sent on success.
        expect(onProgress).toHaveBeenCalledWith("client-started");
        expect(onProgress).toHaveBeenCalledWith("info-inserted");
        expect(onProgress).toHaveBeenCalledWith("creating");
        expect(onProgress).toHaveBeenCalledWith("sent");
        const gateCallArgs = (runEformsignFinalizeGates as jest.Mock).mock.calls[0];
        expect(typeof gateCallArgs[3]).toBe("function");
    });
});
