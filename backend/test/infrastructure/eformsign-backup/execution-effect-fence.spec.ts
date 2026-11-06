import {
    awaitExecutionSignal, beforeExecutionEffect, checkExecutionSignal, executionChunks, ExecutionFencedError, isExecutionFencedError,
    type ExecutionEffectFence,
} from "infrastructure/eformsign-backup/execution-effect-fence";

describe("execution effect fence", () => {
    it("keeps omitted fences inert", async () => {
        checkExecutionSignal();
        await beforeExecutionEffect();
        expect(await awaitExecutionSignal(undefined, Promise.resolve(7))).toBe(7);
    });
    it("does not call a pre-aborted guard or expose the arbitrary abort reason", async () => {
        const controller = new AbortController();
        controller.abort(new Error("secret token /document/url"));
        const assertActive = jest.fn();
        const fence = { signal: controller.signal, assertActive };
        await expect(beforeExecutionEffect(fence)).rejects.toMatchObject({ message: "Execution effect fenced", reason: "aborted" });
        expect(assertActive).not.toHaveBeenCalled();
        expect(() => checkExecutionSignal(fence)).toThrow(ExecutionFencedError);
    });
    it("sanitizes an untyped guard rejection and preserves typed rejections", async () => {
        const signal = new AbortController().signal;
        const fence: ExecutionEffectFence = { signal, assertActive: async () => { throw new Error("private lease token"); } };
        const error: unknown = await beforeExecutionEffect(fence).catch(e => e);
        expect(isExecutionFencedError(error)).toBe(true);
        expect(error).toMatchObject({ reason: "uncertain", message: "Execution effect fenced" });
        expect(error).not.toHaveProperty("cause");
        expect(JSON.stringify(error)).not.toContain("private");
        const typed = new ExecutionFencedError("source-changed");
        await expect(beforeExecutionEffect({ signal, assertActive: async () => { throw typed; } })).rejects.toBe(typed);
        expect(isExecutionFencedError(new Error("Execution effect fenced"))).toBe(false);
    });
    it("checks the signal after the asynchronous guard", async () => {
        const controller = new AbortController();
        await expect(beforeExecutionEffect({ signal: controller.signal, assertActive: async () => { controller.abort("secret"); } }))
            .rejects.toMatchObject({ reason: "aborted" });
    });
    it("settles a pending source and returns its owned iterator on abort", async () => {
        const controller = new AbortController();
        const next = jest.fn(() => new Promise<IteratorResult<number>>(() => undefined));
        const returned = jest.fn(async () => ({ done: true as const, value: undefined }));
        const fence = { signal: controller.signal, assertActive: async () => undefined };
        const add = jest.spyOn(controller.signal, "addEventListener");
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({ next, return: returned }) }, fence);
        const pending = iterator.next();
        controller.abort("secret");
        await expect(pending).rejects.toMatchObject({ reason: "aborted" });
        expect(next).toHaveBeenCalledTimes(1);
        expect(returned).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    });
    it("removes a pending-operation listener on ordinary completion and failure", async () => {
        const signal = new AbortController().signal;
        const add = jest.spyOn(signal, "addEventListener");
        const remove = jest.spyOn(signal, "removeEventListener");
        const fence = { signal, assertActive: async () => undefined };
        await expect(awaitExecutionSignal(fence, Promise.resolve(1))).resolves.toBe(1);
        await expect(awaitExecutionSignal(fence, Promise.reject(new Error("source")))).rejects.toThrow("source");
        expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    });
    it("preserves a typed source fence when iterator cleanup rejects with private details", async () => {
        const typed = new ExecutionFencedError("lease-lost");
        const returned = jest.fn(async () => { throw new Error("private source detail"); });
        const fence = { signal: new AbortController().signal, assertActive: async () => undefined };
        const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<number>> => { throw typed; }, return: returned,
        }) }, fence);
        await expect(iterator.next()).rejects.toBe(typed);
        expect(returned).toHaveBeenCalledTimes(1);
    });
});
