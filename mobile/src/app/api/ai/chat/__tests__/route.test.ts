/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST as submitFeedback } from "../feedback/route";
import { GET as getChatHistory } from "../history/route";
import { POST as persistChat } from "../persist/route";
import { GET as getChatSession, DELETE as deleteChatSession } from "../sessions/[id]/route";
import { POST as streamChat } from "../stream/route";

async function expectCanonicalValidationResponse(
  response: Response,
  legacyError: string,
): Promise<void> {
  expect(response.status).toBe(400);
  const requestId = response.headers.get("X-Request-Id");
  expect(requestId).toEqual(expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(response.headers.get("Content-Language")).toBe("ko-KR");
  expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");

  const body = await response.json();
  expect(body).toMatchObject({
    code: "VALIDATION_FAILED",
    outcome: "NOT_APPLIED",
    error: legacyError,
    requestId,
  });
  expect(Array.isArray(body.errors)).toBe(true);
}

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

const mockCookies = cookies as jest.Mock;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

function setAuthCookie(token?: string): void {
  mockCookies.mockResolvedValue({
    get: jest.fn((name: string) => {
      if (name === "auth_token" && token) {
        return { value: token };
      }

      return undefined;
    }),
  });
}

function createRequest(path: string, body: BodyInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function createGetRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "GET",
  });
}

