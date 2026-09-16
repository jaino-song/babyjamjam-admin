/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { DELETE, GET } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function mockAuthed(): void {
    mockCookies.mockResolvedValue({
        get: jest.fn().mockReturnValue({ value: "access-token" }),
    } as never);
}

describe("/api/ai/chat/sessions/[id]", () => {
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

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/sessions/s-1"), {
            params: Promise.resolve({ id: "s-1" }),
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body on read", async () => {
        mockAuthed();
        const problem = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-session-read",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify(problem), {
                status: 404,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/sessions/s-1"), {
            params: Promise.resolve({ id: "s-1" }),
        });

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    });

    it("rejects unauthenticated deletes with a registered 401 problem body", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await DELETE(
            new NextRequest("http://localhost/api/ai/chat/sessions/s-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "s-1" }) },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("keeps a 204 delete empty and propagates registered upstream problems", async () => {
        mockAuthed();
        (globalThis.fetch as jest.Mock).mockResolvedValueOnce(new Response(null, { status: 204 }));
        const okDelete = await DELETE(
            new NextRequest("http://localhost/api/ai/chat/sessions/s-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "s-1" }) },
        );
        expect(okDelete.status).toBe(204);
        await expect(okDelete.text()).resolves.toBe("");

        const problem = createProblemDetails({
            code: "REQUEST_CONFLICT",
            requestId: "req-session-delete",
            outcome: "NOT_APPLIED",
        });
        (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
            new Response(JSON.stringify(problem), {
                status: 409,
                headers: { "Content-Type": "application/problem+json" },
            }),
        );
        const conflict = await DELETE(
            new NextRequest("http://localhost/api/ai/chat/sessions/s-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "s-1" }) },
        );
        expect(conflict.status).toBe(409);
        await expect(conflict.json()).resolves.toMatchObject({ code: "REQUEST_CONFLICT" });
    });

    it("sanitizes a transport failure without leaking internal details", async () => {
        mockAuthed();
        (globalThis.fetch as jest.Mock).mockRejectedValue(new Error("connect ETIMEDOUT 10.1.2.3:443"));

        const response = await GET(new NextRequest("http://localhost/api/ai/chat/sessions/s-1"), {
            params: Promise.resolve({ id: "s-1" }),
        });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("ETIMEDOUT");
    });
});
