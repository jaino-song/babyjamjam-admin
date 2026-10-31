import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { allQueryKeyRoots, queryKeyRootsForKinds } from "@/lib/realtime/entity-query-keys";

import { useRealtimeInvalidation } from "../useRealtimeInvalidation";

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

describe("useRealtimeInvalidation", () => {
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
    renderHook(() => useRealtimeInvalidation(enabled), { wrapper });

  const invalidatedKeys = () =>
    invalidateSpy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey[0]);

  // First segment of each root the map assigns to these kinds, in invalidation order.
  const rootNames = (kinds: string[]) => queryKeyRootsForKinds(kinds).map((root) => root[0]);

  const emitEntityChanged = (source: MockEventSource, entities: unknown) =>
    act(() => source.emit("entity-changed", { entities }));

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
    expect(invalidatedKeys()).toEqual(rootNames(["employee"]));
  });

  test("invalidates the union of roots when several kinds arrive together", () => {
    mountStream();
    const source = MockEventSource.instances[0];
    act(() => source.fireOpen());

    emitEntityChanged(source, ["client", "message"]);

    expect(invalidatedKeys()).toEqual(rootNames(["client", "message"]));
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
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(invalidatedKeys()).toEqual(["service-records", "employees", "service-records", "employees"]);
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
    const firstWindow = rootNames(["employee", "message"]);
    // Both kinds have fired immediately: employee's roots, then message's not already seen.
    expect(invalidatedKeys()).toEqual([...rootNames(["employee"]), ...rootNames(["message"])]);

    // The first event's timer fires at +1500 ms and covers both kinds; no second timer.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(invalidatedKeys().slice(-firstWindow.length)).toEqual(firstWindow);
    // Two immediate invalidations plus one trailing refresh of the union.
    const expectedCalls =
      rootNames(["employee"]).length + rootNames(["message"]).length + firstWindow.length;
    expect(invalidateSpy).toHaveBeenCalledTimes(expectedCalls);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(expectedCalls);
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
      ...rootNames(["employee"]),
      ...rootNames(["employee"]),
      ...rootNames(["message"]),
      ...rootNames(["message"]),
    ]);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("reconnects when no heartbeat/data arrives within the timeout", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());

    await advance(69_999);
    expect(MockEventSource.instances).toHaveLength(1);

    await advance(1); // watchdog fires
    await advance(1); // run the immediate reconnect
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

  test("does not invalidate on the first open, but invalidates every root once on a re-open", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => first.fireOpen());
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => first.emit("error"));
    await advance(3000);
    const second = MockEventSource.instances[1];
    act(() => second.fireOpen());

    expect(invalidatedKeys()).toEqual(allQueryKeyRoots().map((root) => root[0]));
    // Never an unfiltered invalidate.
    expect(invalidateSpy.mock.calls.every(([filters]) => Boolean(filters?.queryKey))).toBe(true);
  });

  test("reconnects when the tab becomes visible while the stream is not open", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    // never opened: readyState stays CONNECTING

    act(() => setVisibility("visible"));
    await advance(1);

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
    expect(invalidatedKeys()).toEqual(rootNames(["employee"]));
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

  test("ignores events from a source that has been replaced", async () => {
    mountStream();
    const first = MockEventSource.instances[0];
    act(() => {
      first.fireOpen();
      first.emit("error");
    });
    await advance(3000);
    invalidateSpy.mockClear();

    emitEntityChanged(first, ["employee"]);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  describe("authenticated reconnect", () => {
    // Drive one error → reconnect cycle and return the source it produced.
    const errorAndReconnect = async (from: MockEventSource, delayMs = 3000) => {
      act(() => from.emit("error"));
      await advance(delayMs);
      return MockEventSource.instances[MockEventSource.instances.length - 1];
    };

    test("the first connect is a direct EventSource: no probe, no refresh", () => {
      mountStream();

      expect(MockEventSource.instances).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockRefreshAppAuthSession).not.toHaveBeenCalled();
    });

    test("a reconnect probes /api/auth/me first and refreshes nothing while the session is valid", async () => {
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      const second = await errorAndReconnect(first);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
      expect(mockRefreshAppAuthSession).not.toHaveBeenCalled();
      expect(second).not.toBe(first);
      expect(second.url).toBe(ENDPOINT);
    });

    test("an expired access token (probe 401) triggers exactly one refresh, then the stream reopens", async () => {
      probeResults(401, 200);
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      const second = await errorAndReconnect(first);

      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2); // probe → refresh → re-probe
      expect(MockEventSource.instances).toHaveLength(2);
      expect(second.closed).toBe(false);
      expect(mockRedirectToLoginOnce).not.toHaveBeenCalled();
    });

    test("a refresh that waits out AUTH_REFRESH_REPLAY_CONCURRENT still reopens the stream", async () => {
      probeResults(401, 200);
      // refreshAppAuthSession resolves after its 409 wait-and-retry; model that delay.
      mockRefreshAppAuthSession.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      );
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      act(() => first.emit("error"));
      await advance(3000);
      expect(MockEventSource.instances).toHaveLength(1); // still waiting on the other tab's rotation

      await advance(1000);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
    });

    test("an error whose probe is already 200 (another path refreshed) reconnects without a refresh", async () => {
      probeResults(200);
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

      // Nothing revives it: not time, not the watchdog, not a tab switch.
      await advance(300_000);
      act(() => setVisibility("visible"));
      await advance(300_000);

      expect(MockEventSource.instances).toHaveLength(1);
      expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
      expect(mockRedirectToLoginOnce).toHaveBeenCalledTimes(1);
    });

    test("a refresh rejected with 403 stops reconnecting and sends the user to login once", async () => {
      probeResults(401);
      mockRefreshAppAuthSession.mockRejectedValue(
        Object.assign(new Error("403"), { response: { status: 403, data: { code: "ACCOUNT_REJECTED" } } }),
      );
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

    test("a probe that is still 401 after a successful refresh ends the session too", async () => {
      probeResults(401, 401);
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      await errorAndReconnect(first);
      await advance(300_000);

      expect(mockRedirectToLoginOnce).toHaveBeenCalledTimes(1);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    test("a transient refresh failure (502/network) retries instead of logging out", async () => {
      probeResults(401);
      mockRefreshAppAuthSession.mockRejectedValueOnce(
        Object.assign(new Error("bad gateway"), { response: { status: 502 } }),
      );
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      await errorAndReconnect(first);
      expect(mockRedirectToLoginOnce).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(1);

      await advance(6000); // second attempt, backed off to 6 s
      expect(MockEventSource.instances).toHaveLength(2);
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
        expect(fetchMock.mock.calls.length).toBe(before); // not yet
        await advance(1);
        expect(fetchMock.mock.calls.length).toBe(before + 1); // exactly at the delay
      }
      expect(MockEventSource.instances).toHaveLength(1);

      // Network is back: the next attempt opens a source, but backoff only resets on `open`.
      fetchMock.mockResolvedValue({ status: 200 });
      await advance(60_000);
      const reopened = MockEventSource.instances[1];
      expect(reopened).toBeDefined();

      // It errors without ever opening, so the failure run (and its 60 s cap) continues.
      act(() => reopened.emit("error"));
      let before = fetchMock.mock.calls.length;
      await advance(59_999);
      expect(fetchMock.mock.calls.length).toBe(before);
      await advance(1);
      expect(fetchMock.mock.calls.length).toBe(before + 1);

      const third = MockEventSource.instances[2];
      act(() => third.fireOpen());
      act(() => third.emit("error"));
      before = fetchMock.mock.calls.length;
      await advance(2999);
      expect(fetchMock.mock.calls.length).toBe(before);
      await advance(1);
      expect(fetchMock.mock.calls.length).toBe(before + 1); // back to 3 s
    });

    test("immediate reconnects (watchdog) skip the delay and do not grow the backoff", async () => {
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());

      await advance(70_000); // watchdog → immediate reconnect, no wait
      await advance(1);
      const second = MockEventSource.instances[1];
      expect(second).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The source never opens, so the backoff is still at its base after a real error.
      act(() => second.emit("error"));
      const before = fetchMock.mock.calls.length;
      await advance(2999);
      expect(fetchMock.mock.calls.length).toBe(before);
      await advance(1);
      expect(fetchMock.mock.calls.length).toBe(before + 1);
    });

    test("a tab coming back pre-empts a long pending backoff delay", async () => {
      fetchMock.mockRejectedValue(new TypeError("network down"));
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      act(() => first.emit("error"));
      await advance(3000); // fails → next delay 6 s
      const before = fetchMock.mock.calls.length;

      fetchMock.mockResolvedValue({ status: 200 });
      act(() => setVisibility("visible"));
      await advance(1);

      expect(fetchMock.mock.calls.length).toBe(before + 1);
      expect(MockEventSource.instances).toHaveLength(2);
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
      expect(signal.aborted).toBe(false);

      unmount();
      expect(signal.aborted).toBe(true);
      resolveProbe({ status: 200 });
      await flush();
      await advance(120_000);

      expect(MockEventSource.instances).toHaveLength(1);
    });

    test("a probe still in flight when the identity changes never opens the old identity's stream", async () => {
      let resolveProbe: (value: { status: number }) => void = () => undefined;
      const { rerender } = renderHook(
        ({ identity }: { identity: string }) => useRealtimeInvalidation(true, identity),
        { wrapper, initialProps: { identity: "user-1:branch-a" } },
      );
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveProbe = resolve)));
      act(() => first.emit("error"));
      await advance(3000);

      rerender({ identity: "user-1:branch-b" });
      expect(MockEventSource.instances).toHaveLength(2); // the new identity's direct source
      resolveProbe({ status: 200 });
      await flush();
      await advance(5000);

      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].closed).toBe(false);
    });

    test("a change made while disconnected is reflected: the reopen invalidates every root", async () => {
      probeResults(401, 200);
      mountStream();
      const first = MockEventSource.instances[0];
      act(() => first.fireOpen());
      invalidateSpy.mockClear();

      const second = await errorAndReconnect(first);
      expect(invalidateSpy).not.toHaveBeenCalled(); // nothing until the stream is really back
      act(() => second.fireOpen());

      expect(invalidatedKeys()).toEqual(allQueryKeyRoots().map((root) => root[0]));
    });

    test("catches up on the reopen even when the first connection never opened", async () => {
      probeResults(401, 200);
      mountStream();
      const first = MockEventSource.instances[0]; // direct source that 401s before `open`

      const second = await errorAndReconnect(first);
      act(() => second.fireOpen());

      expect(invalidatedKeys()).toEqual(allQueryKeyRoots().map((root) => root[0]));
    });
  });
});