function createSessionParams(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("AI chat API routes", () => {
  beforeAll(() => {
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockCookies.mockReset();
    mockFetch.mockReset();
  });

  describe("auth rejection", () => {
    it("rejects stream POST without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await streamChat(createRequest("/api/ai/chat/stream", JSON.stringify({ message: "hi" })));
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects persist POST without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await persistChat(
        createRequest("/api/ai/chat/persist", JSON.stringify({ userMessage: "hi", assistantContent: "yo" })),
      );
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects feedback POST without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await submitFeedback(
        createRequest("/api/ai/chat/feedback", JSON.stringify({ sessionId: "s1", type: "positive" })),
      );
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects history GET without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await getChatHistory(createGetRequest("/api/ai/chat/history"));
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects session GET without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await getChatSession(
        createGetRequest("/api/ai/chat/sessions/session-1"),
        createSessionParams("session-1"),
      );
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects session DELETE without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await deleteChatSession(
        createGetRequest("/api/ai/chat/sessions/session-1"),
        createSessionParams("session-1"),
      );
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("rejects malformed persist JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await persistChat(createRequest("/api/ai/chat/persist", "{bad-json"));

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects persist bodies missing required fields before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await persistChat(
      createRequest("/api/ai/chat/persist", JSON.stringify({ userMessage: "hi" })),
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preserves successful backend status when persisting chat state", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await persistChat(
      createRequest(
        "/api/ai/chat/persist",
        JSON.stringify({ userMessage: "hello", assistantContent: "hi there" }),
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(forwarded).toEqual({ userMessage: "hello", assistantContent: "hi there" });
  });

  it("maps persist upstream errors without returning raw backend text", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response("stack trace from /internal/chat", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await persistChat(
      createRequest(
        "/api/ai/chat/persist",
        JSON.stringify({ userMessage: "hello", assistantContent: "hi" }),
      ),
    );

    expect(response.status).toBe(500);
    // The non-catalog UPSTREAM_ERROR body is gone: the sanitized Korean
    // status fallback keeps the 500 without inventing a code.
    await expect(response.json()).resolves.toEqual({
      error: "서버 내부 오류로 요청을 처리하지 못했어요.",
    });
  });

  it("rejects malformed stream JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await streamChat(createRequest("/api/ai/chat/stream", "{bad-json"));

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects stream bodies missing the required message before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await streamChat(
      createRequest("/api/ai/chat/stream", JSON.stringify({ sessionId: "s1" })),
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the validated stream body to the backend", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response("event: message\ndata: {}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    await streamChat(
      createRequest(
        "/api/ai/chat/stream",
        JSON.stringify({ message: "hello", sessionId: "s1" }),
      ),
    );

    const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(forwarded).toEqual({ message: "hello", sessionId: "s1" });
  });

  it("accepts a null sessionId for new chat sessions", async () => {
    // Regression (PR #236 review): useChatStream sends sessionId: null until
    // the backend assigns one; the proxy must not 400 first-time chats.
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response("event: message\ndata: {}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const response = await streamChat(
      createRequest(
        "/api/ai/chat/stream",
        JSON.stringify({ message: "hello", sessionId: null }),
      ),
    );

    expect(response.status).toBe(200);
    const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(forwarded).toEqual({ message: "hello", sessionId: null });
  });

  it("persists null-session and long assistant replies without a proxy cap", async () => {
    // Regression (PR #236 review): long generated answers must not be
    // silently dropped from history by a proxy-only length cap.
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const longReply = "가".repeat(20_000);
    const response = await persistChat(
      createRequest(
        "/api/ai/chat/persist",
        JSON.stringify({
          userMessage: "질문",
          assistantContent: longReply,
          sessionId: null,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(forwarded.assistantContent).toHaveLength(20_000);
    expect(forwarded.sessionId).toBeNull();
  });

  it("maps stream transport failures to a structured SSE error", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockRejectedValue(new Error("backend unavailable"));

    const response = await streamChat(
      createRequest("/api/ai/chat/stream", JSON.stringify({ message: "hello" })),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const transportBody = await response.text();
    expect(transportBody).toContain("event: error");
    expect(transportBody).toContain("UPSTREAM_INVALID_RESPONSE");
  });

  it("maps stream upstream errors without returning raw backend text", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response("stream stack from /internal/chat", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await streamChat(
      createRequest("/api/ai/chat/stream", JSON.stringify({ message: "hello" })),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toMatch(/[가-힣]/);
    expect(body).not.toContain("/internal/chat");
    expect(body).not.toContain("stream stack");
  });

  it("rejects out-of-range history limits before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history?limit=500"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "VALIDATION_FAILED",
      outcome: "NOT_APPLIED",
      error: "limit must be between 1 and 50",
      errors: [expect.objectContaining({ pointer: "/limit", code: "OUT_OF_RANGE", location: "query" })],
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects negative history offsets before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history?offset=-1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "VALIDATION_FAILED",
      outcome: "NOT_APPLIED",
      error: "offset must be greater than or equal to 0",
      errors: [expect.objectContaining({ pointer: "/offset", code: "OUT_OF_RANGE", location: "query" })],
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preserves successful backend status when fetching history", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 206,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history?offset=1&limit=2"));

    expect(response.status).toBe(206);
    await expect(response.json()).resolves.toEqual({ items: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/ai/chat/history?offset=1&limit=2"),
      expect.any(Object),
    );
  });

  it("maps history upstream errors without returning raw backend text", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response("history stack from /internal/chat", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "서버가 현재 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("rejects unsafe session IDs before fetching a session", async () => {
    setAuthCookie("auth-token");

    const response = await getChatSession(
      createGetRequest("/api/ai/chat/sessions/bad%2Fid"),
      createSessionParams("bad/id"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "VALIDATION_FAILED",
      error: "Invalid session id",
      errors: [expect.objectContaining({ pointer: "/id", code: "INVALID_FORMAT", location: "path" })],
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe session IDs before deleting a session", async () => {
    setAuthCookie("auth-token");

    const response = await deleteChatSession(
      createGetRequest("/api/ai/chat/sessions/bad%2Fid"),
      createSessionParams("bad/id"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "VALIDATION_FAILED",
      error: "Invalid session id",
      errors: [expect.objectContaining({ pointer: "/id", code: "INVALID_FORMAT", location: "path" })],
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps session fetch upstream errors without returning raw backend JSON", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "session stack from /internal/chat" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getChatSession(
      createGetRequest("/api/ai/chat/sessions/session-1"),
      createSessionParams("session-1"),
    );

    expect(response.status).toBe(500);
    // An upstream JSON error object is sanitized member-by-member: no raw
    // message surfaces and no non-catalog code is forwarded.
    await expect(response.json()).resolves.toEqual({
      error: "서버 내부 오류로 요청을 처리하지 못했어요.",
    });
  });

  it("maps session delete upstream errors without returning raw backend JSON", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "delete stack from /internal/chat" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await deleteChatSession(
      createGetRequest("/api/ai/chat/sessions/session-1"),
      createSessionParams("session-1"),
    );

    expect(response.status).toBe(409);
    const deleteBody = await response.json();
    expect(deleteBody.error).toMatch(/[가-힣]/);
    expect(deleteBody).not.toHaveProperty("code");
    expect(JSON.stringify(deleteBody)).not.toContain("/internal/chat");
    expect(JSON.stringify(deleteBody)).not.toContain("delete stack");
  });

  it("rejects malformed feedback JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await submitFeedback(createRequest("/api/ai/chat/feedback", "{bad-json"));

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects feedback with an invalid type before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await submitFeedback(
      createRequest(
        "/api/ai/chat/feedback",
        JSON.stringify({ sessionId: "s1", type: "meh" }),
      ),
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the validated feedback body to the backend", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, id: "fb-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await submitFeedback(
      createRequest(
        "/api/ai/chat/feedback",
        JSON.stringify({ sessionId: "s1", type: "positive", comment: "great" }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "fb-1" });
    const forwarded = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(forwarded).toEqual({ sessionId: "s1", type: "positive", comment: "great" });
  });
});
