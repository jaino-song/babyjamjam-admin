import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEformsignDocsLiveStream } from "../useEformsignDocsLiveStream";

const mockRefreshAppAuthSession = jest.fn<Promise<void>, []>();
const mockRedirectToLoginOnce = jest.fn<Promise<void>, []>();
jest.mock("@/lib/api/client", () => ({
  refreshAppAuthSession: () => mockRefreshAppAuthSession(),
  redirectToLoginOnce: () => mockRedirectToLoginOnce(),
}));

// jsdom has no EventSource — provide a controllable fake so we can drive
// open/message/error and inspect how many connections the hook opens.
type SseListener = (event: { type: string; data?: string }) => void;

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly url: string;
  readyState: number = MockEventSource.CONNECTING;
  closed = false;
  private readonly listeners = new Map<string, Set<SseListener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: SseListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: SseListener) {
    this.listeners.get(type)?.delete(cb);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }

  // --- test helpers ---
  emit(type: string, data?: unknown) {
    const event =
      type === "open"
        ? { type }
        : { type, data: typeof data === "string" ? data : JSON.stringify(data ?? {}) };
    this.listeners.get(type)?.forEach((cb) => cb(event as { type: string; data?: string }));
  }

  fireOpen() {
    this.readyState = MockEventSource.OPEN;
    this.emit("open");
  }
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const ENDPOINT = "/api/eformsign-docs/events";

// A reconnect goes through fetch + a session refresh before it constructs the
// EventSource; let those promise chains settle (timers stay fake).
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });

// Advance the fake clock, then let any reconnect probe it kicked off settle.
const advance = async (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
};

const unauthorizedRefresh = () => Object.assign(new Error("401"), { response: { status: 401 } });

