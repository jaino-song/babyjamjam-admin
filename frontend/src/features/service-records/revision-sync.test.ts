import {
    publishServiceRecordRevisionSync,
    SERVICE_RECORD_REVISION_SYNC_CHANNEL,
    subscribeServiceRecordRevisionSync,
} from "./revision-sync";

class FakeBroadcastChannel {
    static channels = new Map<string, Set<FakeBroadcastChannel>>();
    readonly name: string;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

    constructor(name: string) {
        this.name = name;
        const peers = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
        peers.add(this);
        FakeBroadcastChannel.channels.set(name, peers);
    }

    addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        this.listeners.add(listener);
    }

    removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        this.listeners.delete(listener);
    }

    postMessage(data: unknown) {
        for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
            if (peer === this) continue;
            const event = { data } as MessageEvent<unknown>;
            peer.onmessage?.(event);
            for (const listener of peer.listeners) listener(event);
        }
    }

    close() {
        FakeBroadcastChannel.channels.get(this.name)?.delete(this);
    }
}

describe("service-record revision sync", () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;

    beforeEach(() => {
        Object.defineProperty(globalThis, "BroadcastChannel", {
            configurable: true,
            writable: true,
            value: FakeBroadcastChannel,
        });
        FakeBroadcastChannel.channels.clear();
    });

    afterAll(() => {
        Object.defineProperty(globalThis, "BroadcastChannel", {
            configurable: true,
            writable: true,
            value: originalBroadcastChannel,
        });
    });

    it("delivers only validated confirmation events to same-origin listeners", () => {
        const received: unknown[] = [];
        const unsubscribe = subscribeServiceRecordRevisionSync((event) => received.push(event));

        publishServiceRecordRevisionSync({ caseId: "case-1", caseVersion: 3 });
        expect(received).toEqual([{ caseId: "case-1", caseVersion: 3 }]);
        expect(SERVICE_RECORD_REVISION_SYNC_CHANNEL).toBe("babyjamjam:service-record-revision");

        unsubscribe();
        publishServiceRecordRevisionSync({ caseId: "case-2", caseVersion: 4 });
        expect(received).toHaveLength(1);
    });
});
