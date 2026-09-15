import { refreshApplicationSession } from "@/lib/auth/session-refresh";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function requiresApplicationSessionRefresh(response: Response): boolean {
    return response.status === 401;
}

function requestSignal(input: FetchInput, init?: FetchInit): AbortSignal | undefined {
    if (init?.signal) return init.signal;
    if (typeof Request !== "undefined" && input instanceof Request) return input.signal;
    return undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export async function authenticatedFetch(
    input: FetchInput,
    init?: FetchInit,
): Promise<Response> {
    const retryInput = typeof Request !== "undefined" && input instanceof Request
        ? input.clone()
        : input;
    const signal = requestSignal(input, init);
    const response = await fetch(input, init);

    if (!requiresApplicationSessionRefresh(response)) return response;

    throwIfAborted(signal);
    await refreshApplicationSession();
    throwIfAborted(signal);
    return fetch(retryInput, init);
}

export async function openAuthenticatedEventSource(
    url: string | URL,
    options: { signal?: AbortSignal; withCredentials?: boolean } = {},
): Promise<EventSource> {
    throwIfAborted(options.signal);
    const response = await authenticatedFetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
    });
    if (!response.ok) {
        throw new Error("Unable to establish an authenticated event stream");
    }

    throwIfAborted(options.signal);
    return new EventSource(url, { withCredentials: options.withCredentials ?? false });
}
