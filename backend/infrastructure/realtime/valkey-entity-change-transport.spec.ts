import { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import type { Subscription } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

type Received = Array<MessageEvent & { id?: string }>;

const VALKEY_URL = (process.env["REALTIME_TEST_VALKEY_URL"] ?? process.env["VALKEY_URL"])?.trim();
const STREAM_CURSOR = /^\d+-\d+$/;
const RING_CURSOR = /^[0-9a-f]+:\d+$/;

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function instance(url: string, streamKey: string, extra: { maxLen?: number } = {}) {
    const bus = new EntityChangeEventBus(10);
    const transport = new ValkeyEntityChangeTransport(bus, { url, streamKey, retryDelayMs: 50, maxRetryDelayMs: 200, blockMs: 500, ...extra });
    const controller = new RealtimeController(bus, transport);
    const subscriptions: Subscription[] = [];
    const subscribe = (branchId: string, since?: string) => {
        const received: Received = [];
        subscriptions.push(controller.events({ branchId }, since).subscribe((e) => received.push(e)));
        return received;
    };
    const destroy = () => {
        subscriptions.forEach((s) => s.unsubscribe());
        transport.onModuleDestroy();
    };
    return { bus, transport, controller, subscribe, destroy };
}

const changes = (received: Received) => received.filter((e) => e.type === "entity-changed");

describe("ValkeyEntityChangeTransport without a reachable Valkey", () => {
    it("never blocks or throws on a write: batches reach local subscribers in-process, ids are ring cursors", async () => {
        const { bus, transport, subscribe, destroy } = instance("redis://127.0.0.1:1", `rt-test:${randomBytes(4).toString("hex")}`);
        try {
            const received = subscribe("branch-a");
            bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(received).length === 1, "the in-process delivery");

            expect(transport.activeMode).toBe("fallback");
            expect(received[0]).toMatchObject({ type: "ready", data: { resumed: false } });
            expect(changes(received)[0]).toMatchObject({ data: { entities: ["client"] } });
            expect(changes(received)[0]?.id).toMatch(RING_CURSOR);
        } finally {
            destroy();
        }
    });
});

const describeWithValkey = VALKEY_URL ? describe : describe.skip;
if (!VALKEY_URL) {
    console.warn("valkey-entity-change-transport integration tests skipped: set REALTIME_TEST_VALKEY_URL (or VALKEY_URL) to run them");
}

