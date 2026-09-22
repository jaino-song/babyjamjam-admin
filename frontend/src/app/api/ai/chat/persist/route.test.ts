/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function request(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/ai/chat/persist", {
        method: "POST",
        headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/ai/chat/persist", () => {
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

    it("rejects unauthenticated persists with a registered 401 problem body", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await POST(request({ messages: [] }));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("rejects a malformed body with a registered validation problem", async () => {
        const malformed = new NextRequest("http://localhost/api/ai/chat/persist", {
            method: "POST",
            headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
            body: "{bad-json",
        });

        const response = await POST(malformed);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure while preserving its status", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify({ statusCode: 503, message: "db down" }), { status: 503 }),
        );

        const response = await POST(request({ messages: [] }));

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("db down");
    });

    it("reports an unconfirmable transport failure with a registered code and CHECK_STATUS recovery", async () => {
        (globalThis.fetch as jest.Mock).mockRejectedValue(new Error("connection reset mid-flight"));

        const response = await POST(request({ messages: [] }));

        expect(response.status).toBe(502);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "UPSTREAM_INVALID_RESPONSE",
            status: 502,
            outcome: "UNKNOWN",
        });
        expect(body.recovery).toMatchObject({ action: "CHECK_STATUS" });
        expect(JSON.stringify(body)).not.toContain("connection reset mid-flight");
    });
});
