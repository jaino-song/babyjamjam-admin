/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET, maxDuration } from "../route";

const REQUEST_URL = "http://localhost/api/realtime/events";

describe("realtime events SSE proxy", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated subscription with AUTH_REQUIRED and never calls upstream", async () => {
        const fetchMock = jest.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const response = await GET(new NextRequest(REQUEST_URL));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("forwards the auth cookie as a Bearer token to the upstream /realtime/events path", async () => {
        let upstreamUrl = "";
        let upstreamHeaders: Headers | undefined;
        globalThis.fetch = jest.fn((input, init) => {
            upstreamUrl = String(input);
            upstreamHeaders = new Headers(init?.headers);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as typeof fetch;

        await GET(
            new NextRequest(REQUEST_URL, {
                headers: { cookie: "auth_token=auth-token", "Last-Event-ID": "event-7" },
            }),
        );

        expect(new URL(upstreamUrl).pathname.endsWith("/realtime/events")).toBe(true);
        expect(upstreamHeaders?.get("Authorization")).toBe("Bearer auth-token");
        expect(upstreamHeaders?.get("Accept")).toBe("text/event-stream");
        expect(upstreamHeaders?.get("Last-Event-ID")).toBe("event-7");
    });

    describe("resume cursor", () => {
        const captureUpstream = () => {
            const captured: { url: string; headers?: Headers } = { url: "" };
            globalThis.fetch = jest.fn((input, init) => {
                captured.url = String(input);
                captured.headers = new Headers(init?.headers);
                return Promise.resolve(new Response(null, { status: 204 }));
            }) as typeof fetch;
            return captured;
        };
        const get = (query: string, headers: Record<string, string> = {}) =>
            GET(
                new NextRequest(`${REQUEST_URL}${query}`, {
                    headers: { cookie: "auth_token=auth-token", ...headers },
                }),
            );

        it("forwards a valid since as the backend ?since= query", async () => {
            const upstream = captureUpstream();

            await get("?since=1700000000000-3");

            expect(new URL(upstream.url).searchParams.get("since")).toBe("1700000000000-3");
        });

        it("forwards an epoch:seq cursor, and Last-Event-ID alongside it", async () => {
            const upstream = captureUpstream();

            await get(`?since=${encodeURIComponent("abc.1:42")}`, { "Last-Event-ID": "event-7" });

            expect(new URL(upstream.url).searchParams.get("since")).toBe("abc.1:42");
            expect(upstream.headers?.get("Last-Event-ID")).toBe("event-7");
        });

        it("sends no query when the request has no since", async () => {
            const upstream = captureUpstream();

            await get("");

            expect(new URL(upstream.url).search).toBe("");
        });

        it.each([
            ["empty", "?since="],
            ["a space", "?since=a%20b"],
            ["a slash", "?since=a%2Fb"],
            ["a newline", "?since=a%0Ab"],
            ["more than 64 chars", `?since=${"x".repeat(65)}`],
        ])("drops an invalid since (%s) instead of forwarding it", async (_label, query) => {
            const upstream = captureUpstream();

            await get(query, { "Last-Event-ID": "event-7" });

            expect(new URL(upstream.url).search).toBe("");
            expect(upstream.headers?.get("Last-Event-ID")).toBe("event-7");
        });

        it("accepts a cursor of exactly 64 chars", async () => {
            const upstream = captureUpstream();
            const cursor = "x".repeat(64);

            await get(`?since=${cursor}`);

            expect(new URL(upstream.url).searchParams.get("since")).toBe(cursor);
        });
    });

    it("keeps the Vercel safety-net duration shared with the other SSE proxies", () => {
        expect(maxDuration).toBe(60);
    });
});
