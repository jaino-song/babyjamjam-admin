/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { SSE_PROXY_TIMEOUT_MS } from "@/lib/realtime/sse-proxy";

import { GET, maxDuration } from "../route";

const mockFetch = jest.fn();
const originalFetch = global.fetch;

function createRequest(options: { cookie?: boolean; signal?: AbortSignal; headers?: Record<string, string> } = {}): NextRequest {
  const { cookie = true, signal, headers } = options;
  return new NextRequest("http://localhost/api/realtime/events", {
    headers: {
      ...(cookie ? { cookie: "auth_token=auth-token" } : {}),
      ...headers,
    },
    signal,
  });
}

function sseBody(chunks: string[] = ["event: ping\ndata: {}\n\n"]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** An upstream that stays open until its fetch signal aborts, like the real SSE endpoint. */
function openEndedUpstream(signal: AbortSignal): Response {
  return new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("GET /api/realtime/events", () => {
  beforeAll(() => {
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("caps the platform duration above the 50 s proxy deadline", () => {
    expect(maxDuration).toBe(60);
    expect(SSE_PROXY_TIMEOUT_MS).toBe(50_000);
  });

  it("returns 401 without an auth cookie and never calls the backend", async () => {
    const response = await GET(createRequest({ cookie: false }));

    expect(response.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the bearer token to the backend realtime endpoint and streams the body through", async () => {
    mockFetch.mockResolvedValue(new Response(
      sseBody(['event: entity-changed\ndata: {"entities":["client"]}\n\n']),
      { status: 200 },
    ));

    const response = await GET(createRequest({ headers: { "Last-Event-ID": "42" } }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/realtime\/events$/);
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer auth-token");
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Last-Event-ID")).toBe("42");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    await expect(response.text()).resolves.toBe('event: entity-changed\ndata: {"entities":["client"]}\n\n');
  });

  it("preserves the upstream status when the backend rejects the stream", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "tenant blocked" }), { status: 403 }));

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("answers a transport failure with an SSE error rather than throwing", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const response = await GET(createRequest());

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect((await response.text()).startsWith("event: error\ndata: ")).toBe(true);
  });

  it("aborts the upstream at the 50 s deadline and ends the browser stream cleanly", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    let upstreamSignal!: AbortSignal;
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return openEndedUpstream(upstreamSignal);
    });

    const response = await GET(createRequest());
    const body = response.text();
    expect(upstreamSignal.aborted).toBe(false);

    jest.advanceTimersByTime(SSE_PROXY_TIMEOUT_MS - 1);
    expect(upstreamSignal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(upstreamSignal.aborted).toBe(true);
    await expect(body).resolves.toBe("");
  });

  it("aborts the upstream when the browser disconnects", async () => {
    const controller = new AbortController();
    let upstreamSignal!: AbortSignal;
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return openEndedUpstream(upstreamSignal);
    });

    const response = await GET(createRequest({ signal: controller.signal }));
    const body = response.text();
    expect(upstreamSignal.aborted).toBe(false);

    controller.abort();

    expect(upstreamSignal.aborted).toBe(true);
    await expect(body).resolves.toBe("");
  });
});
