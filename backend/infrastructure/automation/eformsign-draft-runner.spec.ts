import { createContext, runInContext } from "node:vm";
import { buildEformsignDraftHtml } from "./eformsign-draft-runner";
import { EformsignHeadlessService } from "./eformsign-headless.service";
import { runEformsignCreationGates } from "./eformsign-creation-gates";
import { runEformsignFinalizeGates } from "./eformsign-finalize-gates";

const launch = jest.fn();
jest.mock("playwright-core", () => ({ chromium: { launch: (...args: unknown[]) => launch(...args) } }));
jest.mock("./eformsign-creation-gates", () => ({ runEformsignCreationGates: jest.fn() }));
jest.mock("./eformsign-finalize-gates", () => ({ runEformsignFinalizeGates: jest.fn() }));

const option = () => ({
    mode: { type: "01", template_id: "template-1" }, company: { id: "company-1" },
    user: { type: "01", id: "server-user", access_token: "test-credential" },
});
const action = (codes = ["01"]) => ({
    type: "document", fn: "actionCallback", data: codes.map((code) => ({ name: "action", code })),
});
const success = (extra: Record<string, unknown> = {}) => ({
    type: "document", fn: "saveSuccess", code: "-1", document_id: "draft-1", ...extra,
});

// Execute the actual generated inline runtime. No browser, network or provider.
function runtime(html = buildEformsignDraftHtml(option())) {
    type Event = { origin: string; source: unknown; data: unknown; stopImmediatePropagation: () => void };
    const listeners: { callback: (event: Event) => void; capture: boolean }[] = [];
    const scripts: string[] = [];
    const frame = { contentWindow: {} };
    let onSuccess: (value: unknown) => void;
    let onError: (value: unknown) => void;
    let onAction: (value: unknown) => void;
    const sendAction = jest.fn();
    const storage = jest.fn();
    const open = jest.fn();
    const document = {
        getElementById: () => frame,
        createElement: () => ({ src: "", onload: () => undefined }),
        head: { appendChild: (script: { src: string; onload: () => void }) => {
            scripts.push(script.src);
            expect(listeners.some((listener) => listener.capture)).toBe(true);
            script.onload();
        } },
    };
    const window: Record<string, unknown> = {
        addEventListener: (_type: string, callback: (event: Event) => void, capture = false) => {
            listeners.push({ callback, capture });
        },
        EformSignDocument: class {
            document(_option: unknown, _frame: string, saved: typeof onSuccess, error: typeof onError, advertised: typeof onAction) {
                onSuccess = saved; onError = error; onAction = advertised;
                listeners.push({ capture: false, callback: (event) => {
                    const data = JSON.parse(String(event.data));
                    if (data.fn === "actionCallback") onAction(data);
                    if (data.fn === "saveSuccess") onSuccess(data);
                    if (data.fn === "errorMessage") onError(data);
                    if (data.fn === "setStorage") storage(data);
                } });
            }
            open = open;
            sendAction = sendAction;
        },
    };
    const context = createContext({ window, document });
    runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, context);
    return { scripts, sendAction, storage, open, context,
        result: () => window["__eformsignDraftResult"],
        emit: (data: unknown, origin = "https://www.eformsign.com", source = frame.contentWindow) => {
            let stopped = false;
            const event = { data: JSON.stringify(data), origin, source, stopImmediatePropagation: () => { stopped = true; } };
            for (const listener of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
                if (!stopped) listener.callback(event);
            }
        },
    };
}

