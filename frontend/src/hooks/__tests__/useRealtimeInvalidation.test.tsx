import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useRealtimeInvalidation } from "../useRealtimeInvalidation";

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

const ENDPOINT = "/api/realtime/events";

describe("useRealtimeInvalidation", () => {
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mountStream = (enabled = true) =>
    renderHook(() => useRealtimeInvalidation(enabled), { wrapper });

  const invalidatedKeys = () =>
    invalidateSpy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey[0]);

  const emitEntityChanged = (source: MockEventSource, entities: unknown) =>
    act(() => source.emit("entity-changed", { entities }));

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

  test("opens a single EventSource to the realtime endpoint when enabled", () => {
    mountStream(true);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(ENDPOINT);
  });

  test("does not connect when disabled", () => {
    mountStream(false);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  test("invalidates only the roots of the received kinds on entity-changed", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["employee"]);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["employees"] });
    expect(invalidatedKeys()).toEqual(["employees"]);
  });

  test("invalidates the union of roots when several kinds arrive together", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["client", "message"]);

    expect(invalidatedKeys()).toEqual(["clients", "dashboard", "message-triggers"]);
  });

  test("ignores unknown kinds and malformed payloads without invalidating or scheduling a refresh", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["voucher"]);
    act(() => source.emit("entity-changed", "not json"));
    act(() => source.emit("entity-changed", { entities: "client" }));
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("refreshes again 1500 ms after an event", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["service-record"]);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidatedKeys()).toEqual(["service-records", "service-records"]);
  });

  test("coalesces events inside the window into one trailing refresh covering the union", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["employee"]);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    emitEntityChanged(source, ["message"]);
    expect(invalidatedKeys()).toEqual(["employees", "message-triggers"]);

    // The first event's timer fires at +1500 ms and covers both kinds; no second timer.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(invalidatedKeys()).toEqual([
      "employees",
      "message-triggers",
      "employees",
      "message-triggers",
    ]);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
  });

  test("a new event after the trailing refresh starts a fresh window", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["employee"]);
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    emitEntityChanged(source, ["message"]);
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // The second window must not replay the first window's kind.
    expect(invalidatedKeys()).toEqual([
      "employees",
      "employees",
      "message-triggers",
      "message-triggers",
    ]);
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
      jest.advanceTimersByTime(69_999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1); // watchdog fires
      jest.advanceTimersByTime(1); // run the immediate reconnect
    });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
  });

  test("a ping keeps the watchdog from firing", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    act(() => {
      jest.advanceTimersByTime(60_000);
      first.emit("ping", { at: 1 });
      jest.advanceTimersByTime(60_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  test("does not invalidate on the first open, but invalidates every root once on a re-open", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      first.emit("error");
      jest.advanceTimersByTime(3000);
    });
    const second = MockEventSource.instances[1];
    act(() => second.fireOpen());

    const keys = invalidatedKeys();
    expect([...keys].sort()).toEqual(
      [
        "clients",
        "dashboard",
        "eformsign-client-names",
        "eformsign-docs",
        "eformsign-document-jobs",
        "eformsign-documents",
        "eformsign-status-counts",
        "employees",
        "message-triggers",
        "service-records",
      ].sort(),
    );
    // Never an unfiltered invalidate.
    expect(invalidateSpy.mock.calls.every(([filters]) => Boolean(filters?.queryKey))).toBe(true);
  });

  test("reconnects when the tab becomes visible while the stream is not open", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    // never opened: readyState stays CONNECTING

    act(() => setVisibility("visible"));
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
  });

  test("does not reconnect on visibility change while the stream is open", () => {
    mountStream();
    act(() => MockEventSource.instances[0].fireOpen());

    act(() => setVisibility("visible"));
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(MockEventSource.instances).toHaveLength(1);
  });

  test("re-subscribes immediately when the identity changes: old source closed, exactly one new source", () => {
    const { rerender } = renderHook(
      ({ identity }: { identity: string }) => useRealtimeInvalidation(true, identity),
      { wrapper, initialProps: { identity: "user-1:branch-a" } },
    );
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    expect(MockEventSource.instances).toHaveLength(1);

    rerender({ identity: "user-1:branch-b" });

    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].closed).toBe(false);
    expect(MockEventSource.instances[1].url).toBe(ENDPOINT);
  });

  test("keeps the same source when re-rendered with an unchanged identity", () => {
    const { rerender } = renderHook(
      ({ identity }: { identity: string }) => useRealtimeInvalidation(true, identity),
      { wrapper, initialProps: { identity: "user-1:branch-a" } },
    );
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    rerender({ identity: "user-1:branch-a" });
    rerender({ identity: "user-1:branch-a" });

    expect(first.closed).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  test("events from the previous identity's source no longer invalidate after a switch", () => {
    const { rerender } = renderHook(
      ({ identity }: { identity: string }) => useRealtimeInvalidation(true, identity),
      { wrapper, initialProps: { identity: "user-1:branch-a" } },
    );
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    rerender({ identity: "user-1:branch-b" });
    const second = MockEventSource.instances[1];
    act(() => second.fireOpen());

    emitEntityChanged(first, ["employee"]);
    expect(invalidateSpy).not.toHaveBeenCalled();

    emitEntityChanged(second, ["employee"]);
    expect(invalidatedKeys()).toEqual(["employees"]);
  });

  test("closes the source and clears every timer on unmount", () => {
    const { unmount } = mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());
    emitEntityChanged(source, ["client"]); // arms the trailing timer
    const callsBeforeUnmount = invalidateSpy.mock.calls.length;

    unmount();

    expect(source.closed).toBe(true);
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(callsBeforeUnmount);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("ignores events from a source that has been replaced", () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => {
      first.fireOpen();
      first.emit("error");
      jest.advanceTimersByTime(3000);
    });
    invalidateSpy.mockClear();

    emitEntityChanged(first, ["employee"]);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
