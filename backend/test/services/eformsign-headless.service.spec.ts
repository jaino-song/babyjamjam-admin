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

    /**
     * Pulls the SDK success callback out of the generated page and returns it
     * bound to a stand-in `window`, so the assertions below exercise the source
     * that actually ships to the browser rather than a restatement of it.
     */
    function extractFunctionSource(html: string, name: string): string {
        const start = html.indexOf(`function ${name}(`);
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = start;
        for (let index = html.indexOf("{", start); index < html.length; index += 1) {
            if (html[index] === "{") depth += 1;
            if (html[index] === "}") {
                depth -= 1;
                if (depth === 0) {
                    end = index + 1;
                    break;
                }
            }
        }
        return html.slice(start, end);
    }

    function extractNamedFunction<T extends (...args: never[]) => unknown>(
        html: string,
        name: string,
        win: Record<string, unknown>,
        dependencies: string[] = [],
    ) {
        const source = [...dependencies, name].map((dependency) => extractFunctionSource(html, dependency)).join("\n");
        return new Function(
            "window",
            `var diagnostics = window.__eformsignDiagnostics; ${source}; return ${name};`,
        )(win) as T;
    }

    function extractSuccessCallback(html: string, win: Record<string, unknown>) {
        return extractNamedFunction<(resp: unknown) => void>(html, "recordSuccess", win);
    }

    it("latches the SDK success callback only for the completion code", () => {
        const html = (
            service as unknown as {
                buildEmbeddedSdkHtml: (option: Record<string, unknown>, iframeId: string) => string;
            }
        ).buildEmbeddedSdkHtml({ mode: { type: "02" } }, "eformsign_finalize_iframe");

        const win: Record<string, unknown> = {
            __eformsignDiagnostics: {
                actionPresent: false,
                actionType: "unknown",
                actionCode: "unknown",
                successCountBucket: "0",
                successCode: "unknown",
                errorPresent: false,
                bootErrorPresent: false,
            },
        };
        const onSuccess = extractSuccessCallback(html, win);

        // eformsign fires this callback for non-terminal events too — the
        // top-level 전송 that only opens the confirm popup is one. Latching on
        // it reported a finalize as complete that eformsign never performed.
        onSuccess({ code: "200", type: "document", message: "success-sensitive-sentinel" });
        expect(win["__eformsignSuccess"]).toBeUndefined();

        onSuccess({ code: "-1", document_id: "doc-1", token: "token-sensitive-sentinel" });
        expect(win["__eformsignSuccess"]).toEqual({
            code: "-1",
            document_id: "doc-1",
            token: "token-sensitive-sentinel",
        });

        expect(win["__eformsignSuccessLog"]).toBeUndefined();
        expect(JSON.stringify(win["__eformsignDiagnostics"])).not.toContain("sensitive-sentinel");
        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({
            successCountBucket: "2+",
            successCode: "terminal_success",
        }));
    });

    it("projects action callback enums without copying callback names or payloads", () => {
        const html = (
            service as unknown as {
                buildEmbeddedSdkHtml: (option: Record<string, unknown>, iframeId: string) => string;
            }
        ).buildEmbeddedSdkHtml({ mode: { type: "02" } }, "eformsign_finalize_iframe");
        const win: Record<string, unknown> = {
            __eformsignDiagnostics: {
                actionPresent: false,
                actionType: "unknown",
                actionCode: "unknown",
                successCountBucket: "0",
                successCode: "unknown",
                errorPresent: false,
                bootErrorPresent: false,
            },
        };
        const classifyAction = extractNamedFunction<(response: unknown) => void>(
            html,
            "classifyAction",
            win,
            ["classifyActionType", "classifyActionCode"],
        );

        classifyAction({
            type: "document",
            fn: "actionCallback",
            data: [
                { name: "전송", code: "21" },
                { name: "func_get_return_fields", code: "99" },
            ],
            document_id: "document-sensitive-sentinel",
        });

        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({
            actionPresent: true,
            actionType: "document",
            actionCode: "21",
        }));
        expect(JSON.stringify(win["__eformsignDiagnostics"])).not.toContain("전송");
        expect(JSON.stringify(win["__eformsignDiagnostics"])).not.toContain("document-sensitive-sentinel");

        classifyAction({
            type: "document",
            fn: "actionCallback",
            data: [
                { name: "func_get_return_fields", code: "99" },
                { name: "process", code: "22" },
            ],
        });
        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({
            actionType: "document",
            actionCode: "22",
        }));

        classifyAction({ type: "future", fn: "actionCallback", data: [{ name: "unknown", code: "999" }] });
        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({
            actionType: "other",
            actionCode: "other",
        }));
    });

    it("does not latch an undefined SDK error callback payload", () => {
        const html = (
            service as unknown as {
                buildEmbeddedSdkHtml: (option: Record<string, unknown>, iframeId: string) => string;
            }
        ).buildEmbeddedSdkHtml({ mode: { type: "02" } }, "eformsign_finalize_iframe");
        const win: Record<string, unknown> = {
            __eformsignDiagnostics: {
                actionPresent: false,
                actionType: "unknown",
                actionCode: "unknown",
                successCountBucket: "0",
                successCode: "unknown",
                errorPresent: false,
                bootErrorPresent: false,
            },
        };
        const start = html.indexOf("function (resp) {\n                // Preserve the SDK bridge's current latch semantics:");
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = start;
        for (let index = html.indexOf("{", start); index < html.length; index += 1) {
            if (html[index] === "{") depth += 1;
            if (html[index] === "}") {
                depth -= 1;
                if (depth === 0) {
                    end = index + 1;
                    break;
                }
            }
        }
        const onError = new Function(
            "window",
            `var diagnostics = window.__eformsignDiagnostics; return (${html.slice(start, end)});`,
        )(win) as (response?: unknown) => void;

        onError(undefined);
        expect(win["__eformsignError"]).toBeUndefined();
        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({ errorPresent: false }));

        onError({ message: "error-sensitive-sentinel" });
        expect(win["__eformsignError"]).toBe(true);
        expect(JSON.stringify(win["__eformsignDiagnostics"])).not.toContain("error-sensitive-sentinel");

        onError(undefined);
        expect(win["__eformsignError"]).toBeUndefined();
        expect(win["__eformsignDiagnostics"]).toEqual(expect.objectContaining({ errorPresent: true }));
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
        pageMock.evaluate = jest.fn().mockImplementation((fn: unknown) => {
            const source = String(fn);
            if (source.includes("__eformsignDiagnostics")) {
                return Promise.resolve({
                    actionPresent: true,
                    actionType: "document",
                    actionCode: "21",
                    successCountBucket: "1",
                    successCode: "other",
                    errorPresent: false,
                    bootErrorPresent: false,
                });
            }
            return Promise.resolve(undefined);
        });

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("headless creation dispatch failed (sdk_error)");
            expect(result.reason).toContain('"actionCode":"21"');
            expect(result.reason).not.toContain("Timeout 30000ms exceeded");
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
            if (source.includes("__eformsignDiagnostics")) {
                return Promise.resolve({
                    actionPresent: true,
                    actionType: "template",
                    actionCode: "22",
                    successCountBucket: "0",
                    successCode: "unknown",
                    errorPresent: true,
                    bootErrorPresent: false,
                });
            }
            return Promise.resolve(undefined);
        });

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("headless creation dispatch failed (sdk_error)");
            expect(result.reason).toContain('"errorPresent":true');
            expect(result.reason).not.toContain("request rejected");
        }
    });

    it("dispatchCreation falls back to ok=false when the gate runner throws", async () => {
        pageMock.evaluate = jest.fn().mockImplementation((fn: unknown) => {
            const source = String(fn);
            if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                return Promise.resolve({ hasSuccess: false, hasError: false });
            }
            if (source.includes("__eformsignSuccess")) return Promise.resolve(false);
            return Promise.resolve(undefined);
        });
        (runEformsignCreationGates as jest.Mock).mockRejectedValueOnce(new Error("selector miss"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("headless creation dispatch failed (error)");
            expect(result.reason).not.toContain("selector miss");
        }
    });

    it("recovers a creation when a no-popup template returns a terminal document id", async () => {
        (runEformsignCreationGates as jest.Mock).mockRejectedValueOnce(
            new Error("confirmation popup timed out twice"),
        );
        const onProgress = jest.fn();

        await expect(service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
            onProgress,
        })).resolves.toEqual(expect.objectContaining({
            ok: true,
            documentId: "doc-from-callback",
            gateOutcome: "success-latched",
        }));
        expect(onProgress).toHaveBeenCalledWith("sent");
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
