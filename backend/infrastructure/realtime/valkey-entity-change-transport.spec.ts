import { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import type { Subscription } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";
import { deriveRealtimeCursorKey } from "./entity-change-cursor-codec";
import type { DeliveredBatch, TransportSignal } from "./entity-change-transport";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

type Received = Array<MessageEvent & { id?: string }>;

/**
 * ioredis silently falls back to localhost:6379 for a URL without a port (`redis://127.0.0.1:` or
 * `redis://host`), which is where a developer's or host's own Redis lives; this spec writes streams,
 * trims them and kills client connections, so it must never end up there by accident. An unset URL
 * still just skips the integration tests.
 */
function explicitPortUrl(raw: string | undefined): string | undefined {
    const url = raw?.trim();
    if (!url) return undefined;
    let port = "";
    try {
        port = new URL(url).port;
    } catch {
        // falls through to the error below
    }
    if (port === "") {
        throw new Error(
            "REALTIME_TEST_VALKEY_URL / VALKEY_URL must name an explicit port (e.g. redis://127.0.0.1:56379); " +
                "refusing to let the client default to 6379.",
        );
    }
    return url;
}

const VALKEY_URL = explicitPortUrl(process.env["REALTIME_TEST_VALKEY_URL"] ?? process.env["VALKEY_URL"]);
const STREAM_CURSOR = /^\d+-\d+$/;
const RING_CURSOR = /^[0-9a-f]+:\d+$/;
// The desktop and mobile proxies validate a cursor with exactly this expression.
const CLIENT_CURSOR = /^[0-9A-Za-z:._-]{1,64}$/;
// Every instance derives the same key from the shared JWT secret.
const CURSOR_KEY = deriveRealtimeCursorKey("realtime-test-secret");

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function instance(url: string, streamKey: string, extra: { maxLen?: number; cursorKey?: Buffer } = {}) {
    const bus = new EntityChangeEventBus(10);
    const transport = new ValkeyEntityChangeTransport(bus, {
        url,
        streamKey,
        cursorKey: CURSOR_KEY,
        retryDelayMs: 50,
        maxRetryDelayMs: 200,
        blockMs: 500,
        ...extra,
    });
    const controller = new RealtimeController(bus, transport);
    const subscriptions: Subscription[] = [];
    /** `since` is the internal stream/ring cursor; it is turned into the token a client would hold. */
    const subscribe = (branchId: string, since?: string) => {
        const received: Received = [];
        const token = since === undefined ? undefined : transport.cursors.encode(since);
        subscriptions.push(controller.events({ branchId }, token).subscribe((e) => received.push(e)));
        return received;
    };
    /** Internal cursor behind a message id. */
    const cursorOf = (id: string | undefined) => (id === undefined ? undefined : transport.cursors.decode(id));
    const destroy = () => {
        subscriptions.forEach((s) => s.unsubscribe());
        transport.onModuleDestroy();
    };
    return { bus, transport, controller, subscribe, cursorOf, destroy };
}

const changes = (received: Received) => received.filter((e) => e.type === "entity-changed");

describe("ValkeyEntityChangeTransport without a reachable Valkey", () => {
    it("never blocks or throws on a write: batches reach local subscribers in-process, ids are ring-cursor tokens", async () => {
        const { bus, transport, subscribe, cursorOf, destroy } = instance("redis://127.0.0.1:1", `rt-test:${randomBytes(4).toString("hex")}`);
        try {
            const received = subscribe("branch-a");
            bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(received).length === 1, "the in-process delivery");

            expect(transport.activeMode).toBe("fallback");
            expect(received[0]).toMatchObject({ type: "ready", data: { resumed: false } });
            expect(changes(received)[0]).toMatchObject({ data: { entities: ["client"] } });
            expect(changes(received)[0]?.id).toMatch(CLIENT_CURSOR);
            expect(cursorOf(changes(received)[0]?.id)).toMatch(RING_CURSOR);
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

    it("an emit on A reaches the subscriber on A and the one on B exactly once, with the same underlying stream-id cursor", async () => {
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
        expect(changes(onA)[0]?.id).toMatch(CLIENT_CURSOR);
        expect(a.cursorOf(changes(onA)[0]?.id)).toMatch(STREAM_CURSOR);
        // Both instances derive the same key, and the tokens still differ (fresh IV per issue).
        expect(b.cursorOf(changes(onB)[0]?.id)).toBe(a.cursorOf(changes(onA)[0]?.id));
        expect(changes(onB)[0]?.id).not.toBe(changes(onA)[0]?.id);
        // The stream is the single source: one entry, not one per instance.
        expect(await admin.xlen(streamKey)).toBe(1);
    });

    it("a token issued by A resumes on B (same derived key on every instance)", async () => {
        const onA = a.subscribe("branch-a");
        a.bus.emit({ branchId: "branch-a", kind: "client" });
        await waitFor(() => changes(onA).length === 1, "first batch");
        const tokenFromA = changes(onA)[0]?.id as string;
        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onA).length === 2, "second batch");

        const received: Received = [];
        const sub = b.controller.events({ branchId: "branch-a" }, tokenFromA).subscribe((e) => received.push(e));
        await waitFor(() => changes(received).length === 1, "replay on B");
        sub.unsubscribe();

        expect(received[0]?.data).toEqual({ resumed: true });
        expect(changes(received)[0]?.data).toEqual({ entities: ["message"] });
    });

    it("a token under a different key (another deployment's secret) is not honoured", async () => {
        const stranger = instance(VALKEY_URL as string, streamKey, { cursorKey: deriveRealtimeCursorKey("someone-elses-secret") });
        try {
            const onStranger = stranger.subscribe("branch-a");
            stranger.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onStranger).length === 1, "the stranger's batch");
            const foreignToken = changes(onStranger)[0]?.id as string;

            const received: Received = [];
            const sub = b.controller.events({ branchId: "branch-a" }, foreignToken).subscribe((e) => received.push(e));
            await waitFor(() => received.length >= 1, "ready");
            sub.unsubscribe();

            expect(received[0]?.data).toEqual({ resumed: false });
        } finally {
            stranger.destroy();
        }
    });

    it("a batch for another branch reaches only that branch's subscribers and leaves the other branch's ids untouched", async () => {
        const branchA = b.subscribe("branch-a");
        const branchB = b.subscribe("branch-b");

        a.bus.emit({ branchId: "branch-b", kind: "employee" });
        await waitFor(() => changes(branchB).length === 1, "branch-b delivery");

        expect(changes(branchA)).toHaveLength(0);
        expect(branchA.map((e) => e.type)).toEqual(["ready"]);
        expect(changes(branchB)[0]?.data).toEqual({ entities: ["employee"] });
        expect(b.cursorOf(changes(branchB)[0]?.id)).toBe(b.transport.position());
    });

    it("only branch B writing across instances: A's connection id never changes and a reconnect with it resumes without B batches", async () => {
        const onA = a.subscribe("branch-a");
        const oldToken = onA[0]?.id as string;

        for (let i = 0; i < 3; i += 1) {
            b.bus.emit({ branchId: "branch-b", kind: "employee" });
            await waitFor(() => b.transport.position() !== (a.transport.cursors.decode(oldToken) ?? ""), "B batch to land");
            await pause(40);
        }
        await waitFor(() => a.transport.position() === b.transport.position(), "A's reader to see every batch");

        expect(onA.map((e) => e.type)).toEqual(["ready"]);
        const resumed: Received = [];
        const sub = a.controller.events({ branchId: "branch-a" }, oldToken).subscribe((e) => resumed.push(e));
        await waitFor(() => resumed.length >= 1, "ready");
        await pause(100);
        sub.unsubscribe();

        expect(resumed.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: true }]]);
        expect(resumed[0]?.id).not.toBe(oldToken);
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

        expect(replayed[0]?.type).toBe("ready");
        expect(b.cursorOf(replayed[0]?.id)).toBe(first);
        expect(replayed[0]?.data).toEqual({ resumed: true });
        expect(changes(replayed).map((e) => [b.cursorOf(e.id), e.data])).toEqual([
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

        expect(b.cursorOf(replayed[0]?.id)).toBe("0-0");
        expect(replayed[0]?.data).toEqual({ resumed: true });
        expect(changes(replayed).map((e) => b.cursorOf(e.id))).toEqual([cursors[0], cursors[2], cursors[3]]);
    });

    it("resuming from the newest cursor is honoured with an empty replay", async () => {
        const cursors = await seedOnA();

        const received = b.subscribe("branch-a", cursors.at(-1));
        await pause(150);

        expect(received.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: true }]]);
        expect(b.cursorOf(received[0]?.id)).toBe(cursors.at(-1));
    });

    it("after a trim, a cursor older than the oldest retained entry is not honoured, the oldest retained entry's own cursor is", async () => {
        const cursors = await seedOnA();
        await admin.xtrim(streamKey, "MAXLEN", 1); // keeps only the newest entry

        const expired = b.subscribe("branch-a", cursors[0]);
        const justBeforeOldest = b.subscribe("branch-a", cursors[2]);
        const atOldest = b.subscribe("branch-a", cursors[3]);
        await waitFor(() => expired.length >= 1 && justBeforeOldest.length >= 1 && atOldest.length >= 1, "ready messages");
        await pause(100);

        expect(expired.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: false }]]);
        expect(b.cursorOf(expired[0]?.id)).toBe(b.transport.position());
        // Its successor gap is invisible once trimmed, so the safe answer is "not honoured".
        expect(justBeforeOldest[0]?.data).toEqual({ resumed: false });
        expect(atOldest.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: true }]]);
        expect(b.cursorOf(atOldest[0]?.id)).toBe(cursors[3]);
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

    it("a cursor from the future of the stream, a ring cursor and a raw (unencrypted) id are not honoured", async () => {
        await seedOnA();

        const future = b.subscribe("branch-a", "99999999999999-0");
        const ring = b.subscribe("branch-a", "abcdef012345:1");
        const raw: Received = [];
        const sub = b.controller.events({ branchId: "branch-a" }, "1793326101367-0").subscribe((e) => raw.push(e));
        await waitFor(() => future.length >= 1 && ring.length >= 1 && raw.length >= 1, "ready messages");
        sub.unsubscribe();

        expect(future[0]?.data).toEqual({ resumed: false });
        expect(ring[0]?.data).toEqual({ resumed: false });
        expect(raw[0]?.data).toEqual({ resumed: false });
    });

    it("a fresh connect starts at the reader's position, which is the stream's newest id", async () => {
        const cursors = await seedOnA();

        const fresh = b.subscribe("branch-a");

        expect(fresh.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: false }]]);
        expect(b.cursorOf(fresh[0]?.id)).toBe(cursors.at(-1));
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

    it("keeps null, empty-string and real branch ids apart across the stream", async () => {
        const seen: DeliveredBatch[] = [];
        const sub = b.transport.signals$.subscribe((s: TransportSignal) => {
            if (s.type === "batch") seen.push(s);
        });
        try {
            a.bus.emit({ branchId: null, kind: "settings" });
            await waitFor(() => seen.length === 1, "broadcast batch");
            a.bus.emit({ branchId: "", kind: "client" });
            await waitFor(() => seen.length === 2, "empty-branch batch");
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => seen.length === 3, "scoped batch");

            expect(seen.map((s) => s.branchId)).toEqual([null, "", "branch-a"]);
            // What is physically on the stream: no `b` field for the broadcast.
            const rows = await admin.xrange(streamKey, "-", "+");
            expect(rows.map(([, fields]) => fields)).toEqual([
                ["e", '["settings"]'],
                ["b", "", "e", '["client"]'],
                ["b", "branch-a", "e", '["message"]'],
            ]);
        } finally {
            sub.unsubscribe();
        }
    });

    it("skips a malformed entry on the stream instead of delivering or crashing, and keeps reading", async () => {
        const seen: DeliveredBatch[] = [];
        const sub = b.transport.signals$.subscribe((s: TransportSignal) => {
            if (s.type === "batch") seen.push(s);
        });
        try {
            await admin.xadd(streamKey, "*", "b", "x", "unexpected", "1", "e", '["client"]');
            await admin.xadd(streamKey, "*", "e", '["not-a-kind"]');
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => seen.length === 1, "the well-formed batch");

            expect(seen[0]).toMatchObject({ branchId: "branch-a", entities: ["message"] });
        } finally {
            sub.unsubscribe();
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
        expect(b.cursorOf(changes(onB)[1]?.id)).toMatch(STREAM_CURSOR);
        expect(resets()[0]?.data).toEqual({});
        expect(resets()[0]?.id).toMatch(CLIENT_CURSOR);
    });

    it("an XADD that fails during an outage still reaches local subscribers, then resets, and the stream path resumes", async () => {
        const onA = a.subscribe("branch-a");
        const onB = b.subscribe("branch-a");
        // Drop A's publishing connection and write straight away, before it has reconnected.
        (a.transport as unknown as { publisher: Redis }).publisher.disconnect(true);

        a.bus.emit({ branchId: "branch-a", kind: "client" });
        await waitFor(() => changes(onA).length === 1, "local delivery of the unpublished batch");

        expect(a.cursorOf(changes(onA)[0]?.id)).toMatch(RING_CURSOR);
        expect(onA.some((e) => e.type === "reset")).toBe(true);
        expect(changes(onB)).toHaveLength(0); // never reached the stream, so B cannot have it

        await waitFor(() => a.transport.activeMode === "valkey", "A back on the stream");
        expect(onA.filter((e) => e.type === "reset").length).toBeGreaterThanOrEqual(2);

        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onB).length === 1 && changes(onA).length === 2, "delivery on the stream path again");
        expect(a.cursorOf(changes(onA)[1]?.id)).toMatch(STREAM_CURSOR);
        expect(b.cursorOf(changes(onB)[0]?.id)).toBe(a.cursorOf(changes(onA)[1]?.id));
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
