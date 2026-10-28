import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { openAuthenticatedEventSource } from "@/lib/api/authenticated-fetch";
import { allEntityQueryRoots } from "@/lib/realtime/entity-query-keys";

import { useRealtimeInvalidation } from "../useRealtimeInvalidation";

jest.mock("@/lib/api/authenticated-fetch", () => ({
  openAuthenticatedEventSource: jest.fn(),
}));

const mockOpenAuthenticatedEventSource = jest.mocked(openAuthenticatedEventSource);

type EventSourceListener = (event: Event) => void;

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly url: string | URL;
  readyState: number = MockEventSource.CONNECTING;
  closed = false;
  private readonly listeners = new Map<string, Set<EventSourceListener>>();

  constructor(url: string | URL) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventSourceListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventSourceListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, data?: string) {
    if (type === "open") this.readyState = MockEventSource.OPEN;
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushConnection() {
  await act(async () => {
    await Promise.resolve();
  });
}

function invalidatedRoots(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));
}

describe("useRealtimeInvalidation", () => {
  const originalEventSource = globalThis.EventSource;
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const latest = () => MockEventSource.instances[MockEventSource.instances.length - 1];

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    mockOpenAuthenticatedEventSource.mockReset();
    mockOpenAuthenticatedEventSource.mockImplementation(
      async (url) => new MockEventSource(url) as unknown as EventSource,
    );
    queryClient = new QueryClient();
    invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.EventSource = originalEventSource;
  });

  it("opens the same-origin stream through the authenticated opener", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();

    expect(mockOpenAuthenticatedEventSource).toHaveBeenCalledWith(
      "/api/realtime/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does not connect while disabled (logged out)", async () => {
    renderHook(() => useRealtimeInvalidation(false), { wrapper });
    await flushConnection();

    expect(mockOpenAuthenticatedEventSource).not.toHaveBeenCalled();
  });

  it("invalidates the roots of the changed kinds now and again after 1500 ms", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();

    act(() => {
      latest().dispatch("open");
      latest().dispatch("entity-changed", JSON.stringify({ entities: ["employee"] }));
    });

    expect(invalidatedRoots(invalidateSpy)).toEqual([JSON.stringify(["employees"])]);

    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(invalidatedRoots(invalidateSpy)).toEqual([
      JSON.stringify(["employees"]),
      JSON.stringify(["employees"]),
    ]);

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("coalesces a burst into one follow-up over the union of its roots", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();

    act(() => {
      latest().dispatch("open");
      latest().dispatch("entity-changed", JSON.stringify({ entities: ["employee"] }));
    });
    act(() => {
      jest.advanceTimersByTime(1000);
      latest().dispatch("entity-changed", JSON.stringify({ entities: ["service-record"] }));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(invalidatedRoots(invalidateSpy).slice(2).sort()).toEqual([
      JSON.stringify(["employees"]),
      JSON.stringify(["service-records"]),
    ]);
  });

  it("ignores unknown kinds and malformed payloads", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();

    act(() => {
      latest().dispatch("open");
      latest().dispatch("entity-changed", JSON.stringify({ entities: ["voucher"] }));
      latest().dispatch("entity-changed", "garbage");
      jest.advanceTimersByTime(5000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("reconnects 3 s after an error and invalidates every mapped root once on re-open", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();

    const first = latest();
    act(() => {
      first.dispatch("open");
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      first.dispatch("error");
    });
    expect(first.closed).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    await flushConnection();
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      latest().dispatch("open");
    });
    expect([...invalidatedRoots(invalidateSpy)].sort()).toEqual(
      allEntityQueryRoots().map((root) => JSON.stringify(root)).sort(),
    );
    expect(invalidateSpy.mock.calls.every(([filters]) => (
      Object.keys(filters as object).join() === "queryKey"
    ))).toBe(true);
  });

  it("retries after the authenticated opener fails", async () => {
    mockOpenAuthenticatedEventSource.mockRejectedValueOnce(new Error("session expired"));
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();
    expect(MockEventSource.instances).toHaveLength(0);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await flushConnection();

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("reconnects when no ping arrives for 70 s, and pings keep it alive", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();
    const first = latest();
    act(() => {
      first.dispatch("open");
    });

    act(() => {
      jest.advanceTimersByTime(60_000);
      first.dispatch("ping", JSON.stringify({ at: 1 }));
      jest.advanceTimersByTime(60_000);
    });
    expect(first.closed).toBe(false);

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(first.closed).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    await flushConnection();
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("reconnects immediately when the tab becomes visible and the stream is not open", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();
    const first = latest();
    act(() => {
      first.dispatch("open");
      first.readyState = MockEventSource.CLOSED;
    });

    act(() => {
      setVisibilityState("visible");
      jest.advanceTimersByTime(1);
    });
    await flushConnection();

    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("keeps an open stream when the tab becomes visible", async () => {
    renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();
    act(() => {
      latest().dispatch("open");
    });

    act(() => {
      setVisibilityState("visible");
      jest.advanceTimersByTime(1);
    });
    await flushConnection();

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("closes the stream and cancels pending timers on unmount", async () => {
    const { unmount } = renderHook(() => useRealtimeInvalidation(true), { wrapper });
    await flushConnection();
    const source = latest();
    act(() => {
      source.dispatch("open");
      source.dispatch("entity-changed", JSON.stringify({ entities: ["client"] }));
    });
    const callsBeforeUnmount = invalidateSpy.mock.calls.length;

    unmount();
    act(() => {
      jest.advanceTimersByTime(200_000);
    });

    expect(source.closed).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledTimes(callsBeforeUnmount);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("closes a stream that finishes opening after unmount", async () => {
    let resolveOpen!: (source: EventSource) => void;
    mockOpenAuthenticatedEventSource.mockImplementationOnce(
      () => new Promise<EventSource>((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const { unmount } = renderHook(() => useRealtimeInvalidation(true), { wrapper });
    unmount();

    const late = new MockEventSource("/api/realtime/events");
    await act(async () => {
      resolveOpen(late as unknown as EventSource);
      await Promise.resolve();
    });

    expect(late.closed).toBe(true);
  });
});
