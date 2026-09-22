/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

describe("POST /api/notifications/test-broadcast", () => {
    const originalFetch = globalThis.fetch;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    const originalDevBase = process.env.DEVELOPMENT_API_BASE_URL;

    beforeEach(() => {
        jest.resetModules();
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        Object.defineProperty(process.env, "NODE_ENV", { value: originalNodeEnv, configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
        process.env.DEVELOPMENT_API_BASE_URL = originalDevBase;
    });

    async function loadRoute(): Promise<typeof import("./route").POST> {
        return (await import("./route")).POST;
    }

    function postRequest(authenticated = true): NextRequest {
        return new NextRequest("http://localhost/api/notifications/test-broadcast", {
            method: "POST",
            headers: {
                ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
                "content-type": "application/json",
            },
            body: JSON.stringify({ title: "테스트", body: "내용" }),
        });
    }

    it("rejects an unauthenticated broadcast with a registered 401 problem body", async () => {
        Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";
        const POST = await loadRoute();

        const response = await POST(postRequest(false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("blocks the test endpoint in production with a registered 403 problem body", async () => {
        Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";
        const POST = await loadRoute();

        const response = await POST(postRequest());

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            code: "ACCESS_DENIED",
            status: 403,
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body faithfully", async () => {
        Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";
        const POST = await loadRoute();
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(
                JSON.stringify({
                    type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#access-denied",
                    title: "Access denied",
                    status: 403,
                    detail: "이 작업을 할 권한이 없어요.",
                    code: "ACCESS_DENIED",
                    requestId: "req-broadcast-1",
                    params: {},
                }),
                { status: 403, headers: { "Content-Type": "application/problem+json" } },
            ),
        );

        const response = await POST(postRequest());

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body).toMatchObject({ code: "ACCESS_DENIED", status: 403, requestId: "req-broadcast-1" });
        expect(response.headers.get("content-type")).toContain("application/problem+json");
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";
        const POST = await loadRoute();
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(
                JSON.stringify({ message: "broadcast provider down on pod-4" }),
                { status: 503, headers: { "Content-Type": "application/json" } },
            ),
        );
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(postRequest());

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("pod-4");
        consoleErrorSpy.mockRestore();
    });

    it("keeps a successful broadcast passthrough", async () => {
        Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";
        const POST = await loadRoute();
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify({ sent: true }), { status: 200 }),
        );

        const response = await POST(postRequest());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ sent: true });
    });
});
