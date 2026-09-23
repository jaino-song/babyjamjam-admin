/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function request(): NextRequest {
    return new NextRequest("http://localhost/api/ai/chat/feedback", {
        method: "POST",
        headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s-1", messageId: "m-1", type: "positive" }),
    });
}

describe("POST /api/ai/chat/feedback", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects unauthenticated submissions with a registered 401 problem body", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await POST(request());

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body faithfully", async () => {
        const problem = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-feedback-submit",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(problem), {
                status: 404,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await POST(request());

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            code: "RESOURCE_NOT_FOUND",
            status: 404,
        });
    });

    it("sanitizes a local failure without leaking the caught error", async () => {
        (globalThis.fetch as jest.Mock).mockRejectedValue(new Error("dns lookup failure internal"));

        const response = await POST(request());

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("dns lookup failure internal");
        expect(JSON.stringify(body)).not.toContain("dns lookup failure internal");
    });
});
