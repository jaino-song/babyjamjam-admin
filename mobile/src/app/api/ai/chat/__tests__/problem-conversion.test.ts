/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { PROBLEM_CATALOG } from "@babyjamjam/shared";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    BACKEND_BASE_URL: "https://backend.example.test",
}));

import { POST as confirmChat } from "../confirm/route";
import { POST as feedbackChat } from "../feedback/route";
import { GET as chatHistory } from "../history/route";
import { POST as persistChat } from "../persist/route";
import { GET as getSession, DELETE as deleteSession } from "../sessions/[id]/route";
import { POST as streamChat } from "../stream/route";

const mockCookies = cookies as jest.Mock;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

function setAuthCookie(token?: string): void {
    mockCookies.mockResolvedValue({
        get: jest.fn((_name: string) => (token ? { value: token } : undefined)),
    });
}

function postRequest(path: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { "content-type": "application/json" },
    });
}

function expectProblemHeaders(response: Response): void {
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("content-language")).toBe("ko-KR");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
}

describe("mobile ai chat BFF problem conversion", () => {
    beforeAll(() => {
        global.fetch = mockFetch as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        mockCookies.mockReset();
        mockFetch.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("missing-token rejections", () => {
        it.each([
            ["confirm", () => confirmChat(postRequest("/api/ai/chat/confirm", { intentId: "i", nonce: "n" }))],
            ["feedback", () => feedbackChat(postRequest("/api/ai/chat/feedback", { sessionId: "s", type: "positive" }))],
            ["history", () => chatHistory(new NextRequest("http://localhost/api/ai/chat/history"))],
            ["persist", () => persistChat(postRequest("/api/ai/chat/persist", { userMessage: "u", assistantContent: "a" }))],
            ["sessions GET", () => getSession(
                new NextRequest("http://localhost/api/ai/chat/sessions/s1"),
                { params: Promise.resolve({ id: "s1" }) },
            )],
            ["sessions DELETE", () => deleteSession(
                new NextRequest("http://localhost/api/ai/chat/sessions/s1", { method: "DELETE" }),
                { params: Promise.resolve({ id: "s1" }) },
            )],
            ["stream", () => streamChat(postRequest("/api/ai/chat/stream", { message: "m" }))],
        ])("returns an AUTH_REQUIRED problem for %s without contacting the backend", async (_name, act) => {
            setAuthCookie();

            const response = await act();

            expect(response.status).toBe(401);
            if (response.headers.get("content-type")?.includes("text/event-stream")) {
                const payload = JSON.parse((await response.text()).replace(/^event: error\ndata: /, "").trim());
                expect(payload).toMatchObject({ type: "error", code: "AUTH_REQUIRED", status: 401 });
                return;
            }
            expectProblemHeaders(response);
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "AUTH_REQUIRED",
                status: 401,
                outcome: "NOT_APPLIED",
                error: "Unauthorized",
            }));
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    it("rejects a non-integer history offset with a VALIDATION_FAILED query problem", async () => {
        setAuthCookie("token-1");

        const response = await chatHistory(new NextRequest("http://localhost/api/ai/chat/history?offset=abc"));

        expect(response.status).toBe(400);
        expectProblemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            errors: [{ pointer: "/offset", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "query" }],
        }));
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects a malformed session id with a VALIDATION_FAILED path problem", async () => {
        setAuthCookie("token-1");

        const response = await getSession(
            new NextRequest("http://localhost/api/ai/chat/sessions/bad%20id"),
            { params: Promise.resolve({ id: "bad id" }) },
        );

        expect(response.status).toBe(400);
        expectProblemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            errors: [{ pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
        }));
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("preserves the upstream status and Korean fallback when the backend fails without a problem body", async () => {
        setAuthCookie("token-1");
        mockFetch.mockResolvedValue(new Response("raw persist internals", { status: 409 }));

        const response = await persistChat(postRequest("/api/ai/chat/persist", { userMessage: "u", assistantContent: "a" }));

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("raw persist internals");
    });

    it("forwards a verbatim upstream problem body with problem headers", async () => {
        setAuthCookie("token-1");
        // The shared parser re-stamps title/detail from the catalog locale
        // copy; the forwarded identity is type/code/status/requestId/outcome.
        const upstreamProblem = {
            type: PROBLEM_CATALOG.REQUEST_CONFLICT.type,
            title: PROBLEM_CATALOG.REQUEST_CONFLICT.title["ko-KR"],
            status: 409,
            detail: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
            code: "REQUEST_CONFLICT",
            requestId: "req-9",
            params: {},
            outcome: "NOT_APPLIED",
        };
        mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamProblem), {
            status: 409,
            headers: { "content-type": "application/problem+json" },
        }));

        const response = await confirmChat(postRequest("/api/ai/chat/confirm", { intentId: "i", nonce: "n" }));

        expect(response.status).toBe(409);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("x-request-id")).toBe("req-9");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_CONFLICT",
            detail: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
            error: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
            outcome: "NOT_APPLIED",
        }));
    });

    it("maps a backend transport failure during persist to a registered 502 problem", async () => {
        setAuthCookie("token-1");
        mockFetch.mockRejectedValue(new TypeError("fetch failed"));

        const response = await persistChat(postRequest("/api/ai/chat/persist", { userMessage: "u", assistantContent: "a" }));

        expect(response.status).toBe(502);
        expectProblemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "UPSTREAM_INVALID_RESPONSE",
            status: 502,
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        }));
    });

    it("no longer swallows a chat feedback failure into a raw English 500", async () => {
        setAuthCookie("token-1");
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const response = await feedbackChat(postRequest("/api/ai/chat/feedback", { sessionId: "s", type: "positive" }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("keeps the 204 session delete passthrough", async () => {
        setAuthCookie("token-1");
        mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

        const response = await deleteSession(
            new NextRequest("http://localhost/api/ai/chat/sessions/s1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "s1" }) },
        );

        expect(response.status).toBe(204);
    });

    it("keeps the stream status and sanitizes a non-problem upstream failure inside the SSE envelope", async () => {
        setAuthCookie("token-1");
        mockFetch.mockResolvedValue(new Response("raw stream failure detail", { status: 429 }));

        const response = await streamChat(postRequest("/api/ai/chat/stream", { message: "m" }));

        expect(response.status).toBe(429);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        const payload = JSON.parse((await response.text()).replace(/^event: error\ndata: /, "").trim());
        expect(payload.type).toBe("error");
        expect(payload.error).toMatch(/[가-힣]/);
        expect(payload).not.toHaveProperty("code");
        expect(JSON.stringify(payload)).not.toContain("raw stream failure detail");
    });

    it("maps a stream transport failure to the registered SSE problem envelope", async () => {
        setAuthCookie("token-1");
        mockFetch.mockRejectedValue(new TypeError("fetch failed"));

        const response = await streamChat(postRequest("/api/ai/chat/stream", { message: "m" }));

        expect(response.status).toBe(502);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        const payload = JSON.parse((await response.text()).replace(/^event: error\ndata: /, "").trim());
        expect(payload).toMatchObject({ type: "error", code: "UPSTREAM_INVALID_RESPONSE", status: 502, outcome: "UNKNOWN" });
    });
});
