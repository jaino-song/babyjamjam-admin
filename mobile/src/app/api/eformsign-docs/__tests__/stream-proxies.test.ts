/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET as getEvents } from "../events/route";
import { GET as getDispatchProgress } from "../dispatch-headless/progress/route";
import { GET as getFinalizeProgress } from "../finalize-headless/progress/route";

const mockFetch = jest.fn();
const originalFetch = global.fetch;

function createRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      cookie: "auth_token=auth-token",
    },
  });
}

describe("eformsign SSE proxy routes", () => {
  beforeAll(() => {
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("preserves upstream error JSON for document events", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "tenant blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getEvents(createRequest("/api/eformsign-docs/events"));

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "tenant blocked" });
  });

  it("maps document event transport failures to a structured response", async () => {
    mockFetch.mockRejectedValue(new Error("backend unavailable"));

    const response = await getEvents(createRequest("/api/eformsign-docs/events"));

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "backend unavailable" });
  });

  it("preserves upstream error text for dispatch progress", async () => {
    mockFetch.mockResolvedValue(
      new Response("progress stream unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await getDispatchProgress(
      createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("progress stream unavailable");
  });

  it("maps dispatch progress transport failures to a structured response", async () => {
    mockFetch.mockRejectedValue(new Error("dispatch backend unavailable"));

    const response = await getDispatchProgress(
      createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "dispatch backend unavailable" });
  });

  it("preserves upstream error JSON for finalize progress", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "progress not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getFinalizeProgress(
      createRequest("/api/eformsign-docs/finalize-headless/progress?progressId=missing"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ message: "progress not found" });
  });

  it("maps finalize progress transport failures to a structured response", async () => {
    mockFetch.mockRejectedValue(new Error("finalize backend unavailable"));

    const response = await getFinalizeProgress(
      createRequest("/api/eformsign-docs/finalize-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "finalize backend unavailable" });
  });
});
