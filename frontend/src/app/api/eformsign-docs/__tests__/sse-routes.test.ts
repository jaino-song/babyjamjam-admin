/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import {
    GET as getDispatchProgress,
    maxDuration as dispatchProgressMaxDuration,
} from "../dispatch-headless/progress/route";
import {
    GET as getDocumentEvents,
    maxDuration as documentEventsMaxDuration,
} from "../events/route";
import { GET as getFinalizeProgress } from "../finalize-headless/progress/route";

interface RouteCase {
    label: string;
    maxDuration: number;
    requestUrl: string;
    run: (request: NextRequest) => Promise<Response>;
}

const routeCases: RouteCase[] = [
    {
        label: "document events",
        maxDuration: documentEventsMaxDuration,
        requestUrl: "http://localhost/api/eformsign-docs/events",
        run: getDocumentEvents,
    },
    {
        label: "dispatch progress",
        maxDuration: dispatchProgressMaxDuration,
        requestUrl:
            "http://localhost/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        run: getDispatchProgress,
    },
];

describe.each(routeCases)("$label SSE proxy", ({ maxDuration, requestUrl, run }) => {
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

    it("should abort upstream and cleanly close before the Vercel limit", async () => {
        const cancelUpstream = jest.fn();
        const upstreamBody = new ReadableStream<Uint8Array>({
            cancel: cancelUpstream,
        });
        let upstreamSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamSignal = init?.signal ?? undefined;
            return Promise.resolve(
                new Response(upstreamBody, {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            );
        }) as typeof fetch;

        const response = await run(
            new NextRequest(requestUrl, {
                headers: { cookie: "auth_token=auth-token" },
            }),
        );
        const reader = response.body?.getReader();
        const completedRead = reader?.read();

        expect(maxDuration).toBe(60);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe(
            "text/event-stream; charset=utf-8",
        );
        expect(upstreamSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(49_999);
        expect(upstreamSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);

        expect(upstreamSignal?.aborted).toBe(true);
        await expect(completedRead).resolves.toEqual({
            done: true,
            value: undefined,
        });
        expect(cancelUpstream).toHaveBeenCalledTimes(1);
    });

    it("should abort upstream and cleanly close when the client leaves", async () => {
        const cancelUpstream = jest.fn();
        const upstreamBody = new ReadableStream<Uint8Array>({
            cancel: cancelUpstream,
        });
        let upstreamSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamSignal = init?.signal ?? undefined;
            return Promise.resolve(new Response(upstreamBody, { status: 200 }));
        }) as typeof fetch;
        const requestController = new AbortController();
        const response = await run(
            new NextRequest(requestUrl, {
                headers: { cookie: "auth_token=auth-token" },
                signal: requestController.signal,
            }),
        );
        const completedRead = response.body?.getReader().read();

        requestController.abort();
        await jest.advanceTimersByTimeAsync(0);

        expect(upstreamSignal?.aborted).toBe(true);
        await expect(completedRead).resolves.toEqual({
            done: true,
            value: undefined,
        });
        expect(cancelUpstream).toHaveBeenCalledTimes(1);
    });

    it("should forward Last-Event-ID to the upstream request", async () => {
        let upstreamHeaders: Headers | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamHeaders = new Headers(init?.headers);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as typeof fetch;

        await run(
            new NextRequest(requestUrl, {
                headers: {
                    cookie: "auth_token=auth-token",
                    "Last-Event-ID": "event-42",
                },
            }),
        );

        expect(upstreamHeaders?.get("Last-Event-ID")).toBe("event-42");
    });
});

describe("SSE route gates speak the problem contract", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it.each([
        ["document events", getDocumentEvents, "http://localhost/api/eformsign-docs/events"],
        [
            "dispatch progress",
            getDispatchProgress,
            "http://localhost/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        ],
        [
            "finalize progress",
            getFinalizeProgress,
            "http://localhost/api/eformsign-docs/finalize-headless/progress?progressId=progress-1",
        ],
    ])("rejects an unauthenticated %s subscription with AUTH_REQUIRED", async (_label, run, url) => {
        const response = await run(new NextRequest(url));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    });

    it.each([
        ["dispatch progress", getDispatchProgress, "http://localhost/api/eformsign-docs/dispatch-headless/progress"],
        ["finalize progress", getFinalizeProgress, "http://localhost/api/eformsign-docs/finalize-headless/progress"],
    ])("rejects a %s subscription without progressId with VALIDATION_FAILED", async (_label, run, url) => {
        const response = await run(
            new NextRequest(url, { headers: { cookie: "auth_token=auth-token" } }),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(body.errors).toMatchObject([{ pointer: "/progressId", code: "REQUIRED" }]);
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    });

    it("answers a failed finalize-progress upstream with an SSE error event carrying a registered code", async () => {
        globalThis.fetch = jest.fn(() => Promise.resolve(
            new Response(JSON.stringify({ message: "progress store secret" }), { status: 503 }),
        )) as typeof fetch;

        const response = await getFinalizeProgress(
            new NextRequest(
                "http://localhost/api/eformsign-docs/finalize-headless/progress?progressId=progress-1",
                { headers: { cookie: "auth_token=auth-token" } },
            ),
        );

        expect(response.status).toBe(503);
        expect(response.headers.get("Content-Type")).toContain("text/event-stream");
        const payload = await response.text();
        expect(payload).toContain("DEPENDENCY_UNAVAILABLE");
        expect(payload).not.toContain("progress store secret");
    });
});
