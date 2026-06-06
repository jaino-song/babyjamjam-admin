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

  it("rejects malformed persist JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await persistChat(createRequest("/api/ai/chat/persist", "{bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
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
      createRequest("/api/ai/chat/persist", JSON.stringify({ message: "hello" })),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
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
      createRequest("/api/ai/chat/persist", JSON.stringify({ message: "hello" })),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Backend request failed",
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects malformed stream JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await streamChat(createRequest("/api/ai/chat/stream", "{bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps stream transport failures to a structured SSE error", async () => {
    setAuthCookie("auth-token");
    mockFetch.mockRejectedValue(new Error("backend unavailable"));

    const response = await streamChat(
      createRequest("/api/ai/chat/stream", JSON.stringify({ message: "hello" })),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain("Streaming unavailable");
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
    expect(body).toContain("Streaming unavailable");
    expect(body).not.toContain("/internal/chat");
  });

  it("rejects out-of-range history limits before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history?limit=500"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "limit must be between 1 and 50",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects negative history offsets before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await getChatHistory(createGetRequest("/api/ai/chat/history?offset=-1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "offset must be greater than or equal to 0",
    });
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
      error: "Backend request failed",
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects unsafe session IDs before fetching a session", async () => {
    setAuthCookie("auth-token");

    const response = await getChatSession(
      createGetRequest("/api/ai/chat/sessions/bad%2Fid"),
      createSessionParams("bad/id"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid session id" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe session IDs before deleting a session", async () => {
    setAuthCookie("auth-token");

    const response = await deleteChatSession(
      createGetRequest("/api/ai/chat/sessions/bad%2Fid"),
      createSessionParams("bad/id"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid session id" });
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
    await expect(response.json()).resolves.toEqual({
      error: "Backend request failed",
      code: "UPSTREAM_ERROR",
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
    await expect(response.json()).resolves.toEqual({
      error: "Backend request failed",
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects malformed feedback JSON before proxying", async () => {
    setAuthCookie("auth-token");

    const response = await submitFeedback(createRequest("/api/ai/chat/feedback", "{bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
