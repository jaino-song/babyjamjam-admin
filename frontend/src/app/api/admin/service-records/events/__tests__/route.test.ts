/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET, maxDuration } from "../route";

const REQUEST_URL = "http://localhost/api/admin/service-records/events";

describe("admin service-record case events SSE proxy", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated subscription with AUTH_REQUIRED", async () => {
        globalThis.fetch = jest.fn() as typeof fetch;

        const response = await GET(new NextRequest(REQUEST_URL));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("streams from the admin service-record events upstream with the bearer token", async () => {
        let upstreamUrl = "";
        let upstreamHeaders: Headers | undefined;
        globalThis.fetch = jest.fn((input, init) => {
            upstreamUrl = String(input);
            upstreamHeaders = new Headers(init?.headers);
            return Promise.resolve(
                new Response(new ReadableStream<Uint8Array>(), {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            );
        }) as typeof fetch;

        const response = await GET(
            new NextRequest(REQUEST_URL, {
                headers: { cookie: "auth_token=auth-token", "Last-Event-ID": "event-7" },
            }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
        expect(upstreamUrl).toMatch(/\/admin\/service-records\/events$/);
        expect(upstreamHeaders?.get("Authorization")).toBe("Bearer auth-token");
        expect(upstreamHeaders?.get("Accept")).toBe("text/event-stream");
        expect(upstreamHeaders?.get("Last-Event-ID")).toBe("event-7");
    });

    it("aborts upstream and cleanly closes before the Vercel limit", async () => {
        const cancelUpstream = jest.fn();
        let upstreamSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamSignal = init?.signal ?? undefined;
            return Promise.resolve(
                new Response(new ReadableStream<Uint8Array>({ cancel: cancelUpstream }), {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            );
        }) as typeof fetch;

        const response = await GET(
            new NextRequest(REQUEST_URL, { headers: { cookie: "auth_token=auth-token" } }),
        );
        const completedRead = response.body?.getReader().read();

        expect(maxDuration).toBe(60);
        await jest.advanceTimersByTimeAsync(49_999);
        expect(upstreamSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);

        expect(upstreamSignal?.aborted).toBe(true);
        await expect(completedRead).resolves.toEqual({ done: true, value: undefined });
        expect(cancelUpstream).toHaveBeenCalledTimes(1);
    });
});