describe("draft-only generated runtime", () => {
    it("saves advertised new-draft action once and projects only a candidate receipt", () => {
        const r = runtime();
        r.emit(action()); r.emit(action()); r.emit(success({ token: "never-return" }));
        expect(r.sendAction.mock.calls).toEqual([[{ type: "01", code: "01" }]]);
        expect(r.result()).toEqual({ ok: true, draftSaved: true, candidateDocumentId: "draft-1", receipt: { action: "01", code: "-1" } });
        expect(r.scripts).toEqual(["https://www.eformsign.com/plugins/jquery/jquery.min.js", "https://www.eformsign.com/lib/js/efs_embedded_v2.js"]);
    });
    it.each([action(["21"]), action(["19"]), action(["02", "03", "05", "22", "99"]),
        { ...action(), type: "template" },
        { ...action(), data: [{ code: "01" }] }, { ...action(), data: "01" }])("fails closed on unsupported/malformed actions %j", (payload) => {
        const r = runtime(); r.emit(payload);
        expect(r.sendAction).not.toHaveBeenCalled();
        expect(r.result()).toMatchObject({ ok: false, uncertain: true });
    });
    it.each(["https://foreign.example", "https://www.eformsign.com.evil.example", "null"])("blocks foreign origin %s before vendor handlers", (origin) => {
        const r = runtime();
        for (const payload of [action(), success(), { fn: "setStorage" }]) r.emit(payload, origin);
        expect(r.sendAction).not.toHaveBeenCalled(); expect(r.storage).not.toHaveBeenCalled(); expect(r.result()).toBeUndefined();
    });
    it("blocks another iframe even with the exact provider origin", () => {
        const r = runtime();
        for (const payload of [action(), success(), { fn: "setStorage" }]) r.emit(payload, undefined, {});
        expect(r.sendAction).not.toHaveBeenCalled(); expect(r.storage).not.toHaveBeenCalled(); expect(r.result()).toBeUndefined();
    });
    it("rejects a success before save and never saves afterward", () => {
        const r = runtime(); r.emit(success()); r.emit(action());
        expect(r.result()).toMatchObject({ ok: false }); expect(r.sendAction).not.toHaveBeenCalled();
    });
    it.each([{ code: "200" }, { code: undefined }, { document_id: "" }, { document_id: undefined },
        { document_id: "id?injected=1" }, { document_id: 123 }, { type: "template" }, { fn: "other" }])("rejects invalid success %j", (payload) => {
        const r = runtime(); r.emit(action());
        r.emit(success(payload));
        expect(r.result()).not.toEqual(expect.objectContaining({ ok: true }));
    });
    it("latches provider error without retaining its payload", () => {
        const r = runtime(); r.emit({ fn: "errorMessage", secret: "never-return" }); r.emit(action());
        expect(r.result()).toEqual({ ok: false, reason: "provider-error", uncertain: true });
        expect(r.sendAction).not.toHaveBeenCalled();
    });
    it.each([
        { ...option(), mode: { type: "02", template_id: "template-1" } },
        { ...option(), mode: { ...option().mode, document_id: "existing" } },
        { ...option(), sdkUrl: "https://foreign.example/sdk.js" },
        { ...option(), viewer_event: { script: "arbitrary()" } },
        { ...option(), company: { id: "id&query=bad" } },
        { ...option(), mode: { type: "01", template_id: "bad\"</script>" } },
        { ...option(), user: { type: "02" } },
    ])("rejects unsafe options", (value) => { expect(() => buildEformsignDraftHtml(value)).toThrow(); });
    it("escapes HTML delimiters in legitimate field values", () => {
        const html = buildEformsignDraftHtml({ ...option(), prefill: { fields: [{ id: "name", value: "</script><script>bad()</script>" }] } });
        expect(html.match(/<script>/g)).toHaveLength(1);
        expect(() => runtime(html)).not.toThrow();
    });
    it("rejects serialization hooks that could replace the validated mode", () => {
        const value = Object.assign(Object.create({ toJSON: () => ({ mode: { type: "02" } }) }), option()) as Record<string, unknown>;
        expect(() => buildEformsignDraftHtml(value)).toThrow();
    });
    it("preserves ordinary nested array data and verified mode in the generated snapshot", () => {
        const value = { prefill: { fields: [{ id: "name", value: "<" }] }, ...option() };
        const snapshot = JSON.parse(buildEformsignDraftHtml(value).match(/var option = (.*);/)![1]!) as typeof value;
        expect(snapshot).toEqual(value); expect(snapshot.mode.type).toBe("01");
    });
    it.each(["root", "nested"] as const)("rejects %s array inherited toJSON before executing it", (placement) => {
        const fields: unknown[] = [];
        const value = placement === "root"
            ? Object.assign([], option()) : { prefill: { fields }, ...option() };
        const hook = jest.fn(() => { value.mode.type = "02"; return { ...option(), mode: { type: "02" } }; });
        Object.setPrototypeOf(placement === "root" ? value : fields, Object.create(Array.prototype, { toJSON: { value: hook } }));
        expect(() => buildEformsignDraftHtml(value as unknown as Record<string, unknown>)).toThrow();
        expect(hook).not.toHaveBeenCalled(); expect(value.mode.type).toBe("01");
    });
    it("rejects an ordinary array root with otherwise valid own option properties", () => {
        expect(() => buildEformsignDraftHtml(Object.assign([], option()) as unknown as Record<string, unknown>)).toThrow();
    });
    it("rejects a nonstandard nested array prototype without serialization hooks", () => {
        const fields: unknown[] = []; Object.setPrototypeOf(fields, Object.create(Array.prototype));
        expect(() => buildEformsignDraftHtml({ prefill: { fields }, ...option() })).toThrow();
    });
    it.each([Array.prototype, Object.prototype])("rejects inherited serialization accessors without invoking them", (prototype) => {
        const hook = jest.fn();
        const original = Object.getOwnPropertyDescriptor(prototype, "toJSON");
        let rejected = false;
        Object.defineProperty(prototype, "toJSON", { configurable: true, get: hook });
        try { buildEformsignDraftHtml({ prefill: { fields: [] }, ...option() }); } catch { rejected = true; }
        finally {
            if (original) Object.defineProperty(prototype, "toJSON", original);
            else Reflect.deleteProperty(prototype, "toJSON");
        }
        expect(rejected).toBe(true); expect(hook).not.toHaveBeenCalled();
    });
});

