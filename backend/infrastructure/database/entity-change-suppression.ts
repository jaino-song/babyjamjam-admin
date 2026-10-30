import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient "do not announce these writes" flag read by `entity-change.extension.ts`. An
 * AsyncLocalStorage (not a module-level boolean) so it covers exactly the async call tree of the
 * wrapped function: concurrent work started outside it, even interleaved with it, still emits.
 */
const suppressionStore = new AsyncLocalStorage<true>();

/** True while running inside `withoutEntityChangeHints`. */
export function isEntityChangeHintsSuppressed(): boolean {
    return suppressionStore.getStore() === true;
}

/**
 * Runs `fn` so that no write it performs - directly, or inside a `$transaction` it opens or
 * joins - produces an entity-change hint. Suppression is decided at write time, so a suppressed
 * write inside a transaction is never buffered either.
 *
 * Only for internal bookkeeping rows that no screen reads (digest claim/watermark rows, lease
 * claims). Wrapping a user-visible write would leave other clients stale until their next refetch.
 * The set of call sites is fixed by the plan unit that wires the opt-out in; do not add new ones
 * ad hoc.
 */
export function withoutEntityChangeHints<T>(fn: () => Promise<T>): Promise<T> {
    // `fn` may return a lazy PrismaPromise (`() => prisma.x.update(...)`), which only runs its query
    // when first awaited. Awaiting it inside the store keeps that query in the suppressed context.
    return suppressionStore.run(true, async () => await fn());
}
