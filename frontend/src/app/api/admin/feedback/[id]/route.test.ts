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

const upstreamProblem = createProblemDetails({
    code: "RESOURCE_NOT_FOUND",
    requestId: "req-feedback-detail",
    outcome: "NOT_APPLIED",
});

describe("GET /api/admin/feedback/[id]", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        mockAuthCookie(undefined);

        const response = await GET(
            {} as never,
            { params: Promise.resolve({ id: "fb-1" }) },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
        expect(body.requestId).toBe(response.headers.get("X-Request-Id"));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body faithfully with its status", async () => {
        mockAuthCookie("access-token");
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(upstreamProblem), {
                status: 404,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await GET(
            {} as never,
            { params: Promise.resolve({ id: "fb-1" }) },
        );

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
        expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain("/admin/feedback/fb-1");
    });

    it("sanitizes a legacy upstream failure without reflecting its raw text", async () => {
        mockAuthCookie("access-token");
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify({ message: "raw upstream diagnostic" }), { status: 500 }),
        );

        const response = await GET(
            {} as never,
            { params: Promise.resolve({ id: "fb-1" }) },
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error.length).toBeGreaterThan(0);
        expect(body.error).not.toContain("raw upstream diagnostic");
    });
});
