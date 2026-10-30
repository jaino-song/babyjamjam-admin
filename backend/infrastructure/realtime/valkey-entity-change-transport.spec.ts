import { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import type { Subscription } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";
import { deriveRealtimeCursorKey } from "./entity-change-cursor-codec";
import { REALTIME_REPLAY_LIMIT } from "./entity-change-transport";
import type { DeliveredBatch, TransportSignal } from "./entity-change-transport";
import { STREAM_ID_COMPARE_LUA, ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

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
const STREAM_CURSOR = /^\d+-\d+@[0-9a-f]{16}$/;
const RING_CURSOR = /^[0-9a-f]+:\d+$/;
// The desktop and mobile proxies validate a cursor with exactly this expression.
const CLIENT_CURSOR = /^[0-9A-Za-z:._-]{1,64}$/;
// Every instance derives the same key from the shared JWT secret.
const CURSOR_KEY = deriveRealtimeCursorKey("realtime-test-secret");

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
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

const incarnationOf = (position: string) => position.split("@")[1] as string;
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
        await admin.del(streamKey, `${streamKey}:incarnation`);
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
        let previous = b.transport.position();
        for (const [branchId, kind] of [["branch-a", "client"], ["branch-b", "employee"], [null, "settings"], ["branch-a", "document"]] as const) {
            a.bus.emit({ branchId, kind });
            await waitFor(() => b.transport.position() !== previous, "batch to land");
            previous = b.transport.position();
            cursors.push(previous);
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
        const origin = `0-0@${incarnationOf(b.transport.position())}`;
        const cursors = await seedOnA();

        const replayed = b.subscribe("branch-a", origin);
        await waitFor(() => changes(replayed).length === 3, "full replay");

        expect(b.cursorOf(replayed[0]?.id)).toBe(origin);
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

    it("a stream trimmed to nothing proves nothing: no cursor is honoured, not even its newest id", async () => {
        // An empty stream has no entry left to show which incarnation it belongs to, so after writes the
        // transport refuses to vouch for it (the decision documented in SETTLE_SCRIPT) and starts a new one.
        const cursors = await seedOnA();
        const before = incarnationOf(cursors[3] as string);
        await admin.xtrim(streamKey, "MAXLEN", 0);

        const older = b.subscribe("branch-a", cursors[2]);
        const newest = b.subscribe("branch-a", cursors[3]);
        const origin = b.subscribe("branch-a", `0-0@${before}`);
        await waitFor(() => older.length >= 1 && newest.length >= 1 && origin.length >= 1, "ready messages");

        expect(older[0]?.data).toEqual({ resumed: false });
        expect(origin[0]?.data).toEqual({ resumed: false });
        expect(newest[0]?.data).toEqual({ resumed: false });

        // ...and the stream is usable again under the new incarnation.
        const onA = a.subscribe("branch-a");
        await waitFor(() => incarnationOf(a.transport.position()) !== before, "a new incarnation after the emptying");
        a.bus.emit({ branchId: "branch-a", kind: "message" });
        await waitFor(() => changes(onA).length === 1, "batch on the emptied stream");
    });

    it("a cursor from the future of the stream, a ring cursor and a raw (unencrypted) id are not honoured", async () => {
        await seedOnA();

        const future = b.subscribe("branch-a", `99999999999999-0@${incarnationOf(b.transport.position())}`);
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

    /** Connects with a token and returns what the connection said first (and anything replayed). */
    async function reconnect(instanceUnderTest: ReturnType<typeof instance>, branchId: string, token: string, settleMs = 150) {
        const received: Received = [];
        const sub = instanceUnderTest.controller.events({ branchId }, token).subscribe((e) => received.push(e));
        await waitFor(() => received.length >= 1, "ready");
        await pause(settleMs);
        sub.unsubscribe();
        return received;
    }

    /**
     * A real token for branch-a, then a document hint for branch-a that only the stream knows about (what a
     * resume must not lose). The pause keeps the two ids at least a few ms apart so fixtures can place ids
     * between them.
     */
    async function tokenThenOwnBranchHint(): Promise<string> {
        const onB = b.subscribe("branch-a");
        a.bus.emit({ branchId: "branch-a", kind: "client" });
        await waitFor(() => changes(onB).length === 1, "first batch");
        const token = changes(onB)[0]?.id as string;
        await pause(40);
        const before = b.transport.position();
        a.bus.emit({ branchId: "branch-a", kind: "document" });
        await waitFor(() => b.transport.position() !== before, "document hint delivered");
        return token;
    }

    describe("stream incarnation (a deleted and recreated stream)", () => {
        it("DEL + raw XADD: a token from the destroyed history is not honoured (the document hint is not silently skipped)", async () => {
            const oldToken = await tokenThenOwnBranchHint();

            await admin.del(streamKey);
            await admin.xadd(streamKey, "*", "b", "branch-b", "e", '["employee"]');

            const received = await reconnect(b, "branch-a", oldToken);
            // (the reader may add its own reset a moment later; what matters is the first answer and no replay)
            expect([received[0]?.type, received[0]?.data]).toEqual(["ready", { resumed: false }]);
            expect(changes(received)).toEqual([]);
        });

        it("DEL + an XADD through the transport: same outcome", async () => {
            const oldToken = await tokenThenOwnBranchHint();

            await admin.del(streamKey);
            a.bus.emit({ branchId: "branch-b", kind: "employee" });
            await waitFor(() => admin.exists(streamKey).then((n) => n === 1), "stream recreated");

            const received = await reconnect(b, "branch-a", oldToken);
            expect(received[0]?.data).toEqual({ resumed: false });
        });

        it("DEL alone (stream absent): a token from the destroyed history is not honoured", async () => {
            const oldToken = await tokenThenOwnBranchHint();

            await admin.del(streamKey);

            const received = await reconnect(b, "branch-a", oldToken);
            expect(received[0]?.data).toEqual({ resumed: false });
        });

        it("tokens issued after the recreation are the current history and still resume", async () => {
            await tokenThenOwnBranchHint();
            const onA = a.subscribe("branch-a");
            await admin.del(streamKey);
            await admin.xadd(streamKey, "*", "b", "branch-b", "e", '["employee"]');
            await waitFor(() => onA.some((e) => e.type === "reset"), "the reset that follows the recreation");

            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(onA).length === 1, "batch after the recreation");
            const freshToken = changes(onA)[0]?.id as string;
            a.bus.emit({ branchId: "branch-a", kind: "call" });
            await waitFor(() => changes(onA).length === 2, "second batch");

            const received = await reconnect(b, "branch-a", freshToken);
            expect(received[0]?.data).toEqual({ resumed: true });
            expect(changes(received).map((e) => e.data)).toEqual([{ entities: ["call"] }]);
        });

        it("the reader notices a recreation on its own and resets connections, then keeps delivering", async () => {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch");

            await admin.del(streamKey);
            await admin.xadd(streamKey, "*", "b", "branch-b", "e", '["employee"]');
            await waitFor(() => onB.some((e) => e.type === "reset"), "a reset after the recreation");

            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(onB).length === 2, "delivery on the new stream");
            expect(changes(onB)[1]?.data).toEqual({ entities: ["message"] });
        });

        it("fresh origin: a token taken while the stream does not exist yet still resumes once the first batch creates it", async () => {
            expect(await admin.exists(streamKey)).toBe(0);
            const onB = b.subscribe("branch-a");
            const originToken = onB[0]?.id as string;
            expect(b.cursorOf(originToken)).toMatch(/^0-0@[0-9a-f]{16}$/);

            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch creating the stream");

            const received = await reconnect(b, "branch-a", originToken);
            expect(received[0]?.data).toEqual({ resumed: true });
            expect(changes(received).map((e) => e.data)).toEqual([{ entities: ["client"] }]);
        });

        it("every transport (also ones racing at start-up) converges on one incarnation", async () => {
            const racing = [instance(VALKEY_URL as string, `${streamKey}:race`), instance(VALKEY_URL as string, `${streamKey}:race`), instance(VALKEY_URL as string, `${streamKey}:race`)];
            try {
                await waitFor(() => racing.every((r) => r.transport.activeMode === "valkey"), "racing transports on the stream");

                expect(new Set(racing.map((r) => incarnationOf(r.transport.position()))).size).toBe(1);
                // and the two from beforeEach, which also started together
                expect(incarnationOf(a.transport.position())).toBe(incarnationOf(b.transport.position()));
            } finally {
                racing.forEach((r) => r.destroy());
                await admin.del(`${streamKey}:race`, `${streamKey}:race:incarnation`);
            }
        });
    });

    describe("identity from evidence in the stream (`g`)", () => {
        // One atomic script, so nothing (no reader, no writer) runs in between: the destroyed stream is
        // recreated and holds MORE entries (3) than the 2 the companion record last saw. Counter growth
        // used to be taken as proof of identity.
        const REFILL = `
            redis.call('DEL', KEYS[1])
            for i = 1, 3 do
              redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]')
            end
            return 1
        `;

        it("an atomic DEL + 3 raw XADD (more entries than recorded) does not honour the old token, and the document hint is not skipped", async () => {
            const oldToken = await tokenThenOwnBranchHint();
            const oldInternal = b.cursorOf(oldToken) as string;

            expect(await admin.eval(REFILL, 1, streamKey)).toBe(1);

            // Straight at the replay path, immediately after the refill (a live reader may already have discarded
            // the refilled stream, which is the same outcome)...
            expect(await b.transport.replayAfter(oldInternal)).toEqual({ honoured: false });
            // ...and through the connection a client would open.
            const received = await reconnect(b, "branch-a", oldToken);
            expect([received[0]?.type, received[0]?.data]).toEqual(["ready", { resumed: false }]);
            expect(changes(received)).toEqual([]);
        });

        it("the same refill while a reader is live makes the reader send a reset", async () => {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "reader positioned on the stream");
            const before = incarnationOf(b.transport.position());
            const seen = onB.length;

            await admin.eval(REFILL, 1, streamKey);
            await waitFor(() => onB.slice(seen).some((e) => e.type === "reset"), "a reset after the refill");

            const reset = onB.slice(seen).find((e) => e.type === "reset");
            expect(incarnationOf(b.cursorOf(reset?.id) as string)).not.toBe(before); // a new incarnation
            expect(onB.slice(seen).filter((e) => e.type === "entity-changed")).toEqual([]);
            // delivery continues on the new incarnation
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(onB).length === 2, "delivery after the reset");
            expect(changes(onB)[1]?.data).toEqual({ entities: ["message"] });
        });

        it("a raw entry appended on top of a healthy stream is a foreign writer: reset, old tokens refused, new ones resume", async () => {
            const oldToken = await tokenThenOwnBranchHint();
            const onB = b.subscribe("branch-a");
            const seen = onB.length;

            await admin.xadd(streamKey, "*", "b", "branch-a", "e", '["call"]'); // no `g`
            await waitFor(() => onB.slice(seen).some((e) => e.type === "reset"), "a reset after the foreign entry");
            expect(onB.slice(seen).filter((e) => e.type === "entity-changed")).toEqual([]); // the foreign entry is never delivered

            const refused = await reconnect(b, "branch-a", oldToken);
            expect(refused[0]?.data).toEqual({ resumed: false });

            const onA = a.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(onA).length === 1, "batch under the new incarnation");
            const token = changes(onA)[0]?.id as string;
            a.bus.emit({ branchId: "branch-a", kind: "call" });
            await waitFor(() => changes(onA).length === 2, "second batch");
            const resumed = await reconnect(b, "branch-a", token);
            expect(resumed[0]?.data).toEqual({ resumed: true });
            expect(changes(resumed).map((e) => e.data)).toEqual([{ entities: ["call"] }]);
        });

        // A foreign entry in the MIDDLE of the stream, with stamped entries at both ends: the boundary entries
        // vouch for the stream, only the per-row check on the rows a caller is handed can tell.
        const FOREIGN_IN_THE_MIDDLE = `
            local g = redis.call('HGET', KEYS[2], 'inc')
            redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]', 'g', g)
            redis.call('XADD', KEYS[1], '*', 'b', ARGV[1], 'e', '["call"]')
            redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]', 'g', g)
            return 1
        `;

        it("a replay range that contains an entry without our `g` is not honoured, even though both ends of the stream are ours", async () => {
            const oldToken = await tokenThenOwnBranchHint();
            const oldInternal = b.cursorOf(oldToken) as string;

            await admin.eval(FOREIGN_IN_THE_MIDDLE, 2, streamKey, `${streamKey}:incarnation`, "branch-a");

            expect(await b.transport.replayAfter(oldInternal)).toEqual({ honoured: false });
            const received = await reconnect(b, "branch-a", oldToken);
            expect(received[0]?.data).toEqual({ resumed: false });
            expect(changes(received)).toEqual([]);
        });

        it("an entry with a duplicated `g` is as foreign as one with none", async () => {
            const oldToken = await tokenThenOwnBranchHint();
            const g = (await admin.hget(`${streamKey}:incarnation`, "inc")) as string;
            const duplicated = `
                redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]', 'g', ARGV[1])
                redis.call('XADD', KEYS[1], '*', 'b', 'branch-a', 'e', '["call"]', 'g', ARGV[1], 'g', ARGV[1])
                redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]', 'g', ARGV[1])
                return 1
            `;
            await admin.eval(duplicated, 1, streamKey, g);

            expect(await b.transport.replayAfter(b.cursorOf(oldToken) as string)).toEqual({ honoured: false });
        });

        it("fresh origin still resumes (a token taken before the stream existed, once the first batch creates it)", async () => {
            expect(await admin.exists(streamKey)).toBe(0);
            const onB = b.subscribe("branch-a");
            const originToken = onB[0]?.id as string;

            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch creating the stream");
            const rows = await admin.xrange(streamKey, "-", "+");
            expect(rows[0]?.[1]).toContain(incarnationOf(b.transport.position())); // the first entry carries `g`

            const received = await reconnect(b, "branch-a", originToken);
            expect(received[0]?.data).toEqual({ resumed: true });
            expect(changes(received).map((e) => e.data)).toEqual([{ entities: ["client"] }]);
        });

        it("normal trimming of the transport's own entries keeps tokens at or after the oldest retained entry resumable, under the same incarnation", async () => {
            const cursors = await seedOnA();
            const before = incarnationOf(cursors[3] as string);
            await admin.xtrim(streamKey, "MAXLEN", 2); // oldest retained is cursors[2]'s successor, i.e. cursors[2]+1
            const rows = await admin.xrange(streamKey, "-", "+");
            expect(rows).toHaveLength(2);
            const oldestRetained = `${rows[0]?.[0]}@${before}`;

            const atOldest = await reconnect(b, "branch-a", b.transport.cursors.encode(oldestRetained));
            const atNewest = await reconnect(b, "branch-a", b.transport.cursors.encode(cursors[3] as string));
            expect(atOldest[0]?.data).toEqual({ resumed: true });
            expect(atNewest[0]?.data).toEqual({ resumed: true });
            expect(incarnationOf(b.transport.position())).toBe(before); // trimming alone never rotates
            expect(changes(atNewest)).toEqual([]);
        });

        it("a stream written before `g` existed is discarded, not adopted: nothing of it is replayed, and resumption works from the new incarnation on", async () => {
            const legacyKey = `${streamKey}:legacy`;
            await admin.xadd(legacyKey, "*", "b", "branch-a", "e", '["client"]');
            await admin.xadd(legacyKey, "*", "b", "branch-a", "e", '["document"]');
            const c = instance(VALKEY_URL as string, legacyKey);
            try {
                await waitFor(() => c.transport.activeMode === "valkey", "transport on the legacy stream");
                expect(await admin.exists(legacyKey)).toBe(0); // no record vouched for it
                const onC = c.subscribe("branch-a");
                c.bus.emit({ branchId: "branch-a", kind: "message" });
                await waitFor(() => changes(onC).length === 1, "first batch of ours");
                const token = changes(onC)[0]?.id as string;
                c.bus.emit({ branchId: "branch-a", kind: "call" });
                await waitFor(() => changes(onC).length === 2, "second batch of ours");

                const received = await reconnect(c, "branch-a", token);
                expect(received[0]?.data).toEqual({ resumed: true });
                expect(changes(received).map((e) => e.data)).toEqual([{ entities: ["call"] }]);
                expect(await admin.xlen(legacyKey)).toBe(2); // only ours
                expect(onC.filter((e) => e.type === "reset")).toEqual([]);
            } finally {
                c.destroy();
                await admin.del(legacyKey, `${legacyKey}:incarnation`);
            }
        });
    });

    describe("lost or rolled back state is never honoured (an old disconnected cursor and an active reader)", () => {
        type Id = [bigint, bigint];
        const parseId = (id: string): Id => {
            const [ms, seq] = id.split("-") as [string, string];
            return [BigInt(ms), BigInt(seq)];
        };
        interface Fixture {
            oldToken: string;
            /** Raw stream id of the client batch the token names. */
            tokenId: Id;
            /** Raw stream id of the newest batch (the document hint the token does not cover). */
            newestId: Id;
        }
        const recordKey = () => `${streamKey}:incarnation`;

        /** Damages the stream, then checks a cursor from before it AND a reader that was listening through it. */
        async function expectNeverHonoured(damage: (fixture: Fixture) => Promise<void>): Promise<void> {
            const oldToken = await tokenThenOwnBranchHint();
            const oldInternal = b.cursorOf(oldToken) as string;
            const live = b.subscribe("branch-a");
            const seen = live.length;

            await damage({
                oldToken,
                tokenId: parseId(oldInternal.split("@")[0] as string),
                newestId: parseId(b.transport.position().split("@")[0] as string),
            });

            // The old disconnected cursor, straight at the replay path and through a connection a client would open.
            expect(await b.transport.replayAfter(oldInternal)).toEqual({ honoured: false });
            const received = await reconnect(b, "branch-a", oldToken);
            expect([received[0]?.type, received[0]?.data]).toEqual(["ready", { resumed: false }]);
            expect(changes(received)).toEqual([]);

            // The active reader is told, and nothing of the lost history reaches it first.
            await waitFor(() => live.slice(seen).some((e) => e.type === "reset"), "a reset for the active reader");
            expect(live.slice(seen).filter((e) => e.type === "entity-changed")).toEqual([]);
        }

        it("stream key deleted", () => expectNeverHonoured(async () => void (await admin.del(streamKey))));
        it("record (hash) key deleted", () => expectNeverHonoured(async () => void (await admin.del(recordKey()))));
        it("both keys deleted", () => expectNeverHonoured(async () => void (await admin.del(streamKey, recordKey()))));

        // DEL + explicit-id refill in one atomic script, so no reader or writer runs in between.
        const REFILL_IDS = `
            redis.call('DEL', KEYS[1])
            for i = 1, #ARGV do redis.call('XADD', KEYS[1], ARGV[i], 'b', 'branch-b', 'e', '["employee"]') end
            return 1
        `;
        const REFILL_STAMPED = `
            redis.call('DEL', KEYS[1])
            for i = 2, #ARGV do redis.call('XADD', KEYS[1], ARGV[i], 'b', 'branch-b', 'e', '["employee"]', 'g', ARGV[1]) end
            return 1
        `;
        /** `count` ids with strictly increasing ms, the last one being exactly `newest`. */
        const idsEndingAt = (count: number, newest: Id): string[] => [
            ...Array.from({ length: count - 1 }, (_, i) => `${newest[0] - BigInt(count - 1 - i)}-0`),
            `${newest[0]}-${newest[1]}`,
        ];

        it("the R3 fixture: after a lost document hint, an atomic DEL + 4 unstamped entries whose last id is exactly the client's token id", () =>
            expectNeverHonoured(async ({ tokenId }) => {
                await admin.eval(REFILL_IDS, 1, streamKey, ...idsEndingAt(4, tokenId));
            }));

        const positions = ["below", "equal to", "above"] as const;
        it.each(
            [1, 2, 4].flatMap((count) => positions.map((where) => [count, where] as const)),
        )("a refill of %i unstamped entries whose newest id is %s the recorded newest id", (count, where) =>
            expectNeverHonoured(async ({ newestId }) => {
                const target: Id = where === "below" ? [newestId[0] - 1n, 0n] : where === "equal to" ? newestId : [newestId[0] + 1000n, 0n];
                await admin.eval(REFILL_IDS, 1, streamKey, ...idsEndingAt(count, target));
            }),
        );

        // Coherent in every other way (the current `g` on every entry, record and F untouched, the cursor still inside
        // the retained range): only the high-water mark says the stream went backwards. Defence in depth, since a live
        // overwrite of a single key is not a supported recovery path (A5).
        it.each([1, 2, 4])("a refill of %i entries stamped with the current g whose newest id is below the recorded newest id", (count) =>
            expectNeverHonoured(async ({ newestId }) => {
                const g = (await admin.hget(recordKey(), "inc")) as string;
                await admin.eval(REFILL_STAMPED, 1, streamKey, g, ...idsEndingAt(count, [newestId[0] - 1n, 0n]));
            }),
        );

        it("the stream key alone rolled back in place (DUMP, publish more, RESTORE REPLACE): refused through the high-water mark alone", async () => {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch");
            const token = changes(onB)[0]?.id as string;
            const dump = await admin.callBuffer("DUMP", streamKey);
            await pause(40);
            const before = b.transport.position();
            a.bus.emit({ branchId: "branch-a", kind: "document" }); // the hint the rolled-back stream no longer has
            await waitFor(() => b.transport.position() !== before, "document hint delivered");
            const seen = onB.length;

            await admin.call("RESTORE", streamKey, "0", dump as Buffer, "REPLACE");

            // Every entry of the restored stream carries the current g, the record and F are current, and the token's id
            // is still inside the stream: nothing but the stream's `last-generated-id` going backwards shows it.
            expect(await b.transport.replayAfter(b.cursorOf(token) as string)).toEqual({ honoured: false });
            const received = await reconnect(b, "branch-a", token);
            expect(received[0]?.data).toEqual({ resumed: false });
            await waitFor(() => onB.slice(seen).some((e) => e.type === "reset"), "a reset for the active reader");
        });
    });

    describe("stream ids are compared exactly (both halves are uint64 and may exceed 2^53)", () => {
        it.each<[string, string, number, number]>([
            ["9007199254740993-0", "9007199254740992-0", 1, -1], // doubles cannot tell these apart
            ["0-18446744073709551615", "0-18446744073709551614", 1, -1],
            ["18446744073709551615-0", "9007199254740993-0", 1, -1],
            ["9007199254740993-5", "9007199254740993-5", 0, 0],
            ["9-0", "10-0", -1, 1], // by length first, not lexicographically
            ["10-9", "10-10", -1, 1],
        ])("%s vs %s", async (x, y, forward, backward) => {
            const reply = await admin.eval(`${STREAM_ID_COMPARE_LUA} return { cmpid(ARGV[1], ARGV[2]), cmpid(ARGV[2], ARGV[1]) }`, 0, x, y);
            expect(reply).toEqual([forward, backward]);
        });

        // One atomic script: stream with one stamped entry of an explicit id, and the record's high-water mark.
        const FORGE = `
            redis.call('DEL', KEYS[1])
            redis.call('XADD', KEYS[1], ARGV[1], 'b', 'branch-b', 'e', '["employee"]', 'g', ARGV[3])
            redis.call('HSET', KEYS[2], 'h', ARGV[2])
            return 1
        `;
        it.each<[string, string, string, boolean]>([
            ["newest one below the recorded, ms beyond 2^53", "9007199254740993-0", "9007199254740992-0", false],
            ["newest one above the recorded, ms beyond 2^53", "9007199254740992-0", "9007199254740993-0", true],
            ["newest below the recorded, seq at the uint64 edge", "0-18446744073709551615", "0-18446744073709551614", false],
            ["newest above the recorded, seq at the uint64 edge", "0-18446744073709551614", "0-18446744073709551615", true],
            ["newest equal to the recorded", "9007199254740993-5", "9007199254740993-5", true],
        ])("high-water mark, %s: honoured = %s", async (_label, recorded, newest, honoured) => {
            a.bus.emit({ branchId: "branch-a", kind: "client" }); // a record, F and g exist (history written)
            await waitFor(() => admin.exists(streamKey).then((n) => n === 1), "first batch");
            const g = (await admin.hget(`${streamKey}:incarnation`, "inc")) as string;

            await admin.eval(FORGE, 2, streamKey, `${streamKey}:incarnation`, newest, recorded, g);

            // (An id this large cannot be carried in a 64-char token, so the batch itself is skipped; the verdict is what counts.)
            expect((await b.transport.replayAfter(`0-0@${g}`)).honoured).toBe(honoured);
        });
    });

    describe("bounded replay and paged reader", () => {
        // `count` stamped entries for another branch, then optionally one stamped call hint for branch-a, in one script.
        const FLOOD = `
            local g = redis.call('HGET', KEYS[2], 'inc')
            for i = 1, tonumber(ARGV[1]) do
              redis.call('XADD', KEYS[1], '*', 'b', 'branch-b', 'e', '["employee"]', 'g', g)
            end
            if ARGV[2] == 'own' then redis.call('XADD', KEYS[1], '*', 'b', 'branch-a', 'e', '["call"]', 'g', g) end
            return 1
        `;

        async function tokenAfterFirstBatch(): Promise<string> {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch");
            return changes(onB)[0]?.id as string;
        }

        it.each<[number, boolean]>([
            [REALTIME_REPLAY_LIMIT, true],
            [REALTIME_REPLAY_LIMIT + 1, false],
        ])("a resume with %i retained rows after the cursor: honoured = %s (the bound is 2000 raw rows)", async (count, honoured) => {
            const token = await tokenAfterFirstBatch();
            await admin.eval(FLOOD, 2, streamKey, `${streamKey}:incarnation`, String(count), "other");

            const result = await b.transport.replayAfter(b.cursorOf(token) as string);
            expect(result.honoured).toBe(honoured);
            if (result.honoured) expect(result.batches).toHaveLength(count);
            const received = await reconnect(b, "branch-a", token);
            expect(received[0]?.data).toEqual({ resumed: honoured });
        });

        it("the live reader pages through a backlog beyond the resume bound: no refusal, no reset, nothing lost", async () => {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "first batch");

            await admin.eval(FLOOD, 2, streamKey, `${streamKey}:incarnation`, String(REALTIME_REPLAY_LIMIT + 500), "own");
            await waitFor(() => changes(onB).length === 2, "the hint behind the backlog", 15000);

            expect(changes(onB)[1]?.data).toEqual({ entities: ["call"] });
            expect(onB.filter((e) => e.type === "reset")).toEqual([]);
        });
    });

    describe("rotation while something is in flight", () => {
        it("racing a replay: the answer is the complete replay or a refusal, never a mix", async () => {
            for (let i = 0; i < 6; i += 1) {
                const before = incarnationOf(b.transport.position());
                const token = await tokenThenOwnBranchHint();
                const racing = (async () => {
                    await pause(i);
                    await admin.del(`${streamKey}:incarnation`);
                })();
                const [result] = await Promise.all([b.transport.replayAfter(b.cursorOf(token) as string), racing]);

                if (result.honoured) expect(result.batches.map((batch) => batch.entities)).toEqual([["document"]]);
                await waitFor(() => incarnationOf(b.transport.position()) !== before, "the rotation to be noticed");
            }
        });

        it("during a blocked read: a reset comes first, then only batches of the new generation", async () => {
            const live = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(live).length === 1, "first batch");
            const before = incarnationOf(b.transport.position());
            const seen = live.length;

            await admin.del(`${streamKey}:incarnation`); // the generation is lost while the reader sits in XREAD
            await waitFor(() => live.slice(seen).some((e) => e.type === "reset"), "a reset");
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(live).length === 2, "a batch of the new generation");

            const after = live.slice(seen);
            expect(after[0]?.type).toBe("reset");
            const generations = after.map((e) => incarnationOf(b.cursorOf(e.id) as string));
            expect(generations[0]).not.toBe(before);
            expect(new Set(generations).size).toBe(1); // no message from the old generation after the reset, none mixed in
            expect(changes(after)[0]?.data).toEqual({ entities: ["message"] });
        });

        it("tokens issued after a recovery resume, and the recovery does not repeat", async () => {
            const live = b.subscribe("branch-a");
            await admin.del(streamKey, `${streamKey}:incarnation`);
            await waitFor(() => live.some((e) => e.type === "reset"), "the reset");
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(live).length === 1, "batch after the recovery");
            const token = changes(live)[0]?.id as string;
            a.bus.emit({ branchId: "branch-a", kind: "call" });
            await waitFor(() => changes(live).length === 2, "second batch");

            const received = await reconnect(b, "branch-a", token);
            expect(received[0]?.data).toEqual({ resumed: true });
            await pause(1300); // more than two idle reader timeouts
            expect(live.filter((e) => e.type === "reset")).toHaveLength(1);
            expect(incarnationOf(a.transport.position())).toBe(incarnationOf(b.transport.position()));
        });
    });

    it("a healthy backend restart against unchanged Valkey keeps history: a token from before it resumes and replays", async () => {
        const oldToken = await tokenThenOwnBranchHint();
        const before = incarnationOf(b.transport.position());
        a.destroy();
        b.destroy();

        const restarted = instance(VALKEY_URL as string, streamKey);
        try {
            await waitFor(() => restarted.transport.activeMode === "valkey", "the restarted transport on the stream");
            const received = await reconnect(restarted, "branch-a", oldToken);

            expect(received[0]?.data).toEqual({ resumed: true });
            expect(changes(received).map((e) => e.data)).toEqual([{ entities: ["document"] }]);
            expect(incarnationOf(restarted.transport.position())).toBe(before);
        } finally {
            restarted.destroy();
        }
    });

    describe("INFO is needed for the runtime identity (an ACL user without it)", () => {
        it("a refused INFO is an outage, never proof: replay refused, writes delivered in-process, and the stream path returns once INFO is allowed", async () => {
            const user = `rt${randomBytes(4).toString("hex")}`;
            const url = new URL(VALKEY_URL as string);
            url.username = user;
            url.password = "pw";
            const key = `${streamKey}:acl`;
            await admin.call("ACL", "SETUSER", user, "on", ">pw", "~*", "&*", "+@all");
            const c = instance(url.toString(), key);
            try {
                await waitFor(() => c.transport.activeMode === "valkey", "transport on the stream");
                const onC = c.subscribe("branch-a");
                c.bus.emit({ branchId: "branch-a", kind: "client" });
                await waitFor(() => changes(onC).length === 1, "first batch");
                const token = changes(onC)[0]?.id as string;
                const resets = onC.filter((e) => e.type === "reset").length;

                await admin.call("ACL", "SETUSER", user, "-info");
                // The reader has not noticed yet: the replay itself has to refuse.
                expect(c.transport.activeMode).toBe("valkey");
                expect(await c.transport.replayAfter(c.cursorOf(token) as string)).toEqual({ honoured: false });
                await waitFor(() => c.transport.activeMode === "fallback", "the transport to fall back");
                await waitFor(() => onC.filter((e) => e.type === "reset").length > resets, "a reset");

                c.bus.emit({ branchId: "branch-a", kind: "message" });
                await waitFor(() => changes(onC).length === 2, "in-process delivery");
                expect(c.cursorOf(changes(onC)[1]?.id)).toMatch(RING_CURSOR);
                expect(await admin.xlen(key)).toBe(1); // the second batch never reached the stream

                await admin.call("ACL", "SETUSER", user, "+info");
                await waitFor(() => c.transport.activeMode === "valkey", "the stream path to return");
                c.bus.emit({ branchId: "branch-a", kind: "call" });
                await waitFor(() => changes(onC).length === 3, "delivery on the stream again");
                expect(c.cursorOf(changes(onC)[2]?.id)).toMatch(STREAM_CURSOR);
            } finally {
                c.destroy();
                await admin.call("ACL", "DELUSER", user);
                await admin.del(key, `${key}:incarnation`);
            }
        });
    });

    describe("reader overrunning retention", () => {
        // One atomic script: an own-branch document hint, then 10,200 other-branch batches (the stream trims
        // the hint away), then an own-branch call hint that survives. The reader cannot run in between.
        // The entries carry the stream's own incarnation (`g`), as a writer of ours would stamp them.
        const OVERRUN = `
            local g = redis.call('HGET', KEYS[2], 'inc')
            redis.call('XADD', KEYS[1], '*', 'b', 'branch-a', 'e', '["document"]', 'g', g)
            for i = 1, 10200 do
              redis.call('XADD', KEYS[1], 'MAXLEN', '~', '10000', '*', 'b', 'branch-b', 'e', '["employee"]', 'g', g)
            end
            redis.call('XADD', KEYS[1], 'MAXLEN', '~', '10000', '*', 'b', 'branch-a', 'e', '["call"]', 'g', g)
            return 1
        `;

        it("sends a reset before the surviving batch, never delivers the trimmed hint, and a resume from the post-reset token is honoured", async () => {
            const onB = b.subscribe("branch-a");
            a.bus.emit({ branchId: "branch-a", kind: "client" });
            await waitFor(() => changes(onB).length === 1, "reader is positioned on the stream");
            const messagesBefore = onB.length;

            await admin.eval(OVERRUN, 2, streamKey, `${streamKey}:incarnation`);
            const rows = await admin.xrange(streamKey, "-", "+");
            expect(rows.some(([, fields]) => fields.includes('["document"]'))).toBe(false); // really trimmed away
            await waitFor(() => changes(onB).some((e) => JSON.stringify(e.data) === '{"entities":["call"]}'), "the surviving call batch", 15000);

            const after = onB.slice(messagesBefore);
            const resetIndex = after.findIndex((e) => e.type === "reset");
            const callIndex = after.findIndex((e) => e.type === "entity-changed");
            expect(resetIndex).toBeGreaterThanOrEqual(0);
            expect(resetIndex).toBeLessThan(callIndex); // the client is told before it sees survivors
            expect(after.some((e) => e.type === "entity-changed" && JSON.stringify(e.data).includes("document"))).toBe(false);

            const resetToken = after[resetIndex]?.id as string;
            const callToken = after[callIndex]?.id as string;
            const fromReset = await reconnect(b, "branch-a", resetToken);
            const fromCall = await reconnect(b, "branch-a", callToken);
            expect(fromReset[0]?.data).toEqual({ resumed: true });
            expect(fromCall[0]?.data).toEqual({ resumed: true });
            expect(changes(fromCall)).toHaveLength(0);
        });

        it("a reader that has kept up is not reset by normal trimming", async () => {
            const onB = b.subscribe("branch-a");
            for (let i = 0; i < 3; i += 1) {
                a.bus.emit({ branchId: "branch-a", kind: "client" });
                await waitFor(() => changes(onB).length === i + 1, "batch");
                await pause(30);
            }
            await admin.xtrim(streamKey, "MAXLEN", 1);
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => changes(onB).length === 4, "batch after the trim");

            expect(onB.filter((e) => e.type === "reset")).toEqual([]);
        });
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
            // Every entry also carries the incarnation (`g`) that proves it was written by this transport.
            const g = incarnationOf(b.transport.position());
            expect(rows.map(([, fields]) => fields)).toEqual([
                ["e", '["settings"]', "g", g],
                ["b", "", "e", '["client"]', "g", g],
                ["b", "branch-a", "e", '["message"]', "g", g],
            ]);
        } finally {
            sub.unsubscribe();
        }
    });

    it("skips an entry of ours whose body is malformed instead of delivering or crashing, and keeps reading", async () => {
        const seen: DeliveredBatch[] = [];
        const sub = b.transport.signals$.subscribe((s: TransportSignal) => {
            if (s.type === "batch") seen.push(s);
        });
        try {
            // One batch through the transport first: a stream nobody has written to yet ("origin") that suddenly
            // holds entries is somebody else's doing, so the raw fixtures below only count as ours after this.
            a.bus.emit({ branchId: "branch-a", kind: "call" });
            await waitFor(() => seen.length === 1, "the transport's own batch");
            const g = incarnationOf(b.transport.position());
            await admin.xadd(streamKey, "*", "b", "x", "unexpected", "1", "e", '["client"]', "g", g);
            await admin.xadd(streamKey, "*", "e", '["not-a-kind"]', "g", g);
            a.bus.emit({ branchId: "branch-a", kind: "message" });
            await waitFor(() => seen.length === 2, "the well-formed batch");

            expect(seen[1]).toMatchObject({ branchId: "branch-a", entities: ["message"] });
            expect(incarnationOf(b.transport.position())).toBe(g); // our own bad entries are not a foreign writer
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
