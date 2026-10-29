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

    it("keeps the Vercel safety-net duration shared with the other SSE proxies", () => {
        expect(maxDuration).toBe(60);
    });
});
