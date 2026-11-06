/** Per-operation authority, supplied by the caller; never shared through client state. */
export interface ExecutionEffectFence {
    readonly signal: AbortSignal;
    assertActive(): Promise<void>;
}

export type ExecutionFenceReason = "lease-lost" | "source-changed" | "aborted" | "uncertain";

export class ExecutionFencedError extends Error {
    constructor(readonly reason: ExecutionFenceReason) {
        super("Execution effect fenced");
        this.name = "ExecutionFencedError";
    }
}

export function isExecutionFencedError(error: unknown): error is ExecutionFencedError {
    return error instanceof ExecutionFencedError;
}

export function checkExecutionSignal(fence?: ExecutionEffectFence): void {
    if (fence?.signal.aborted) throw new ExecutionFencedError("aborted");
}

export async function beforeExecutionEffect(fence?: ExecutionEffectFence): Promise<void> {
    if (!fence) return;
    checkExecutionSignal(fence);
    try {
        await fence.assertActive();
    } catch (error) {
        if (isExecutionFencedError(error)) throw error;
        throw new ExecutionFencedError("uncertain");
    }
    checkExecutionSignal(fence);
}

/** Bounds a pending owned operation even when its implementation ignores cancellation. */
export async function awaitExecutionSignal<T>(
    fence: ExecutionEffectFence | undefined, pending: Promise<T>, cancel?: () => void,
): Promise<T> {
    if (!fence) return pending;
    let abort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
        abort = () => {
            reject(new ExecutionFencedError("aborted"));
            try { cancel?.(); } catch { /* cancellation cannot expose source details */ }
        };
        fence.signal.addEventListener("abort", abort, { once: true });
        if (fence.signal.aborted) abort();
    });
    try {
        const value = await Promise.race([pending, stopped]);
        checkExecutionSignal(fence);
        return value;
    } catch (error) {
        checkExecutionSignal(fence);
        throw error;
    } finally {
        if (abort) fence.signal.removeEventListener("abort", abort);
    }
}

/** Stops pulls and invokes return without waiting for a source stuck inside next(). */
export async function* executionChunks<T>(source: AsyncIterable<T>, fence?: ExecutionEffectFence): AsyncGenerator<T> {
    if (!fence) {
        for await (const chunk of source) yield chunk;
        return;
    }
    checkExecutionSignal(fence);
    const iterator = source[Symbol.asyncIterator]();
    let finished = false;
    let returned = false;
    let fenced = false;
    let pullFailed = false;
    const cancel = (): void => {
        if (returned) return;
        returned = true;
        try { void Promise.resolve(iterator.return?.()).catch(() => undefined); }
        catch { /* a source cannot replace the safe fence error during cancellation */ }
    };
    try {
        while (true) {
            checkExecutionSignal(fence);
            let next: IteratorResult<T>;
            try {
                next = await awaitExecutionSignal(fence, iterator.next(), cancel);
            } catch (error) {
                // Like native for-await, a failed producer pull does not close the iterator.
                // Explicit fence cancellation is still handled below, including sync throws.
                pullFailed = true;
                throw error;
            }
            checkExecutionSignal(fence);
            if (next.done) { finished = true; return; }
            yield next.value;
        }
    } catch (error) {
        fenced = isExecutionFencedError(error);
        throw error;
    } finally {
        if (!finished) {
            if (fenced || fence?.signal.aborted) cancel();
            else if (!pullFailed && !returned) {
                returned = true;
                // Capture synchronous throws as well as asynchronous cleanup failures. The race
                // keeps a rejection handler attached if cleanup ignores an abort after it starts.
                const closing = (async () => iterator.return?.())();
                await awaitExecutionSignal(fence, closing);
            }
        }
    }
}
