/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { SSE_PROXY_TIMEOUT_MS } from "@/lib/realtime/sse-proxy";

import { GET, maxDuration } from "../route";

const mockFetch = jest.fn();
const originalFetch = global.fetch;

function createRequest(options: { cookie?: boolean; signal?: AbortSignal; headers?: Record<string, string>; search?: string } = {}): NextRequest {
  const { cookie = true, signal, headers, search = "" } = options;
  return new NextRequest(`http://localhost/api/realtime/events${search}`, {
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

  describe("resume cursor", () => {
    const upstreamUrlFor = async (search: string, headers?: Record<string, string>) => {
      mockFetch.mockResolvedValue(new Response(sseBody(), { status: 200 }));
      await GET(createRequest({ search, headers }));
      return mockFetch.mock.calls[0] as [string, RequestInit];
    };

    it("forwards a valid since as the backend query", async () => {
      const [url] = await upstreamUrlFor("?since=1730000000000-3");
      expect(url).toMatch(/\/realtime\/events\?since=1730000000000-3$/);
    });

    it("forwards an epoch:seq cursor", async () => {
      const [url] = await upstreamUrlFor(`?since=${encodeURIComponent("e1:42")}`);
      expect(url).toMatch(/\/realtime\/events\?since=e1%3A42$/);
    });

    it.each([
      ["empty", "?since="],
      ["with a space", "?since=a%20b"],
      ["too long", `?since=${"x".repeat(65)}`],
      ["with a slash", "?since=a%2Fb"],
      ["injecting a parameter", "?since=1%26admin%3D1"],
    ])("drops a since that is %s", async (_label, search) => {
      const [url] = await upstreamUrlFor(search);
      expect(url).toMatch(/\/realtime\/events$/);
    });

    it("still forwards Last-Event-ID next to since", async () => {
      const [url, init] = await upstreamUrlFor("?since=9-1", { "Last-Event-ID": "9-0" });
      expect(url).toMatch(/\/realtime\/events\?since=9-1$/);
      expect(new Headers(init.headers).get("Last-Event-ID")).toBe("9-0");
    });

    it("sends no query when there is no since", async () => {
      const [url] = await upstreamUrlFor("");
      expect(url).toMatch(/\/realtime\/events$/);
    });
  });

  it("passes only the upstream status when the backend rejects the stream, never its body", async () => {
    const marker = "검토전용기밀문구 처리 권한이 없습니다.";
    const cancel = jest.fn();
    const rejected = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: marker })));
      },
      cancel,
    });
    mockFetch.mockResolvedValue(new Response(rejected, { status: 403 }));

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.not.toContain(marker);
    expect(cancel).toHaveBeenCalledTimes(1);
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