describe("dormant draft dispatch lifecycle", () => {
    function setup(stub = false) {
        const beforeOpen = jest.fn().mockResolvedValue(true);
        let r: ReturnType<typeof runtime>;
        let html = "";
        const page = {
            route: jest.fn(async (_url: string, handler: (route: unknown) => Promise<void>) => {
                await handler({ fulfill: async (response: { body: string }) => { html = response.body; } });
            }),
            goto: jest.fn(async () => { r = runtime(html); r.emit(action()); r.emit(success()); }),
            waitForFunction: jest.fn(async (_predicate: unknown, _arg: unknown, options: { timeout: number }) => {
                expect(options.timeout).toBe(30_000);
            }),
            evaluate: jest.fn(async () => r.result()), close: jest.fn().mockResolvedValue(undefined),
        };
        const context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
        launch.mockResolvedValue({ newContext: async () => context, isConnected: () => true });
        const service = new EformsignHeadlessService({ get: () => stub ? "1" : undefined } as never);
        return { service, page, context, beforeOpen, params: { documentOption: option(), beforeOpen } };
    }
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => {
        expect(runEformsignCreationGates).not.toHaveBeenCalled(); expect(runEformsignFinalizeGates).not.toHaveBeenCalled();
    });
    it("runs generated HTML through the existing local route and closes resources", async () => {
        const s = setup(); expect(await s.service.dispatchDraft(s.params)).toMatchObject({ ok: true, draftSaved: true });
        expect(s.beforeOpen).toHaveBeenCalledTimes(1); expect(s.page.goto).toHaveBeenCalledTimes(1);
        expect(s.page.close).toHaveBeenCalledTimes(1); expect(s.context.close).toHaveBeenCalledTimes(1);
    });
    it.each([false, "throw"])("does not initialize a provider when authority returns %s", async (authority) => {
        const s = setup();
        if (authority === false) s.beforeOpen.mockResolvedValue(false); else s.beforeOpen.mockRejectedValue(new Error("private"));
        expect(await s.service.dispatchDraft(s.params)).toMatchObject({ ok: false, uncertain: false });
        expect(s.beforeOpen).toHaveBeenCalledTimes(1); expect(launch).not.toHaveBeenCalled(); expect(s.page.goto).not.toHaveBeenCalled();
    });
    it("rejects invalid options before authority or browser initialization", async () => {
        const s = setup(); s.params.documentOption.mode.type = "02";
        expect(await s.service.dispatchDraft(s.params)).toMatchObject({ ok: false, uncertain: false });
        expect(s.beforeOpen).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
    });
    it("returns unsupported under existing vendor stubs without fabricating a draft", async () => {
        const s = setup(true);
        expect(await s.service.dispatchDraft(s.params)).toMatchObject({ ok: false, reason: "unsupported-stub", uncertain: false });
        expect(launch).not.toHaveBeenCalled(); expect(s.beforeOpen).not.toHaveBeenCalled();
    });
    it.each(["goto", "waitForFunction", "evaluate"] as const)("sanitizes %s failure, closes resources and never retries", async (stage) => {
        const s = setup(); s.page[stage].mockRejectedValue(new Error("private-token-response"));
        const result = await s.service.dispatchDraft(s.params);
        expect(result).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(result)).not.toContain("private-token");
        expect(s.beforeOpen).toHaveBeenCalledTimes(1); expect(s.page.goto).toHaveBeenCalledTimes(1);
        expect(s.page.close).toHaveBeenCalledTimes(1); expect(s.context.close).toHaveBeenCalledTimes(1);
    });
    it("closes a context even if newPage fails", async () => {
        const s = setup(); s.context.newPage.mockRejectedValue(new Error("private"));
        expect(await s.service.dispatchDraft(s.params)).toMatchObject({ ok: false, uncertain: true });
        expect(s.context.close).toHaveBeenCalledTimes(1); expect(s.page.goto).not.toHaveBeenCalled();
    });
});
