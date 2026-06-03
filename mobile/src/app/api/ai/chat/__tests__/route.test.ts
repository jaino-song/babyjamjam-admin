/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST as persistChat } from "../persist/route";
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
    await expect(response.text()).resolves.toContain("backend unavailable");
  });
});
