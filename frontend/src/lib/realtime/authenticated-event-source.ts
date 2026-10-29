import { refreshAppAuthSession } from "@/lib/api/client";

const AUTH_PROBE_URL = "/api/auth/me";

// The probe (and, when it comes back 401, the session refresh) normally takes
// milliseconds. A reconnect watchdog only starts once a source exists, so an
// attempt that never settles would stall its stream forever; give up after
// this long and let the caller retry on its backoff.
const BOOTSTRAP_TIMEOUT_MS = 20_000;

export const RECONNECT_BASE_DELAY_MS = 3000;
export const RECONNECT_MAX_DELAY_MS = 60_000;

/** The session is gone for good: the refresh itself was rejected with 401. */
export class AuthSessionEndedError extends Error {
    constructor(message = "Application session ended") {
        super(message);
        this.name = "AuthSessionEndedError";
    }
}

/** Network drop, 5xx or timeout while re-establishing the session: worth retrying. */
export class TransientStreamError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TransientStreamError";
    }
}

/**
 * Backoff for consecutive failed reconnects: 3 s, 6 s, 12 s … capped at 60 s.
 * Only an actual EventSource `open` proves the upstream is healthy again, so
 * only {@link ReconnectBackoff.reset} (called from the `open` handler) returns
 * it to the base delay. Immediate reconnects (watchdog, tab visible) don't call
 * {@link ReconnectBackoff.nextDelay} and so never grow it.
 */
export interface ReconnectBackoff {
    nextDelay(): number;
    reset(): void;
}

export function createReconnectBackoff(): ReconnectBackoff {
    let failures = 0;
    return {
        nextDelay() {
            const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** failures, RECONNECT_MAX_DELAY_MS);
            failures += 1;
            return delay;
        },
        reset() {
            failures = 0;
        },
    };
}

function abortError(): DOMException {
    return new DOMException("The operation was aborted", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

async function probeSession(signal: AbortSignal): Promise<number> {
    try {
        const response = await fetch(AUTH_PROBE_URL, {
            cache: "no-store",
            credentials: "same-origin",
            signal,
        });
        return response.status;
    } catch (error) {
        if (signal.aborted) throw error;
        throw new TransientStreamError("Auth probe failed");
    }
}

function isUnauthorizedRefresh(error: unknown): boolean {
    return (error as { response?: { status?: unknown } } | null)?.response?.status === 401;
}

/**
 * `/api/auth/me` is the freshness check: a 2xx means the cookies a new
 * EventSource will send are good, so no refresh is spent. Only a 401 triggers
 * the app-wide single-flight `refreshAppAuthSession` — the sole sanctioned
 * refresh entry, because refresh tokens are single-use and a second concurrent
 * refresh can revoke the session.
 */
async function ensureSession(signal: AbortSignal): Promise<void> {
    let status = await probeSession(signal);

    if (status === 401) {
        try {
            await abortable(refreshAppAuthSession(), signal);
        } catch (error) {
            if (signal.aborted) throw error;
            if (isUnauthorizedRefresh(error)) throw new AuthSessionEndedError();
            throw new TransientStreamError("Session refresh failed");
        }
        status = await probeSession(signal);
        if (status === 401) throw new AuthSessionEndedError();
    }

    if (status < 200 || status >= 300) {
        throw new TransientStreamError(`Auth probe returned ${status}`);
    }
}

/**
 * Opens an EventSource only after proving the session is valid. A bare
 * EventSource cannot read a 401 (it just errors), so an expired 15-minute
 * access token would otherwise leave a stream reconnecting against a rejecting
 * upstream forever. Throws {@link AuthSessionEndedError} when the session is
 * gone, {@link TransientStreamError} for retryable trouble (including a
 * 20 s timeout), or an AbortError when the caller's `signal` aborts.
 */
export async function openAuthenticatedEventSource(
    url: string,
    options: { signal?: AbortSignal } = {},
): Promise<EventSource> {
    const { signal } = options;
    if (signal?.aborted) throw abortError();

    const attempt = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => attempt.abort();
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        attempt.abort();
    }, BOOTSTRAP_TIMEOUT_MS);

    try {
        await ensureSession(attempt.signal);
        if (signal?.aborted) throw abortError();
        return new EventSource(url);
    } catch (error) {
        if (timedOut && !signal?.aborted) {
            throw new TransientStreamError("Event stream bootstrap timed out");
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onCallerAbort);
    }
}
