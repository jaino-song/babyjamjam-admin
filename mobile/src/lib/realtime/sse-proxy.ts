import { upstreamSseTransportErrorResponse } from "@/lib/api/problem-responses";

// The proxying serverless function is killed at its own duration limit
// (`maxDuration = 60` on the route) without telling the browser. Ending the
// stream here, a little earlier, makes the close clean so EventSource reopens
// right away instead of waiting for the client's no-ping watchdog.
export const SSE_PROXY_TIMEOUT_MS = 50_000;

const SSE_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
} as const;

type AbortCause = "request" | "timeout" | null;

interface ProxySseStreamOptions {
    headers: HeadersInit;
    lastEventId?: string | null;
    requestSignal: AbortSignal;
    upstreamUrl: string;
}

function createSseResponse(body: BodyInit | null): Response {
    return new Response(body, {
        status: 200,
        headers: SSE_RESPONSE_HEADERS,
    });
}

async function settleWritable(
    writable: WritableStream<Uint8Array>,
    error?: unknown,
): Promise<void> {
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    try {
        writer = writable.getWriter();

        if (error === undefined) {
            await writer.close();
            return;
        }

        await writer.abort(error);
    } catch {
        // The upstream can finish concurrently with the timeout/client abort.
    } finally {
        writer?.releaseLock();
    }
}

/**
 * Pipes an upstream SSE response to the browser with a hard deadline.
 *
 * Mirrors `frontend/src/lib/api/sse-proxy.ts`; mobile deploys independently
 * and must not import from the sibling app.
 */
export async function proxySseStream({
    headers,
    lastEventId,
    requestSignal,
    upstreamUrl,
}: ProxySseStreamOptions): Promise<Response> {
    const upstreamController = new AbortController();
    let abortCause: AbortCause = null;
    let cleanedUp = false;

    const abortUpstream = (cause: Exclude<AbortCause, null>, reason?: unknown) => {
        if (upstreamController.signal.aborted) {
            return;
        }

        abortCause = cause;
        upstreamController.abort(reason);
    };
    const handleRequestAbort = () => {
        abortUpstream("request", requestSignal.reason);
    };
    const timeoutId = setTimeout(() => {
        abortUpstream(
            "timeout",
            new DOMException("SSE proxy deadline reached", "TimeoutError"),
        );
    }, SSE_PROXY_TIMEOUT_MS);
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        clearTimeout(timeoutId);
        requestSignal.removeEventListener("abort", handleRequestAbort);
    };

    if (requestSignal.aborted) {
        handleRequestAbort();
    } else {
        requestSignal.addEventListener("abort", handleRequestAbort, {
            once: true,
        });
    }

    try {
        const upstreamHeaders = new Headers(headers);
        // The backend also accepts `?since=` (which wins); keep forwarding the standard header.
        if (lastEventId) {
            upstreamHeaders.set("Last-Event-ID", lastEventId);
        }
        const upstream = await fetch(upstreamUrl, {
            method: "GET",
            headers: upstreamHeaders,
            signal: upstreamController.signal,
            cache: "no-store",
        });

        if (!upstream.ok || !upstream.body) {
            // Release the upstream connection: cleanup() removes the abort
            // handle, so an unread body would otherwise linger in the pool.
            // The body is never forwarded: it can carry backend-authored
            // text the browser must not see, so only the status goes through.
            await upstream.body?.cancel().catch(() => undefined);
            cleanup();
            return new Response(null, { status: upstream.status });
        }

        const transform = new TransformStream<Uint8Array, Uint8Array>();

        void upstream.body
            .pipeTo(transform.writable, {
                signal: upstreamController.signal,
                preventAbort: true,
            })
            .catch(async (error: unknown) => {
                if (abortCause !== null) {
                    await settleWritable(transform.writable);
                    return;
                }

                await settleWritable(transform.writable, error);
            })
            .finally(cleanup);

        return createSseResponse(transform.readable);
    } catch {
        cleanup();

        // A deadline or client abort ends the stream cleanly; anything else is a
        // transport failure the browser should see as an error event.
        if (abortCause !== null) {
            return createSseResponse(null);
        }

        return upstreamSseTransportErrorResponse("read");
    }
}
