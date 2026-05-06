/**
 * Headless service spec. Playwright is heavyweight, so we mock chromium.launch
 * and verify:
 *   - cookie cache TTL behaviour
 *   - creation dispatch reaches the gate runner with the iframe found
 *   - failures are wrapped into ok=false envelopes
 */
import { ConfigService } from "@nestjs/config";

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
    let pageMock: ReturnType<typeof buildPageMock>;
    let contextMock: ReturnType<typeof buildContextMock>;
    let browserMock: ReturnType<typeof buildBrowserMock>;
    const config = new ConfigService({
        EFORMSIGN_USER_EMAIL: "ops@example.com",
        EFORMSIGN_SERVICE_ACCOUNT_PASSWORD: "secret",
        EFORMSIGN_COMPANY_ID: "cmp-1",
    });

    function buildPageMock() {
        return {
            setContent: jest.fn().mockResolvedValue(undefined),
            waitForFunction: jest.fn().mockResolvedValue(undefined),
            waitForURL: jest.fn().mockResolvedValue(undefined),
            goto: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn().mockResolvedValue("doc-from-callback"),
            frameLocator: jest.fn().mockReturnValue({}),
            locator: jest.fn().mockReturnValue({
                first: () => ({
                    waitFor: jest.fn().mockResolvedValue(undefined),
                    fill: jest.fn().mockResolvedValue(undefined),
                }),
                fill: jest.fn().mockResolvedValue(undefined),
            }),
            getByRole: jest.fn().mockReturnValue({
                first: () => ({ click: jest.fn().mockResolvedValue(undefined) }),
            }),
        };
    }

    function buildContextMock() {
        return {
            newPage: jest.fn().mockImplementation(() => Promise.resolve(pageMock)),
            cookies: jest.fn().mockResolvedValue([
                { name: "sessionId", value: "abc", domain: ".eformsign.com", path: "/" },
            ]),
            addCookies: jest.fn().mockResolvedValue(undefined),
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
        pageMock = buildPageMock();
        contextMock = buildContextMock();
        browserMock = buildBrowserMock();
        launchMock.mockResolvedValue(browserMock);
        service = new EformsignHeadlessService(config);
    });

    it("dispatchCreation runs the creation gates and returns ok=true with the SDK document_id", async () => {
        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignCreationGates).toHaveBeenCalledTimes(1);
        // Login (1 context) + dispatch (1 context) = 2 contexts created.
        expect(browserMock.newContext).toHaveBeenCalledTimes(2);
    });

    it("dispatchCreation returns ok=false when the SDK success callback never fires", async () => {
        // First waitForFunction call resolves (iframe src); second (success
        // latch) rejects to simulate eformsign never confirming dispatch.
        (pageMock.waitForFunction as jest.Mock)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Timeout 90000ms exceeded"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("Timeout");
        }
    });

    it("dispatchCreation reuses the cached cookies on the next call", async () => {
        await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });
        const firstNewContextCount = browserMock.newContext.mock.calls.length;

        await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        // Second call reuses cached cookies, so only the dispatch context is new.
        expect(browserMock.newContext.mock.calls.length).toBe(firstNewContextCount + 1);
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
            // SDK callback is preferred; falls back to the param when callback omits the id.
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignFinalizeGates).toHaveBeenCalledTimes(1);
    });

    it("returns ok=false when the service account is not configured", async () => {
        const unconfigured = new EformsignHeadlessService(
            new ConfigService({ EFORMSIGN_USER_EMAIL: "" }),
        );

        const result = await unconfigured.dispatchCreation({ documentOption: {} });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("not configured");
        }
    });
});
