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

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/ai/chat/stream", {
        method: "POST",
        body: JSON.stringify({ message: "안녕" }),
        headers: { "Content-Type": "application/json" },
    });
}

describe("POST /api/ai/chat/stream", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("rejects unauthenticated streams with a registered 401 problem body", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await POST(createRequest());

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("logs the upstream body server-side and reports a registered code on the SSE error event", async () => {
        const upstreamDiagnostic = "permission scope mismatch";
        globalThis.fetch = jest.fn().mockResolvedValue(
            new Response(upstreamDiagnostic, { status: 403 }),
        ) as typeof fetch;
        const consoleErrorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const response = await POST(createRequest());
        const body = await response.text();

        expect(response.status).toBe(403);
        expect(body).toContain("event: error");
        expect(body).toContain("ACCESS_DENIED");
        expect(body).not.toContain(upstreamDiagnostic);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[chat upstream stream request] Error:",
            expect.objectContaining({
                status: 403,
                body: upstreamDiagnostic,
            }),
        );
    });

    it("keeps the stream transport headers on upstream failure", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue(
            new Response("upstream unavailable", { status: 503 }),
        ) as typeof fetch;

        const response = await POST(createRequest());

        expect(response.status).toBe(503);
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        const body = await response.text();
        expect(body).toContain("DEPENDENCY_UNAVAILABLE");
        expect(body).not.toContain("upstream unavailable");
    });
});
