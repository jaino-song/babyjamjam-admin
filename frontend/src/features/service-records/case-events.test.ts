import { subscribeServiceRecordCaseChanges } from "./case-events";

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    readonly url: string;
    closed = false;
    private readonly listeners = new Map<string, Set<(event: Event) => void>>();

    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: (event: Event) => void) {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: (event: Event) => void) {
        this.listeners.get(type)?.delete(listener);
    }

    close() {
        this.closed = true;
    }

    emit(type: string, data: unknown) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent);
    }
}

describe("service-record case change subscription", () => {
    const originalEventSource = globalThis.EventSource;

    beforeEach(() => {
        FakeEventSource.instances = [];
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: FakeEventSource,
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: originalEventSource,
        });
    });

    it("opens the events proxy and delivers case-changed payloads", () => {
        const listener = jest.fn();
        subscribeServiceRecordCaseChanges(listener);

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].url).toBe("/api/admin/service-records/events");

        FakeEventSource.instances[0].emit("case-changed", JSON.stringify({ clientId: 42, caseId: "case-1", caseVersion: 3 }));

        expect(listener).toHaveBeenCalledWith({ caseId: "case-1", caseVersion: 3 });
    });

    it("ignores other event types and malformed payloads", () => {
        const listener = jest.fn();
        subscribeServiceRecordCaseChanges(listener);
        const source = FakeEventSource.instances[0];

        source.emit("ping", JSON.stringify({ caseId: "case-1", caseVersion: 3 }));
        source.emit("case-changed", "not json");
        source.emit("case-changed", JSON.stringify({ caseId: "", caseVersion: 3 }));
        source.emit("case-changed", JSON.stringify({ caseId: "case-1", caseVersion: "3" }));
        source.emit("case-changed", JSON.stringify({ caseId: "case-1", caseVersion: -1 }));
        source.emit("case-changed", JSON.stringify([]));

        expect(listener).not.toHaveBeenCalled();
    });

    it("stops delivering and closes the stream on unsubscribe", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeServiceRecordCaseChanges(listener);
        const source = FakeEventSource.instances[0];

        unsubscribe();
        source.emit("case-changed", JSON.stringify({ caseId: "case-1", caseVersion: 4 }));

        expect(source.closed).toBe(true);
        expect(listener).not.toHaveBeenCalled();
    });

    it("is a no-op when EventSource is unavailable", () => {
        Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: undefined });

        const unsubscribe = subscribeServiceRecordCaseChanges(jest.fn());

        expect(FakeEventSource.instances).toHaveLength(0);
        expect(() => unsubscribe()).not.toThrow();
    });
});
