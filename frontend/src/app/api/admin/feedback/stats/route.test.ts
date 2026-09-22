/**
 * @jest-environment node
 */
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

describe("GET /api/admin/feedback/stats", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects an unauthenticated stats read with a registered 401 problem body", async () => {
        mockAuthCookie(undefined);

        const response = await GET();

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        mockAuthCookie("access-token");
        const problem = createProblemDetails({
            code: "DEPENDENCY_UNAVAILABLE",
            requestId: "req-feedback-stats",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(problem), {
                status: 503,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await GET();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
        });
    });
});
