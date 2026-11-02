import { subscribeServiceRecordCaseChanges } from "./case-events";

const mockRefreshAppAuthSession = jest.fn<Promise<void>, []>();
const mockRedirectToLoginOnce = jest.fn<Promise<void>, []>();
jest.mock("@/lib/api/client", () => ({
    refreshAppAuthSession: () => mockRefreshAppAuthSession(),
    redirectToLoginOnce: () => mockRedirectToLoginOnce(),
}));

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    readonly url: string;
    closed = false;
    readyState = 0;
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

    emitError() {
        for (const listener of this.listeners.get("error") ?? []) listener({} as Event);
    }

    emitOpen() {
        for (const listener of this.listeners.get("open") ?? []) listener({} as Event);
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

    it("calls onOpen on the first open and again on every reconnect", () => {
        const onOpen = jest.fn();
        subscribeServiceRecordCaseChanges(jest.fn(), onOpen);
        const source = FakeEventSource.instances[0];

        source.emitOpen();
        expect(onOpen).toHaveBeenCalledTimes(1);

        source.emitOpen();
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it("stops calling onOpen after unsubscribe", () => {
        const onOpen = jest.fn();
        const unsubscribe = subscribeServiceRecordCaseChanges(jest.fn(), onOpen);
        const source = FakeEventSource.instances[0];

        unsubscribe();
        source.emitOpen();

        expect(onOpen).not.toHaveBeenCalled();
    });

    it("works without an onOpen callback", () => {
        const listener = jest.fn();
        subscribeServiceRecordCaseChanges(listener);
        const source = FakeEventSource.instances[0];

        expect(() => source.emitOpen()).not.toThrow();
        source.emit("case-changed", JSON.stringify({ caseId: "case-1", caseVersion: 2 }));
        expect(listener).toHaveBeenCalledWith({ caseId: "case-1", caseVersion: 2 });
    });

    it("is a no-op when EventSource is unavailable", () => {
        Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: undefined });

        const unsubscribe = subscribeServiceRecordCaseChanges(jest.fn());

        expect(FakeEventSource.instances).toHaveLength(0);
        expect(() => unsubscribe()).not.toThrow();
    });

    describe("reconnect after an error", () => {
        const flush = async () => {
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        };
        const advance = async (ms: number) => {
            jest.advanceTimersByTime(ms);
            await flush();
        };
        const unauthorizedRefresh = () => Object.assign(new Error("401"), { response: { status: 401 } });
        let fetchMock: jest.Mock;
        const originalFetch = globalThis.fetch;
        const probeResults = (...statuses: number[]) => {
            for (const status of statuses) fetchMock.mockResolvedValueOnce({ status });
        };

        beforeEach(() => {
            jest.useFakeTimers();
            fetchMock = jest.fn().mockResolvedValue({ status: 200 });
            globalThis.fetch = fetchMock as unknown as typeof fetch;
            mockRefreshAppAuthSession.mockReset().mockResolvedValue(undefined);
            mockRedirectToLoginOnce.mockReset().mockResolvedValue(undefined);
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
            globalThis.fetch = originalFetch;
        });

        it("closes the failed source, probes the session and reopens; onOpen catches up on the reopen", async () => {
            const onOpen = jest.fn();
            const listener = jest.fn();
            subscribeServiceRecordCaseChanges(listener, onOpen);
            const first = FakeEventSource.instances[0];
            first.emitOpen();
            expect(onOpen).toHaveBeenCalledTimes(1);
            expect(fetchMock).not.toHaveBeenCalled(); // first connect is direct

            first.emitError();
            expect(first.closed).toBe(true);
            expect(FakeEventSource.instances).toHaveLength(1); // delayed, not instant

            await advance(3000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
            expect(mockRefreshAppAuthSession).not.toHaveBeenCalled();
            expect(FakeEventSource.instances).toHaveLength(2);
            const second = FakeEventSource.instances[1];
            expect(second.url).toBe("/api/admin/service-records/events");

            second.emitOpen();
            expect(onOpen).toHaveBeenCalledTimes(2);
            second.emit("case-changed", JSON.stringify({ caseId: "case-1", caseVersion: 5 }));
            expect(listener).toHaveBeenCalledWith({ caseId: "case-1", caseVersion: 5 });
        });

        it("an expired access token (probe 401) triggers exactly one refresh before the reopen", async () => {
            probeResults(401, 200);
            subscribeServiceRecordCaseChanges(jest.fn());
            FakeEventSource.instances[0].emitError();

            await advance(3000);

            expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
            expect(FakeEventSource.instances).toHaveLength(2);
        });

        it("a refresh rejected with 401 stops reconnecting and sends the user to login once", async () => {
            probeResults(401);
            mockRefreshAppAuthSession.mockRejectedValue(unauthorizedRefresh());
            subscribeServiceRecordCaseChanges(jest.fn());
            FakeEventSource.instances[0].emitError();

            await advance(3000);
            await advance(300_000);

            expect(mockRedirectToLoginOnce).toHaveBeenCalledTimes(1);
            expect(FakeEventSource.instances).toHaveLength(1);
            expect(mockRefreshAppAuthSession).toHaveBeenCalledTimes(1);
        });

        it("backs off 3,6,12,24,48,60,60 s while failing and returns to 3 s only after an open", async () => {
            fetchMock.mockRejectedValue(new TypeError("network down"));
            subscribeServiceRecordCaseChanges(jest.fn());
            FakeEventSource.instances[0].emitError();

            for (const delay of [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000]) {
                const before = fetchMock.mock.calls.length;
                await advance(delay - 1);
                expect(fetchMock.mock.calls.length).toBe(before);
                await advance(1);
                expect(fetchMock.mock.calls.length).toBe(before + 1);
            }

            fetchMock.mockResolvedValue({ status: 200 });
            await advance(60_000);
            const reopened = FakeEventSource.instances[1];
            expect(reopened).toBeDefined();
            reopened.emitOpen();
            reopened.emitError();

            const before = fetchMock.mock.calls.length;
            await advance(2999);
            expect(fetchMock.mock.calls.length).toBe(before);
            await advance(1);
            expect(fetchMock.mock.calls.length).toBe(before + 1);
        });

        it("a probe still in flight when the subscriber unsubscribes never opens a source", async () => {
            let resolveProbe: (value: { status: number }) => void = () => undefined;
            const unsubscribe = subscribeServiceRecordCaseChanges(jest.fn());
            fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveProbe = resolve)));
            FakeEventSource.instances[0].emitError();
            await advance(3000);
            const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;

            unsubscribe();
            expect(signal.aborted).toBe(true);
            resolveProbe({ status: 200 });
            await flush();
            await advance(120_000);

            expect(FakeEventSource.instances).toHaveLength(1);
        });

        it("unsubscribing while a backoff delay is pending cancels the reconnect", async () => {
            const unsubscribe = subscribeServiceRecordCaseChanges(jest.fn());
            FakeEventSource.instances[0].emitError();

            unsubscribe();
            await advance(120_000);

            expect(fetchMock).not.toHaveBeenCalled();
            expect(FakeEventSource.instances).toHaveLength(1);
        });
    });
});