describeWithValkey("ValkeyEntityChangeTransport (integration, real Valkey)", () => {
    let admin: Redis;
    let streamKey: string;
    let a: ReturnType<typeof instance>;
    let b: ReturnType<typeof instance>;

    beforeAll(() => {
        admin = new Redis(VALKEY_URL as string, { maxRetriesPerRequest: 2 });
    });

    afterAll(async () => {
        admin.disconnect();
    });

    beforeEach(async () => {
        streamKey = `rt-test:${randomBytes(6).toString("hex")}`;
        a = instance(VALKEY_URL as string, streamKey);
        b = instance(VALKEY_URL as string, streamKey);
        await waitFor(() => a.transport.activeMode === "valkey" && b.transport.activeMode === "valkey", "both transports on the stream");
    });

    afterEach(async () => {
        a.destroy();
        b.destroy();
        await admin.del(streamKey);
    });

    it("an emit on A reaches the subscriber on A and the one on B exactly once, with the same stream-id cursor", async () => {
        const onA = a.subscribe("branch-a");
        const onB = b.subscribe("branch-a");

        a.bus.emit({ branchId: "branch-a", kind: "client" });
        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onA).length >= 1 && changes(onB).length >= 1, "delivery on both instances");
        await pause(300); // a duplicate, if there were one, would land by now

        expect(changes(onA)).toHaveLength(1);
        expect(changes(onB)).toHaveLength(1);
        expect(changes(onA)[0]?.data).toEqual({ entities: ["client", "message"] });
        expect(changes(onB)[0]?.data).toEqual({ entities: ["client", "message"] });
        expect(changes(onA)[0]?.id).toMatch(STREAM_CURSOR);
        expect(changes(onB)[0]?.id).toBe(changes(onA)[0]?.id);
        // The stream is the single source: one entry, not one per instance.
        expect(await admin.xlen(streamKey)).toBe(1);
    });

    it("a batch for another branch reaches only that branch's subscribers but advances every position", async () => {
        const branchA = b.subscribe("branch-a");
        const branchB = b.subscribe("branch-b");

        a.bus.emit({ branchId: "branch-b", kind: "employee" });
        await waitFor(() => changes(branchB).length === 1, "branch-b delivery");

        expect(changes(branchA)).toHaveLength(0);
        expect(changes(branchB)[0]?.data).toEqual({ entities: ["employee"] });
        expect(b.transport.position()).toBe(changes(branchB)[0]?.id);
    });

    async function seedOnA(): Promise<string[]> {
        const cursors: string[] = [];
        for (const [branchId, kind] of [["branch-a", "client"], ["branch-b", "employee"], [null, "settings"], ["branch-a", "document"]] as const) {
            a.bus.emit({ branchId, kind });
            await waitFor(() => b.transport.position() !== (cursors.at(-1) ?? "0-0") && b.transport.position() !== "0-0", "batch to land");
            cursors.push(b.transport.position());
            await pause(30);
        }
        return cursors;
    }

    it("replays from B the batches after a cursor that branch-a may see, in order, then continues live", async () => {
        const [first, , third, fourth] = await seedOnA();

        const replayed = b.subscribe("branch-a", first);
        await waitFor(() => changes(replayed).length === 2, "replay");

        expect(replayed[0]).toEqual({ id: first, type: "ready", data: { resumed: true } });
        expect(changes(replayed).map((e) => [e.id, e.data])).toEqual([
            [third, { entities: ["settings"] }],
            [fourth, { entities: ["document"] }],
        ]);

        a.bus.emit({ branchId: "branch-a", kind: "call" });
        await waitFor(() => changes(replayed).length === 3, "live batch after replay");
        expect(changes(replayed)).toHaveLength(3);
    });

    it("a position like 0-0 on a never-trimmed stream still resumes and replays everything", async () => {
        const cursors = await seedOnA();

        const replayed = b.subscribe("branch-a", "0-0");
        await waitFor(() => changes(replayed).length === 3, "full replay");

        expect(replayed[0]).toEqual({ id: "0-0", type: "ready", data: { resumed: true } });
        expect(changes(replayed).map((e) => e.id)).toEqual([cursors[0], cursors[2], cursors[3]]);
    });

    it("resuming from the newest cursor is honoured with an empty replay", async () => {
        const cursors = await seedOnA();

        const received = b.subscribe("branch-a", cursors.at(-1));
        await pause(150);

        expect(received).toEqual([{ id: cursors.at(-1), type: "ready", data: { resumed: true } }]);
    });

    it("after a trim, a cursor older than the oldest retained entry is not honoured, the oldest retained entry's own cursor is", async () => {
        const cursors = await seedOnA();
        await admin.xtrim(streamKey, "MAXLEN", 1); // keeps only the newest entry

        const expired = b.subscribe("branch-a", cursors[0]);
        const justBeforeOldest = b.subscribe("branch-a", cursors[2]);
        const atOldest = b.subscribe("branch-a", cursors[3]);
        await waitFor(() => expired.length >= 1 && justBeforeOldest.length >= 1 && atOldest.length >= 1, "ready messages");
        await pause(100);

        expect(expired).toEqual([{ id: b.transport.position(), type: "ready", data: { resumed: false } }]);
        // Its successor gap is invisible once trimmed, so the safe answer is "not honoured".
        expect(justBeforeOldest[0]?.data).toEqual({ resumed: false });
        expect(atOldest).toEqual([{ id: cursors[3], type: "ready", data: { resumed: true } }]);
    });

    it("a stream trimmed to nothing honours only its newest id", async () => {
        const cursors = await seedOnA();
        await admin.xtrim(streamKey, "MAXLEN", 0);

        const older = b.subscribe("branch-a", cursors[2]);
        const newest = b.subscribe("branch-a", cursors[3]);
        const origin = b.subscribe("branch-a", "0-0");
        await waitFor(() => older.length >= 1 && newest.length >= 1 && origin.length >= 1, "ready messages");

        expect(older[0]?.data).toEqual({ resumed: false });
        expect(origin[0]?.data).toEqual({ resumed: false });
        expect(newest[0]?.data).toEqual({ resumed: true });
    });

    it("a cursor from the future of the stream, a ring cursor and a malformed one are not honoured", async () => {
        await seedOnA();

        const future = b.subscribe("branch-a", "99999999999999-0");
        const ring = b.subscribe("branch-a", "abcdef012345:1");
        await waitFor(() => future.length >= 1 && ring.length >= 1, "ready messages");

        expect(future[0]?.data).toEqual({ resumed: false });
        expect(ring[0]?.data).toEqual({ resumed: false });
    });

    it("a fresh connect starts at the reader's position, which is the stream's newest id", async () => {
        const cursors = await seedOnA();

        const fresh = b.subscribe("branch-a");

        expect(fresh).toEqual([{ id: cursors.at(-1), type: "ready", data: { resumed: false } }]);
    });

    it("a transport that starts after entries exist begins at the newest id, not at the origin", async () => {
        const cursors = await seedOnA();
        const late = instance(VALKEY_URL as string, streamKey);
        try {
            await waitFor(() => late.transport.activeMode === "valkey", "late transport on the stream");

            expect(late.transport.position()).toBe(cursors.at(-1));
        } finally {
            late.destroy();
        }
    });

    it("reader reconnects after its connection drops: connections get a reset, then batches flow again", async () => {
        const onB = b.subscribe("branch-a");
        a.bus.emit({ branchId: "branch-a", kind: "client" });
        await waitFor(() => changes(onB).length === 1, "delivery before the drop");

        await admin.call("CLIENT", "KILL", "TYPE", "normal", "SKIPME", "yes"); // drops every transport connection
        const resets = () => onB.filter((e) => e.type === "reset");
        await waitFor(() => resets().length >= 2, "a reset on loss and another on recovery");
        await waitFor(() => a.transport.activeMode === "valkey" && b.transport.activeMode === "valkey", "both back on the stream");

        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onB).length === 2, "delivery after the recovery");
        expect(changes(onB)[1]?.data).toEqual({ entities: ["message"] });
        expect(changes(onB)[1]?.id).toMatch(STREAM_CURSOR);
        expect(resets()[0]?.data).toEqual({});
    });

    it("an XADD that fails during an outage still reaches local subscribers, then resets, and the stream path resumes", async () => {
        const onA = a.subscribe("branch-a");
        const onB = b.subscribe("branch-a");
        // Drop A's publishing connection and write straight away, before it has reconnected.
        (a.transport as unknown as { publisher: Redis }).publisher.disconnect(true);

        a.bus.emit({ branchId: "branch-a", kind: "client" });
        await waitFor(() => changes(onA).length === 1, "local delivery of the unpublished batch");

        expect(changes(onA)[0]?.id).toMatch(RING_CURSOR);
        expect(onA.some((e) => e.type === "reset")).toBe(true);
        expect(changes(onB)).toHaveLength(0); // never reached the stream, so B cannot have it

        await waitFor(() => a.transport.activeMode === "valkey", "A back on the stream");
        expect(onA.filter((e) => e.type === "reset").length).toBeGreaterThanOrEqual(2);

        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onB).length === 1 && changes(onA).length === 2, "delivery on the stream path again");
        expect(changes(onA)[1]?.id).toMatch(STREAM_CURSOR);
        expect(changes(onB)[0]?.id).toBe(changes(onA)[1]?.id);
    });

    it("closes its Valkey connections on destroy", async () => {
        const before = Number(/connected_clients:(\d+)/.exec(await admin.info("clients"))?.[1]);
        const extra = instance(VALKEY_URL as string, streamKey);
        await waitFor(() => extra.transport.activeMode === "valkey", "extra transport connected");
        const during = Number(/connected_clients:(\d+)/.exec(await admin.info("clients"))?.[1]);
        expect(during).toBeGreaterThanOrEqual(before + 2); // publisher + reader

        extra.destroy();
        await pause(200);

        const after = Number(/connected_clients:(\d+)/.exec(await admin.info("clients"))?.[1]);
        expect(after).toBe(before);
    });
});
