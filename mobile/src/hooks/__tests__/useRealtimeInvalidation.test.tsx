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

const IDENTITY = "user-1:branch-1";

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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
    await flushConnection();

    expect(mockOpenAuthenticatedEventSource).toHaveBeenCalledWith(
      "/api/realtime/events",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does not connect without an identity (logged out)", async () => {
    renderHook(() => useRealtimeInvalidation(null), { wrapper });
    await flushConnection();

    expect(mockOpenAuthenticatedEventSource).not.toHaveBeenCalled();
  });

  it("invalidates the roots of the changed kinds now and again after 1500 ms", async () => {
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
    await flushConnection();
    expect(MockEventSource.instances).toHaveLength(0);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await flushConnection();

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("reconnects when no ping arrives for 70 s, and pings keep it alive", async () => {
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    const { unmount } = renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
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
    const { unmount } = renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
    unmount();

    const late = new MockEventSource("/api/realtime/events");
    await act(async () => {
      resolveOpen(late as unknown as EventSource);
      await Promise.resolve();
    });

    expect(late.closed).toBe(true);
  });

  describe("bootstrap that never settles", () => {
    function pendingOpeners() {
      const attempts: {
        signal: AbortSignal;
        resolve: (source: EventSource) => void;
        reject: (error: unknown) => void;
      }[] = [];
      mockOpenAuthenticatedEventSource.mockImplementation(
        (_url, options) => new Promise<EventSource>((resolve, reject) => {
          attempts.push({ signal: options?.signal as AbortSignal, resolve, reject });
        }),
      );
      return attempts;
    }

    it("aborts the stalled attempt after the bootstrap bound and retries on the normal 3 s delay", async () => {
      const attempts = pendingOpeners();
      renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
      await flushConnection();
      expect(attempts).toHaveLength(1);

      act(() => {
        jest.advanceTimersByTime(19_999);
      });
      expect(attempts[0].signal.aborted).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(attempts[0].signal.aborted).toBe(true);
      expect(attempts).toHaveLength(1);

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      await flushConnection();
      expect(attempts).toHaveLength(2);
      expect(attempts[1].signal.aborted).toBe(false);
    });

    it("closes the source of an abandoned attempt that resolves late and keeps exactly one live source", async () => {
      const attempts = pendingOpeners();
      renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
      await flushConnection();

      act(() => {
        jest.advanceTimersByTime(20_000 + 3000);
      });
      await flushConnection();
      expect(attempts).toHaveLength(2);

      const stale = new MockEventSource("/api/realtime/events");
      const fresh = new MockEventSource("/api/realtime/events");
      await act(async () => {
        attempts[1].resolve(fresh as unknown as EventSource);
        await Promise.resolve();
      });
      await act(async () => {
        attempts[0].resolve(stale as unknown as EventSource);
        await Promise.resolve();
      });

      expect(stale.closed).toBe(true);
      expect(fresh.closed).toBe(false);
      act(() => {
        fresh.dispatch("entity-changed", JSON.stringify({ entities: ["employee"] }));
      });
      expect(invalidateSpy).toHaveBeenCalled();
      act(() => {
        stale.dispatch("entity-changed", JSON.stringify({ entities: ["client"] }));
      });
      expect(invalidatedRoots(invalidateSpy)).not.toContain(JSON.stringify(["clients"]));
    });

    it("ignores a retired attempt that rejects after its replacement is live", async () => {
      const attempts = pendingOpeners();
      const { unmount } = renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
      await flushConnection();

      // Attempt 1 stalls past the bound; attempt 2 replaces it and connects.
      act(() => {
        jest.advanceTimersByTime(20_000 + 3000);
      });
      await flushConnection();
      expect(attempts).toHaveLength(2);
      const replacement = new MockEventSource("/api/realtime/events");
      await act(async () => {
        attempts[1].resolve(replacement as unknown as EventSource);
        await Promise.resolve();
      });
      act(() => {
        replacement.dispatch("open");
      });

      // The abandoned refresh finally settles: the aborted opener rejects.
      await act(async () => {
        attempts[0].reject(new DOMException("aborted", "AbortError"));
        await Promise.resolve();
      });
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      await flushConnection();

      // The replacement is still the live handle: it keeps receiving events.
      expect(replacement.closed).toBe(false);
      act(() => {
        replacement.dispatch("entity-changed", JSON.stringify({ entities: ["employee"] }));
      });
      expect(invalidatedRoots(invalidateSpy)).toContain(JSON.stringify(["employees"]));

      // A visibility change with the stream open must not open a second source.
      act(() => {
        setVisibilityState("visible");
        jest.advanceTimersByTime(1);
      });
      await flushConnection();
      expect(attempts).toHaveLength(2);
      expect(replacement.closed).toBe(false);

      // And unmount closes the replacement: no live source survives.
      expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
      unmount();
      expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(0);
    });

    it("does not start an overlapping attempt when the tab becomes visible during a pending bootstrap", async () => {
      const attempts = pendingOpeners();
      renderHook(() => useRealtimeInvalidation(IDENTITY), { wrapper });
      await flushConnection();

      act(() => {
        setVisibilityState("visible");
        jest.advanceTimersByTime(1000);
      });
      await flushConnection();

      expect(attempts).toHaveLength(1);
      expect(attempts[0].signal.aborted).toBe(false);
    });
  });

  describe("subscription identity", () => {
    it("closes the old stream and opens exactly one new one when the user or branch changes", async () => {
      const { rerender } = renderHook(
        ({ identity }: { identity: string | null }) => useRealtimeInvalidation(identity),
        { wrapper, initialProps: { identity: "user-1:branch-A" } },
      );
      await flushConnection();
      const forA = latest();
      act(() => {
        forA.dispatch("open");
      });
      expect(invalidateSpy).not.toHaveBeenCalled();

      rerender({ identity: "user-1:branch-B" });
      await flushConnection();

      expect(forA.closed).toBe(true);
      expect(MockEventSource.instances).toHaveLength(2);
      const forB = latest();
      expect(forB.closed).toBe(false);

      // The cache still holds branch A's rows, so the first open refreshes everything.
      act(() => {
        forB.dispatch("open");
      });
      expect([...invalidatedRoots(invalidateSpy)].sort()).toEqual(
        allEntityQueryRoots().map((root) => JSON.stringify(root)).sort(),
      );
    });

    it("keeps the single source when it re-renders with an unchanged identity", async () => {
      const { rerender } = renderHook(
        ({ identity }: { identity: string | null }) => useRealtimeInvalidation(identity),
        { wrapper, initialProps: { identity: "user-1:branch-A" } },
      );
      await flushConnection();
      const first = latest();
      act(() => {
        first.dispatch("open");
      });

      rerender({ identity: "user-1:branch-A" });
      await flushConnection();

      expect(first.closed).toBe(false);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("closes the stream when the identity becomes null (logged out)", async () => {
      const { rerender } = renderHook(
        ({ identity }: { identity: string | null }) => useRealtimeInvalidation(identity),
        { wrapper, initialProps: { identity: "user-1:branch-A" as string | null } },
      );
      await flushConnection();
      const first = latest();

      rerender({ identity: null });
      await flushConnection();

      expect(first.closed).toBe(true);
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });
});
