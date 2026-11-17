/**
 * @jest-environment node
 */
import { PROBLEM_CATALOG } from "@babyjamjam/shared";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST } from "./route";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({
    BACKEND_BASE_URL: "https://backend.example.test",
}));

const mockCookies = jest.mocked(cookies);
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;

function createRequest(body = JSON.stringify({ message: "hello" })): NextRequest {
    return new NextRequest("http://localhost/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

function expectProblemHeaders(response: Response): void {
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Content-Language")).toBe("ko-KR");
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
}

async function readSseError(response: Response) {
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    const body = await response.text();
    expect(body).toMatch(/^event: error\ndata: [^\n]+\n\n$/);
    const payload = JSON.parse(body.replace(/^event: error\ndata: /, "").trim());
    expect(payload.type).toBe("error");
    return payload;
}

describe("POST /api/ai/chat/stream", () => {
    beforeEach(() => {
        mockCookies.mockReset();
        mockCookies.mockResolvedValue({
            get: jest.fn((name: string) => name === "auth_token" ? { value: "test-token" } : undefined),
        } as never);
        mockFetch.mockReset();
        globalThis.fetch = mockFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it.each([JSON.stringify({ message: "hello" }), "{bad-json"])(
        "refuses unauthenticated requests before parsing or proxying: %s",
        async (body) => {
            mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);
            const request = createRequest(body);
            const jsonSpy = jest.spyOn(request, "json");

            const response = await POST(request);

            expect(response.status).toBe(401);
            expectProblemHeaders(response);
            await expect(response.json()).resolves.toMatchObject({
                code: "AUTH_REQUIRED",
                status: 401,
                error: "Unauthorized",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
                requestId: response.headers.get("X-Request-Id"),
            });
            expect(jsonSpy).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        },
    );

    it("rejects malformed JSON with a canonical validation problem before proxying", async () => {
        const response = await POST(createRequest("{bad-json"));

        expect(response.status).toBe(400);
        expectProblemHeaders(response);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Request body must be valid JSON",
            requestId: response.headers.get("X-Request-Id"),
            errors: [{ pointer: "", code: "INVALID_FORMAT", location: "body" }],
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
        { sessionId: "s1" },
        { message: "" },
        { message: null },
        { message: 42 },
        { message: "hello", sessionId: 42 },
        null,
        [],
    ])("rejects invalid body %j before proxying", async (body) => {
        const response = await POST(createRequest(JSON.stringify(body)));

        expect(response.status).toBe(400);
        expectProblemHeaders(response);
        const problem = await response.json();
        expect(problem).toMatchObject({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            requestId: response.headers.get("X-Request-Id"),
        });
        expect(problem.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ location: "body" }),
        ]));
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
        { message: "hello", sessionId: "s1" },
        { message: "hello", sessionId: null },
        { message: "hello" },
        { message: "가".repeat(20_000), sessionId: null },
        { message: "hello", sessionId: "s1", clientContext: { source: "mobile" } },
    ])("forwards valid body %# and passes the successful SSE stream through unchanged", async (body) => {
        const streamBody = "event: message\ndata: {\"text\":\"hello\"}\n\nevent: done\ndata: {}\n\n";
        mockFetch.mockResolvedValue(new Response(streamBody));

        const response = await POST(createRequest(JSON.stringify(body)));

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith("https://backend.example.test/ai/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        expect(response.headers.get("Cache-Control")).toBe("no-cache");
        expect(response.headers.get("Connection")).toBe("keep-alive");
        await expect(response.text()).resolves.toBe(streamBody);
    });

    it.each([429, 502, 503])("preserves upstream status %i while sanitizing raw SSE error details", async (status) => {
        const diagnostic = "stream stack from /internal/chat";
        mockFetch.mockResolvedValue(new Response(diagnostic, { status }));

        const response = await POST(createRequest());

        expect(response.status).toBe(status);
        const payload = await readSseError(response);
        expect(payload.error).toMatch(/[가-힣]/);
        expect(payload).not.toHaveProperty("code");
        expect(JSON.stringify(payload)).not.toContain(diagnostic);
        expect(JSON.stringify(payload)).not.toContain("/internal/chat");
    });

    it("preserves a registered upstream problem inside the legacy SSE error envelope", async () => {
        const upstreamProblem = {
            type: PROBLEM_CATALOG.REQUEST_CONFLICT.type,
            title: "internal conflict title",
            detail: "internal conflict diagnostics",
            code: "REQUEST_CONFLICT",
            status: 409,
            requestId: "req-stream-9",
            params: {},
            outcome: "NOT_APPLIED",
        };
        mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamProblem), {
            status: 409,
            headers: { "Content-Type": "application/problem+json" },
        }));

        const response = await POST(createRequest());

        expect(response.status).toBe(409);
        const payload = await readSseError(response);
        expect(payload).toMatchObject({
            code: "REQUEST_CONFLICT",
            status: 409,
            requestId: "req-stream-9",
            outcome: "NOT_APPLIED",
            title: PROBLEM_CATALOG.REQUEST_CONFLICT.title["ko-KR"],
            detail: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
            error: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
        });
        expect(JSON.stringify(payload)).not.toContain("internal conflict");
    });

    it("sanitizes an unreadable upstream error body without losing its status", async () => {
        const backendResponse = new Response(null, { status: 503 });
        jest.spyOn(backendResponse, "text").mockRejectedValue(new Error("internal body read failed"));
        mockFetch.mockResolvedValue(backendResponse);

        const response = await POST(createRequest());

        expect(response.status).toBe(503);
        const payload = await readSseError(response);
        expect(payload.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(payload)).not.toContain("internal body read failed");
    });

    it("converts a transport failure to a sanitized registered SSE problem with unknown mutation outcome", async () => {
        const diagnostic = "fetch failed at /internal/chat";
        mockFetch.mockRejectedValue(new TypeError(diagnostic));

        const response = await POST(createRequest());

        expect(response.status).toBe(502);
        const payload = await readSseError(response);
        expect(payload).toMatchObject({
            code: "UPSTREAM_INVALID_RESPONSE",
            status: 502,
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
            error: PROBLEM_CATALOG.UPSTREAM_INVALID_RESPONSE.detail["ko-KR"],
        });
        expect(payload.requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
        expect(JSON.stringify(payload)).not.toContain(diagnostic);
    });
});
