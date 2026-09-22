/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";

import { POST as testBroadcast } from "../test-broadcast/route";
import { GET as getVapidKey } from "../vapid-key/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

jest.mock("@/lib/env", () => ({
    getServerRuntimeConfig: jest.fn(() => ({ isProductionNodeEnv: false })),
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockRuntimeConfig = getServerRuntimeConfig as jest.Mock;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

function broadcastRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/notifications/test-broadcast", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
    });
}

describe("notifications BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        mockGet.mockReset();
        mockFetch.mockReset();
        mockRuntimeConfig.mockReturnValue({ isProductionNodeEnv: false });
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("answers a missing token on the test broadcast with an AUTH_REQUIRED problem", async () => {
        const response = await testBroadcast(broadcastRequest(false));

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("answers the production kill switch with a registered ACCESS_DENIED problem", async () => {
        mockRuntimeConfig.mockReturnValue({ isProductionNodeEnv: true });

        const response = await testBroadcast(broadcastRequest(true));

        expect(response.status).toBe(403);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "ACCESS_DENIED",
            status: 403,
            outcome: "NOT_APPLIED",
            error: "Test endpoint disabled in production",
        }));
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("preserves an upstream rejection status and Korean fallback for the test broadcast", async () => {
        mockFetch.mockResolvedValue(new Response("raw broadcast internals", { status: 429 }));

        const response = await testBroadcast(broadcastRequest(true));

        expect(response.status).toBe(429);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("raw broadcast internals");
    });

    it("keeps the test broadcast success passthrough", async () => {
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const response = await testBroadcast(broadcastRequest(true));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("preserves the upstream status and sanitizes the vapid-key failure", async () => {
        mockGet.mockRejectedValue({ response: { status: 503, data: { message: "raw upstream detail" } } });

        const response = await getVapidKey();

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("raw upstream detail");
    });

    it("keeps the vapid-key success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { publicKey: "key-1" } });

        const response = await getVapidKey();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ publicKey: "key-1" });
    });
});
