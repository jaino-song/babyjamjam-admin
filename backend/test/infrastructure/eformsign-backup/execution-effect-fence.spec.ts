import {
    awaitExecutionSignal, beforeExecutionEffect, checkExecutionSignal, executionChunks, ExecutionFencedError, isExecutionFencedError,
    type ExecutionEffectFence,
} from "infrastructure/eformsign-backup/execution-effect-fence";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function bounded<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("cleanup settlement guard")), 250);
        })]);
    } finally { clearTimeout(timer); }
}

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
    it.each(["resolve", "reject"])("settles abort after iterator return starts and consumes its late %s", async outcome => {
        const controller = new AbortController();
        const fence = { signal: controller.signal, assertActive: async () => undefined };
        const cleanupStarted = deferred<void>();
        const cleanup = deferred<IteratorResult<number>>();
        const unhandled = jest.fn();
        process.on("unhandledRejection", unhandled);
        const returned = jest.fn(() => { cleanupStarted.resolve(); return cleanup.promise; });
        const next = jest.fn(async () => ({ done: false as const, value: 1 }));
        const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({ next, return: returned }) }, fence);
        try {
            await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
            const pending = iterator.return(undefined);
            const settlement = expect(bounded(pending)).rejects.toMatchObject({ name: "ExecutionFencedError", reason: "aborted" });
            await bounded(cleanupStarted.promise);
            controller.abort("private reason");
            await settlement;
            if (outcome === "resolve") cleanup.resolve({ done: true, value: undefined });
            else cleanup.reject(new Error("private cleanup"));
            await new Promise<void>(resolve => setImmediate(resolve));
            await iterator.return(undefined);
            expect(returned).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledTimes(1);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            cleanup.resolve({ done: true, value: undefined });
            process.off("unhandledRejection", unhandled);
        }
    });
    it("preserves ordinary unfenced cleanup waiting and errors", async () => {
        const cleanup = deferred<IteratorResult<number>>();
        const cleanupStarted = deferred<void>();
        const error = new Error("ordinary cleanup");
        const returned = jest.fn(() => { cleanupStarted.resolve(); return cleanup.promise; });
        const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({
            next: async () => ({ done: false, value: 1 }), return: returned,
        }) });
        await iterator.next();
        let settled = false;
        const pending = iterator.return(undefined).finally(() => { settled = true; });
        const assertion = expect(pending).rejects.toBe(error);
        await bounded(cleanupStarted.promise);
        await Promise.resolve();
        expect(settled).toBe(false);
        cleanup.reject(error);
        await assertion;
        expect(returned).toHaveBeenCalledTimes(1);
    });
    it("consumes synchronous cleanup throws after an already aborted pull", async () => {
        const controller = new AbortController();
        const returned = jest.fn(() => { throw new Error("private cleanup"); });
        const next = jest.fn(() => { controller.abort(); return Promise.resolve({ done: false, value: 1 }); });
        const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({ next, return: returned }) }, {
            signal: controller.signal, assertActive: async () => undefined,
        });
        await expect(bounded(iterator.next())).rejects.toMatchObject({ reason: "aborted" });
        expect(returned).toHaveBeenCalledTimes(1);
    });

});
