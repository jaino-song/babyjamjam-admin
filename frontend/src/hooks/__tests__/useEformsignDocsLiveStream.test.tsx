import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEformsignDocsLiveStream } from "../useEformsignDocsLiveStream";

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

describe("useEformsignDocsLiveStream", () => {
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mountStream = (enabled = true) =>
    renderHook(() => useEformsignDocsLiveStream(enabled), { wrapper });

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
    queryClient = new QueryClient();
    invalidateSpy = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (global as unknown as { EventSource?: unknown }).EventSource;
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

  test("reconnects once after an error; old source closed, exactly one new source", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => {
      first.emit("error");
      first.emit("error"); // rapid second error must NOT spawn a second reconnect
    });
    expect(MockEventSource.instances).toHaveLength(1); // reconnect is delayed

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
  });

  test("reconnects when no heartbeat/data arrives within the timeout", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => {
      jest.advanceTimersByTime(70_000); // heartbeat watchdog fires
      jest.advanceTimersByTime(1); // run the immediate reconnect
    });
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

  test("reconnects immediately when tab becomes visible and stream is not open", () => {
    mountStream();
    // first instance is never opened → readyState stays CONNECTING
    act(() => {
      setVisibility("visible");
      jest.advanceTimersByTime(1);
    });
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

  test("catch-up invalidate fires only on reopen, not the initial open", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    expect(invalidateSpy).not.toHaveBeenCalled(); // initial open: no catch-up

    act(() => {
      first.emit("error");
      jest.advanceTimersByTime(3000);
    });
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
});
