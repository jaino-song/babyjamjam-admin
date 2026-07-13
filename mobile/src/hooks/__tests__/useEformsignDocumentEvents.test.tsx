import { act, renderHook } from "@testing-library/react";

import { useEformsignDocumentEvents } from "../useEformsignDocumentEvents";

type EventSourceListener = (event: Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string | URL;
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
    const event = type === "docs-changed" ? new MessageEvent(type, { data }) : new Event(type);
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  close() {
    this.closed = true;
  }
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useEformsignDocumentEvents", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    jest.useRealTimers();
  });

  it("debounces docs-changed events and closes the stream on unmount", () => {
    const onDocsChanged = jest.fn();
    const { unmount } = renderHook(() =>
      useEformsignDocumentEvents({ enabled: true, onDocsChanged }),
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/eformsign-docs/events");

    act(() => {
      MockEventSource.instances[0]?.dispatch(
        "docs-changed",
        JSON.stringify({ documentId: "doc-1", reason: "doc:complete" }),
      );
      jest.advanceTimersByTime(299);
    });

    expect(onDocsChanged).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onDocsChanged).toHaveBeenCalledWith({
      documentId: "doc-1",
      reason: "doc:complete",
    });

    unmount();
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });

  it("suppresses duplicate docs-changed payloads while allowing distinct payloads", () => {
    const onDocsChanged = jest.fn();
    renderHook(() =>
      useEformsignDocumentEvents({ enabled: true, onDocsChanged }),
    );

    act(() => {
      MockEventSource.instances[0]?.dispatch(
        "docs-changed",
        JSON.stringify({ documentId: "doc-1", reason: "doc:complete" }),
      );
      jest.advanceTimersByTime(300);
    });

    expect(onDocsChanged).toHaveBeenCalledTimes(1);

    act(() => {
      MockEventSource.instances[0]?.dispatch(
        "docs-changed",
        JSON.stringify({ documentId: "doc-1", reason: "doc:complete" }),
      );
      jest.advanceTimersByTime(300);
    });

    expect(onDocsChanged).toHaveBeenCalledTimes(1);

    act(() => {
      MockEventSource.instances[0]?.dispatch(
        "docs-changed",
        JSON.stringify({ documentId: "doc-1", reason: "doc:archived" }),
      );
      jest.advanceTimersByTime(300);
    });

    expect(onDocsChanged).toHaveBeenCalledTimes(2);
    expect(onDocsChanged).toHaveBeenLastCalledWith({
      documentId: "doc-1",
      reason: "doc:archived",
    });
  });

  it("closes while hidden and reconnects when visible again", () => {
    renderHook(() =>
      useEformsignDocumentEvents({ enabled: true, onDocsChanged: jest.fn() }),
    );

    const firstSource = MockEventSource.instances[0];

    act(() => {
      setVisibilityState("hidden");
    });

    expect(firstSource?.closed).toBe(true);

    act(() => {
      setVisibilityState("visible");
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.closed).toBe(false);
  });

  it("uses controlled backoff after stream errors", () => {
    const { unmount } = renderHook(() =>
      useEformsignDocumentEvents({ enabled: true, onDocsChanged: jest.fn() }),
    );

    act(() => {
      MockEventSource.instances[0]?.dispatch("error");
      jest.advanceTimersByTime(29_999);
    });

    expect(MockEventSource.instances[0]?.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(MockEventSource.instances).toHaveLength(2);

    unmount();
    expect(MockEventSource.instances[1]?.closed).toBe(true);
  });

  it("does not open a stream when EventSource is unavailable", () => {
    globalThis.EventSource = undefined as unknown as typeof EventSource;

    renderHook(() =>
      useEformsignDocumentEvents({ enabled: true, onDocsChanged: jest.fn() }),
    );

    expect(MockEventSource.instances).toHaveLength(0);
  });
});
