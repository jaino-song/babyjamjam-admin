/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { GET } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

describe("GET /api/ai/chat/history", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects unauthenticated reads with a registered 401 problem body", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/history"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-chat-history",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(problem), {
                status: 429,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/history"));

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toMatchObject({
            code: "REQUEST_RATE_LIMITED",
            status: 429,
        });
    });

    it("never reflects the raw upstream body text on upstream failure", async () => {
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response("internal sql stack trace", { status: 500 }),
        );

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/history"));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("internal sql stack trace");
        expect(typeof body.error).toBe("string");
    });

    it("sanitizes a transport failure", async () => {
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
        (globalThis.fetch as jest.Mock).mockRejectedValue(new Error("socket hang up"));

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/history"));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("socket hang up");
    });
});