describe("useEformsignDocsLiveStream", () => {
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  // Probe results in order; once exhausted every probe answers 200.
  const probeResults = (...statuses: number[]) => {
    for (const status of statuses) fetchMock.mockResolvedValueOnce({ status });
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mountStream = (enabled = true) =>
    renderHook(() => useEformsignDocsLiveStream(enabled), { wrapper });

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
    fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    mockRefreshAppAuthSession.mockReset().mockResolvedValue(undefined);
    mockRedirectToLoginOnce.mockReset().mockResolvedValue(undefined);
    queryClient = new QueryClient();
    invalidateSpy = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (global as unknown as { EventSource?: unknown }).EventSource;
    delete (global as unknown as { fetch?: unknown }).fetch;
    // Reset the visibility getter WITHOUT dispatching — dispatching here would
    // run a still-mounted hook's handler after EventSource has been removed.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  test("opens a single EventSource to the events endpoint when enabled", () => {
    mountStream(true);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(ENDPOINT);
  });

  test("does not connect when disabled", () => {
    mountStream(false);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  test("invalidates document + client-name caches on docs-changed", () => {
    mountStream();
    act(() => {
      MockEventSource.instances[0].fireOpen();
      MockEventSource.instances[0].emit("docs-changed", { documentId: "doc-1" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-documents"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-client-names"] });
  });

  test("reconnects once after an error; old source closed, exactly one new source", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => {
      first.emit("error");
      first.emit("error"); // rapid second error must NOT spawn a second reconnect
    });
    expect(MockEventSource.instances).toHaveLength(1); // reconnect is delayed

    await advance(3000);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
  });

  test("reconnects when no heartbeat/data arrives within the timeout", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    await advance(70_000); // heartbeat watchdog fires
    await advance(1); // run the immediate reconnect
    expect(MockEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
  });

  test("ping resets the heartbeat watchdog (no reconnect while pings flow)", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => {
      jest.advanceTimersByTime(60_000);
      first.emit("ping", { at: 1 });
      jest.advanceTimersByTime(60_000); // 60s since the ping → still under timeout
    });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(first.closed).toBe(false);
  });

  test("reconnects immediately when tab becomes visible and stream is not open", async () => {
    mountStream();
    // first instance is never opened → readyState stays CONNECTING
    act(() => setVisibility("visible"));
    await advance(1);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  test("does not reconnect on visibility when the stream is already open", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    act(() => {
      setVisibility("visible");
      jest.advanceTimersByTime(5000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  test("catch-up invalidate fires only on reopen, not the initial open", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    expect(invalidateSpy).not.toHaveBeenCalled(); // initial open: no catch-up

    act(() => first.emit("error"));
    await advance(3000);
    const second = MockEventSource.instances[1];
    act(() => second.fireOpen());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-documents"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-client-names"] });
  });

  test("cleans up on unmount: closes source and never reconnects afterwards", () => {
    const { unmount } = mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => unmount());
    expect(first.closed).toBe(true);

    act(() => {
      first.emit("error");
      jest.advanceTimersByTime(100_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  describe("authenticated reconnect", () => {
    const errorAndReconnect = async (from: MockEventSource, delayMs = 3000) => {
      act(() => from.emit("error"));
      await advance(delayMs);
      return MockEventSource.instances[MockEventSource.instances.length - 1];
    };

    test("the first connect is direct; a reconnect probes /api/auth/me and refreshes nothing while valid", async () => {
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      expect(fetchMock).not.toHaveBeenCalled();

      await errorAndReconnect(first);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
      expect(mockRefreshAppAuthSession).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].url).toBe(ENDPOINT);
    });

    test("an expired access token (probe 401) triggers exactly one refresh, then the stream reopens", async () => {
      probeResults(401, 200);
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      const second = await errorAndReconnect(first);

      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(second.closed).toBe(false);
      expect(mockRedirectToLoginOnce).not.toHaveBeenCalled();
    });

    test("a refresh that waits out AUTH_REFRESH_REPLAY_CONCURRENT still reopens the stream", async () => {
      probeResults(401, 200);
      mockRefreshAppAuthSession.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      );
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      act(() => first.emit("error"));
      await advance(3000);
      expect(MockEventSource.instances).toHaveLength(1);

      await advance(1000);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
    });

    test("an error whose probe is already 200 reconnects without a refresh", async () => {
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      await errorAndReconnect(first);

      expect(mockRefreshAppAuthSession).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(2);
    });

    test("a refresh rejected with 401 stops reconnecting and sends the user to login once", async () => {
      probeResults(401);
      mockRefreshAppAuthSession.mockRejectedValue(unauthorizedRefresh());
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      await errorAndReconnect(first);
      expect(mockRedirectToLoginOnce).toHaveBeenCalledTimes(1);

      await advance(300_000);
      act(() => setVisibility("visible"));
      await advance(300_000);

      expect(MockEventSource.instances).toHaveLength(1);
      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
      expect(mockRedirectToLoginOnce).toHaveBeenCalledTimes(1);
    });

    test("transient failures back off 3,6,12,24,48,60,60 s and only an open resets it to 3 s", async () => {
      fetchMock.mockRejectedValue(new TypeError("network down"));
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      act(() => first.emit("error"));

      for (const delay of [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000]) {
        const before = fetchMock.mock.calls.length;
        await advance(delay - 1);
        expect(fetchMock.mock.calls.length).toBe(before);
        await advance(1);
        expect(fetchMock.mock.calls.length).toBe(before + 1);
      }
      expect(MockEventSource.instances).toHaveLength(1);

      fetchMock.mockResolvedValue({ status: 200 });
      await advance(60_000);
      const reopened = MockEventSource.instances[1];
      expect(reopened).toBeDefined();

      act(() => reopened.fireOpen());
      act(() => reopened.emit("error"));
      const before = fetchMock.mock.calls.length;
      await advance(2999);
      expect(fetchMock.mock.calls.length).toBe(before);
      await advance(1);
      expect(fetchMock.mock.calls.length).toBe(before + 1); // back to 3 s
    });

    test("a probe still in flight when the hook unmounts never constructs an EventSource", async () => {
      let resolveProbe: (value: { status: number }) => void = () => undefined;
      const { unmount } = mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveProbe = resolve)));

      act(() => first.emit("error"));
      await advance(3000);
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;

      unmount();
      expect(signal.aborted).toBe(true);
      resolveProbe({ status: 200 });
      await flush();
      await advance(120_000);

      expect(MockEventSource.instances).toHaveLength(1);
    });

    test("a change made while disconnected is reflected: the reopen invalidates the document caches", async () => {
      probeResults(401, 200);
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      const second = await errorAndReconnect(first);
      expect(invalidateSpy).not.toHaveBeenCalled();
      act(() => second.fireOpen());

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-documents"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-client-names"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eformsign-status-counts"] });
    });
  });
});
