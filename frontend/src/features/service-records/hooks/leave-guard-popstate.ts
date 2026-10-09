/**
 * The leave guard's `popstate` entry point, registered as early as the page lets us.
 *
 * Why this exists: Next's app router adds its own `popstate` listener to `window` when
 * the app mounts and renders the route the traversal landed on from inside that very
 * event. Event listeners on `window` run in registration order (Chromium does not run
 * a capture listener ahead of a non-capture one when `window` is the target), so a
 * listener the guard adds when the editor arms is always behind the router, and
 * `stopImmediatePropagation()` from it comes too late: a multi-entry Back out of the
 * editor has already unmounted it, and the staged edits with it.
 *
 * So there is exactly one `popstate` listener, added when this module is first
 * evaluated. `LeaveGuardPopStateBootstrap` (a client component in the root layout)
 * imports it, which puts that evaluation in the initial client bundle, ahead of the
 * router's mount effect. Controllers only add/remove handlers from this module's list.
 * Handlers run in the order they were added; once one calls `stopImmediatePropagation()`
 * the rest of them, and every listener behind this one (the router), are skipped.
 *
 * The listener lives on `window` (keyed by a global symbol) so a hot-reloaded copy of
 * this module reuses it instead of stacking a second one.
 */

export type PopStateHandler = (event: PopStateEvent) => void;

interface Dispatcher {
    handlers: PopStateHandler[];
}

const DISPATCHER_KEY = Symbol.for("babyjamjam.serviceRecordLeaveGuard.popstate");

function ensureDispatcher(): Dispatcher | null {
    if (typeof window === "undefined") return null;
    const host = window as unknown as Record<symbol, Dispatcher | undefined>;
    let dispatcher = host[DISPATCHER_KEY];
    if (dispatcher) return dispatcher;

    const created: Dispatcher = { handlers: [] };
    dispatcher = created;
    host[DISPATCHER_KEY] = created;
    window.addEventListener("popstate", (event) => {
        if (created.handlers.length === 0) return;
        let stopped = false;
        const stopImmediatePropagation = event.stopImmediatePropagation.bind(event);
        event.stopImmediatePropagation = () => {
            stopped = true;
            stopImmediatePropagation();
        };
        try {
            for (const handler of [...created.handlers]) {
                handler(event);
                if (stopped) break;
            }
        } finally {
            // Own property shadowing the prototype method: drop it for later listeners.
            delete (event as { stopImmediatePropagation?: unknown }).stopImmediatePropagation;
        }
    });
    return created;
}

/** Make sure the early listener exists. Safe to call any number of times. */
export function ensureLeaveGuardPopState(): void {
    ensureDispatcher();
}

/** Run `handler` on every `popstate` ahead of the router; returns the removal function. */
export function addLeaveGuardPopStateHandler(handler: PopStateHandler): () => void {
    const dispatcher = ensureDispatcher();
    if (!dispatcher) return () => undefined;
    dispatcher.handlers.push(handler);
    return () => {
        const index = dispatcher.handlers.indexOf(handler);
        if (index !== -1) dispatcher.handlers.splice(index, 1);
    };
}

ensureDispatcher();
