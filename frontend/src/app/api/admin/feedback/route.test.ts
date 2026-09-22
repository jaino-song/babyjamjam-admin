/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { createProblemDetails } from "@babyjamjam/shared";

import { GET } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function mockAuthCookie(token?: string): void {
    mockCookies.mockResolvedValue({
        get: jest.fn().mockReturnValue(token ? { value: token } : undefined),
    } as never);
}

describe("GET /api/admin/feedback", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects an unauthenticated list read with a registered 401 problem body", async () => {
        mockAuthCookie(undefined);

        const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status and params", async () => {
        mockAuthCookie("access-token");
        const problem = createProblemDetails({
            code: "REQUEST_INVALID",
            requestId: "req-feedback-list",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(problem), {
                status: 400,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await GET(
            new NextRequest("http://localhost/api/admin/feedback?page=2&limit=5&type=BUG"),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_INVALID", status: 400 });
        const upstreamUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
        expect(upstreamUrl).toContain("/admin/feedback?");
        expect(upstreamUrl).toContain("page=2");
        expect(upstreamUrl).toContain("type=BUG");
    });

    it("keeps a successful upstream payload untouched", async () => {
        mockAuthCookie("access-token");
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
        );

        const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ items: [], total: 0 });
    });
});
