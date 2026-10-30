import { MessageEvent } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Observable, Subject } from "rxjs";

import type { EntityChangedEvent, EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { CursorCodec } from "infrastructure/realtime/entity-change-cursor-codec";
import type {
    DeliveredBatch,
    EntityChangeTransport,
    ReplayResult,
    TransportSignal,
} from "infrastructure/realtime/entity-change-transport";
import { InProcessEntityChangeTransport } from "infrastructure/realtime/in-process-entity-change-transport";
import { RealtimeController } from "./realtime.controller";

type Received = Array<MessageEvent & { id?: string }>;

/** Lets the controller's `replayAfter(...).then(...)` run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function setup(capacity?: number) {
    const subject = new Subject<EntityChangedEvent>();
    const bus = { events$: subject.asObservable() } as unknown as EntityChangeEventBus;
    const transport = new InProcessEntityChangeTransport(bus, capacity);
    const controller = new RealtimeController(bus, transport);
    const epoch = transport.ring.epoch;
    /** Internal cursor of the n-th batch; clients only ever see opaque tokens of it. */
    const cursor = (seq: number) => `${epoch}:${seq}`;
    /** A token a client could send to resume after the n-th batch. */
    const token = (seq: number) => transport.cursors.encode(cursor(seq));
    /** The internal cursor behind a message id. */
    const cursorOf = (id: string | undefined) => (id === undefined ? undefined : transport.cursors.decode(id));
    /** A message list with every id decrypted back to the internal cursor. */
    const view = (received: Received) => received.map((e) => ({ ...e, id: cursorOf(e.id) }));
    const subscribe = (branchId: string, since?: string, lastEventId?: string) => {
        const received: Received = [];
        const subscription = controller.events({ branchId }, since, lastEventId).subscribe((e) => received.push(e));
        return { received, subscription };
    };
    return { subject, bus, transport, controller, epoch, cursor, token, cursorOf, view, subscribe };
}

describe("RealtimeController", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    describe("fresh connection", () => {
        it("opens with ready {resumed:false} whose id is a token of the transport's current position", () => {
            const { subject, subscribe, cursor, view } = setup();
            subject.next({ branchId: "branch-a", entities: ["client"] });
            subject.next({ branchId: "branch-a", entities: ["client"] });

            const a = subscribe("branch-a");

            expect(view(a.received)).toEqual([{ id: cursor(2), type: "ready", data: { resumed: false } }]);
            a.subscription.unsubscribe();
        });

        it("delivers an event for the subscriber's own branch as entity-changed with its cursor id and only the entities", () => {
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");

            subject.next({ branchId: "branch-a", entities: ["client", "message"] });

            expect(view(a.received).slice(1)).toEqual([
                { id: cursor(1), type: "entity-changed", data: { entities: ["client", "message"] } },
            ]);
            expect(JSON.stringify(a.received)).not.toContain("branch-a");
            a.subscription.unsubscribe();
        });

        it("does not deliver another branch's event", () => {
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");
            const b = subscribe("branch-b");

            subject.next({ branchId: "branch-b", entities: ["employee"] });

            expect(a.received.map((e) => e.type)).toEqual(["ready"]);
            expect(view(b.received).slice(1)).toEqual([
                { id: cursor(1), type: "entity-changed", data: { entities: ["employee"] } },
            ]);
            a.subscription.unsubscribe();
            b.subscription.unsubscribe();
        });

        it("delivers a null-branch (broadcast) event to every subscriber", () => {
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");
            const b = subscribe("branch-b");

            subject.next({ branchId: null, entities: ["message"] });

            const expected = [{ id: cursor(1), type: "entity-changed", data: { entities: ["message"] } }];
            expect(view(a.received).slice(1)).toEqual(expected);
            expect(view(b.received).slice(1)).toEqual(expected);
            a.subscription.unsubscribe();
            b.subscription.unsubscribe();
        });

        it("gives every entity-changed message its own distinct cursor id", () => {
            const { subject, subscribe, cursor, cursorOf } = setup();
            const a = subscribe("branch-a");

            subject.next({ branchId: "branch-a", entities: ["client"] });
            subject.next({ branchId: null, entities: ["settings"] });
            subject.next({ branchId: "branch-a", entities: ["document"] });

            const ids = a.received.filter((e) => e.type === "entity-changed").map((e) => e.id as string);
            expect(ids.map(cursorOf)).toEqual([cursor(1), cursor(2), cursor(3)]);
            expect(new Set(ids).size).toBe(3);
            a.subscription.unsubscribe();
        });

        it("an unscoped tenant (no branchId) still receives broadcasts and is never matched to a real branch", () => {
            const { subject, controller } = setup();
            const received: Received = [];
            const subscription = controller.events({}).subscribe((e) => received.push(e));

            subject.next({ branchId: "branch-a", entities: ["client"] });
            subject.next({ branchId: null, entities: ["settings"] });

            expect(received.filter((e) => e.type === "entity-changed").map((e) => e.data)).toEqual([
                { entities: ["settings"] },
            ]);
            subscription.unsubscribe();
        });

        it("works with one argument and no transport: the controller builds its own in-process transport", () => {
            const subject = new Subject<EntityChangedEvent>();
            const controller = new RealtimeController({ events$: subject.asObservable() } as unknown as EntityChangeEventBus);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }).subscribe((e) => received.push(e));

            subject.next({ branchId: "branch-a", entities: ["client"] });

            expect(received.map((e) => e.type)).toEqual(["ready", "entity-changed"]);
            expect(received[1]?.data).toEqual({ entities: ["client"] });
            subscription.unsubscribe();
        });
    });

    describe("ids are opaque tokens that fit the client contract", () => {
        // The desktop and mobile proxies validate a cursor with exactly this expression.
        const CLIENT_CURSOR = /^[0-9A-Za-z:._-]{1,64}$/;

        it("every id the controller sends (ready, entity-changed, ping, reset) is accepted by the client validator", () => {
            jest.useFakeTimers();
            const { subject, transport, subscribe } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-a", entities: ["client"] });
            jest.advanceTimersByTime(30000);

            expect(a.received.map((e) => e.type)).toEqual(["ready", "entity-changed", "ping"]);
            for (const message of a.received) {
                expect(message.id).toMatch(CLIENT_CURSOR);
                expect(transport.cursors.decode(message.id as string)).not.toBeNull();
            }
            a.subscription.unsubscribe();
        });

        it("a token does not expose the raw cursor (no epoch, no sequence)", () => {
            const { subject, subscribe, epoch } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-a", entities: ["client"] });

            for (const message of a.received) {
                expect(message.id).not.toContain(epoch);
                expect(message.id).not.toMatch(/\d+:\d+|\d+-\d+/);
            }
            a.subscription.unsubscribe();
        });
    });

    describe("position and ping", () => {
        it("emits a ping every 30s with an epoch-ms timestamp, whose id is the connection position", () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date("2026-10-28T00:00:00Z"));
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-a", entities: ["client"] });

            jest.advanceTimersByTime(30000);

            expect(view(a.received).at(-1)).toEqual({
                id: cursor(1),
                type: "ping",
                data: { at: new Date("2026-10-28T00:00:30Z").getTime() },
            });
            a.subscription.unsubscribe();
        });

        it("a ping on an unchanged position reuses the token of the last message (identical id)", () => {
            jest.useFakeTimers();
            const { subject, subscribe } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-a", entities: ["client"] });

            jest.advanceTimersByTime(90000);

            const changed = a.received.find((e) => e.type === "entity-changed");
            const pings = a.received.filter((e) => e.type === "ping");
            expect(pings).toHaveLength(3);
            expect(pings.map((p) => p.id)).toEqual([changed?.id, changed?.id, changed?.id]);
            a.subscription.unsubscribe();
        });

        it("only branch B writing: branch A's connection sees no id change on ping or anything else", () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");
            const readyId = a.received[0]?.id;

            subject.next({ branchId: "branch-b", entities: ["employee"] });
            jest.advanceTimersByTime(30000);
            subject.next({ branchId: "branch-b", entities: ["client"] });
            subject.next({ branchId: "branch-b", entities: ["message"] });
            jest.advanceTimersByTime(30000);

            expect(a.received.map((e) => e.type)).toEqual(["ready", "ping", "ping"]);
            expect(new Set(a.received.map((e) => e.id))).toEqual(new Set([readyId]));
            expect(view(a.received).every((e) => e.id === cursor(0))).toBe(true);
            a.subscription.unsubscribe();
        });

        it("the position moves again only when A itself receives something", () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor, view } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-b", entities: ["employee"] });

            subject.next({ branchId: "branch-a", entities: ["document"] });
            jest.advanceTimersByTime(30000);

            expect(view(a.received).slice(1)).toEqual([
                { id: cursor(2), type: "entity-changed", data: { entities: ["document"] } },
                expect.objectContaining({ id: cursor(2), type: "ping" }),
            ]);
            a.subscription.unsubscribe();
        });

        it("after only-B writes, reconnecting with the old token resumes: new ready id, no B batches replayed, position scanned forward", async () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor, cursorOf } = setup();
            const first = subscribe("branch-a");
            const oldToken = first.received[0]?.id as string;
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            first.subscription.unsubscribe();

            const second = subscribe("branch-a", oldToken);
            await settle();

            expect(second.received.map((e) => [e.type, e.data])).toEqual([["ready", { resumed: true }]]);
            expect(second.received[0]?.id).not.toBe(oldToken);
            expect(cursorOf(second.received[0]?.id)).toBe(cursor(0));
            // Nothing is sent for the scanned B batches, but the connection's position now sits past them.
            jest.advanceTimersByTime(30000);
            const ping = second.received.at(-1);
            expect(ping?.type).toBe("ping");
            expect(cursorOf(ping?.id)).toBe(cursor(2));
            second.subscription.unsubscribe();
        });

        it("resuming from a ping id (quiet branch) replays nothing and loses nothing", async () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor, view } = setup();
            const first = subscribe("branch-a");
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            jest.advanceTimersByTime(30000);
            const pingId = first.received.find((e) => e.type === "ping")?.id as string;
            first.subscription.unsubscribe();

            subject.next({ branchId: "branch-b", entities: ["client"] });
            const second = subscribe("branch-a", pingId);
            await settle();
            expect(view(second.received)).toEqual([{ id: cursor(0), type: "ready", data: { resumed: true } }]);

            subject.next({ branchId: "branch-a", entities: ["document"] });
            expect(view(second.received).slice(1)).toEqual([
                { id: cursor(4), type: "entity-changed", data: { entities: ["document"] } },
            ]);
            second.subscription.unsubscribe();
        });
    });

    describe("replay with ?since", () => {
        function seedFour(subject: Subject<EntityChangedEvent>) {
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1
            subject.next({ branchId: "branch-b", entities: ["employee"] }); // 2: not for branch-a
            subject.next({ branchId: null, entities: ["message"] }); // 3: broadcast
            subject.next({ branchId: "branch-a", entities: ["document"] }); // 4
        }

        it("replays the retained batches after the cursor that this branch may see, in order, each with its own id", async () => {
            const { subject, subscribe, cursor, token, view } = setup();
            seedFour(subject);

            const a = subscribe("branch-a", token(1));
            await settle();

            expect(view(a.received)).toEqual([
                { id: cursor(1), type: "ready", data: { resumed: true } },
                { id: cursor(3), type: "entity-changed", data: { entities: ["message"] } },
                { id: cursor(4), type: "entity-changed", data: { entities: ["document"] } },
            ]);
            a.subscription.unsubscribe();
        });

        it("filters the replay by branch: branch B gets its own and the broadcast, not branch A's", async () => {
            const { subject, subscribe, cursor, token, view } = setup();
            seedFour(subject);

            const b = subscribe("branch-b", token(0));
            await settle();

            expect(view(b.received).map((e) => [e.id, e.type])).toEqual([
                [cursor(0), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            b.subscription.unsubscribe();
        });

        it("continues live after the replay", async () => {
            const { subject, subscribe, cursor, token, view } = setup();
            seedFour(subject);
            const a = subscribe("branch-a", token(4));
            await settle();
            expect(view(a.received)).toEqual([{ id: cursor(4), type: "ready", data: { resumed: true } }]);

            subject.next({ branchId: "branch-a", entities: ["call"] });

            expect(view(a.received).at(-1)).toEqual({ id: cursor(5), type: "entity-changed", data: { entities: ["call"] } });
            a.subscription.unsubscribe();
        });

        it("accepts the token from the Last-Event-ID header", async () => {
            const { subject, subscribe, cursor, token, view } = setup();
            seedFour(subject);

            const a = subscribe("branch-a", undefined, token(3));
            await settle();

            expect(view(a.received).map((e) => [e.id, e.type, (e.data as { resumed?: boolean }).resumed])).toEqual([
                [cursor(3), "ready", true],
                [cursor(4), "entity-changed", undefined],
            ]);
            a.subscription.unsubscribe();
        });

        it("the query wins over the header, even when the query is the unusable one", async () => {
            const { subject, subscribe, token } = setup();
            seedFour(subject);

            const queryGood = subscribe("branch-a", token(3), "garbage-header");
            const queryBad = subscribe("branch-a", "garbage-query", token(3));
            await settle();

            expect(queryGood.received[0]?.data).toEqual({ resumed: true });
            expect(queryBad.received[0]?.data).toEqual({ resumed: false });
            queryGood.subscription.unsubscribe();
            queryBad.subscription.unsubscribe();
        });

        describe("unusable tokens are not honoured: ready {resumed:false}, no replay, position is the current one", () => {
            const foreign = new CursorCodec(randomBytes(32));
            const tamper = (token: string) => `${token.slice(0, 20)}${token[20] === "A" ? "B" : "A"}${token.slice(21)}`;

            it.each<[string, (ctx: ReturnType<typeof setup>) => string]>([
                ["malformed (charset)", () => "not a cursor!"],
                ["malformed (too long)", () => "a".repeat(65)],
                ["a raw internal cursor instead of a token", ({ cursor }) => cursor(1)],
                ["a raw Valkey stream id", () => "1700000000000-0"],
                ["a token under another key", ({ cursor }) => foreign.encode(cursor(1))],
                ["a tampered token", ({ token }) => tamper(token(1))],
                ["a truncated token", ({ token }) => token(1).slice(0, -4)],
                ["a token with the wrong length", () => randomBytes(30).toString("base64url")],
                ["a valid token of another process epoch", ({ transport }) => transport.cursors.encode("deadbeef0000:1")],
                ["a valid token of the Valkey id space", ({ transport }) => transport.cursors.encode("1700000000000-0")],
                ["a valid token ahead of anything this process issued", ({ transport, epoch }) => transport.cursors.encode(`${epoch}:99`)],
            ])("%s", async (_label, build) => {
                const ctx = setup();
                seedFour(ctx.subject);

                const a = ctx.subscribe("branch-a", build(ctx));
                await settle();

                expect(ctx.view(a.received)).toEqual([{ id: ctx.cursor(4), type: "ready", data: { resumed: false } }]);
                a.subscription.unsubscribe();
            });
        });

        it("an expired token (older than the ring still holds) is not honoured, while the oldest honourable one is", async () => {
            const { subject, subscribe, cursor, token, view } = setup(2);
            seedFour(subject); // ring holds 3 and 4

            const expired = subscribe("branch-a", token(1));
            const oldestHonourable = subscribe("branch-a", token(2));
            await settle();

            expect(view(expired.received)).toEqual([{ id: cursor(4), type: "ready", data: { resumed: false } }]);
            expect(view(oldestHonourable.received).map((e) => [e.id, e.type])).toEqual([
                [cursor(2), "ready"],
                [cursor(3), "entity-changed"],
                [cursor(4), "entity-changed"],
            ]);
            expired.subscription.unsubscribe();
            oldestHonourable.subscription.unsubscribe();
        });

        it("a cursor without since never produces resumed:true", () => {
            const { subject, subscribe } = setup();
            seedFour(subject);
            const a = subscribe("branch-a", "", "");
            expect(a.received[0]?.data).toEqual({ resumed: false });
            a.subscription.unsubscribe();
        });
    });

    describe("live + replay without duplicate or gap", () => {
        /** A transport whose replay answer is computed immediately but delivered only when `release()` is called. */
        function gatedTransport(inner: InProcessEntityChangeTransport, snapshotAtCall: boolean) {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const wrapper: EntityChangeTransport = {
                signals$: inner.signals$,
                cursors: inner.cursors,
                position: () => inner.position(),
                replayAfter: async (since) => {
                    const snapshot = snapshotAtCall ? await inner.replayAfter(since) : null;
                    await gate;
                    return snapshot ?? inner.replayAfter(since);
                },
            };
            return { wrapper, release };
        }

        function build(snapshotAtCall: boolean) {
            const subject = new Subject<EntityChangedEvent>();
            const bus = { events$: subject.asObservable() } as unknown as EntityChangeEventBus;
            const inner = new InProcessEntityChangeTransport(bus);
            const { wrapper, release } = gatedTransport(inner, snapshotAtCall);
            const controller = new RealtimeController(bus, wrapper);
            const cursor = (seq: number) => `${inner.ring.epoch}:${seq}`;
            const token = (seq: number) => inner.cursors.encode(cursor(seq));
            const view = (received: Received) =>
                received.map((e) => [inner.cursors.decode(e.id as string), e.type]);
            const received: Received = [];
            return { subject, controller, release, cursor, token, view, received };
        }

        it("a batch emitted while the retained range is read and also contained in it is delivered once", async () => {
            const { subject, controller, release, cursor, token, view, received } = build(false);
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1
            subject.next({ branchId: "branch-a", entities: ["message"] }); // 2

            const subscription = controller.events({ branchId: "branch-a" }, token(1)).subscribe((e) => received.push(e));
            subject.next({ branchId: "branch-a", entities: ["document"] }); // 3, arrives during the read
            release();
            await settle();

            expect(view(received)).toEqual([
                [cursor(1), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            subscription.unsubscribe();
        });

        it("a batch emitted while the retained range is read and NOT contained in it is not lost", async () => {
            const { subject, controller, release, cursor, token, view, received } = build(true);
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1
            subject.next({ branchId: "branch-a", entities: ["message"] }); // 2

            const subscription = controller.events({ branchId: "branch-a" }, token(1)).subscribe((e) => received.push(e));
            await settle();
            subject.next({ branchId: "branch-a", entities: ["document"] }); // 3, after the range was read
            release();
            await settle();

            expect(view(received)).toEqual([
                [cursor(1), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            subscription.unsubscribe();
        });

        it("a branch-B batch arriving during the read is not sent, and the scan carries the position past it", async () => {
            jest.useFakeTimers();
            const { subject, controller, release, cursor, token, view, received } = build(true);
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1

            const subscription = controller.events({ branchId: "branch-a" }, token(1)).subscribe((e) => received.push(e));
            await settle();
            subject.next({ branchId: "branch-b", entities: ["employee"] }); // 2, hidden
            release();
            await settle();
            jest.advanceTimersByTime(30000);

            // ready still names the cursor the client sent; the ping after the scan names the scan's end.
            expect(view(received)).toEqual([
                [cursor(1), "ready"],
                [cursor(2), "ping"],
            ]);
            subscription.unsubscribe();
        });
    });

    describe("cursor ordering and resets (scripted transport)", () => {
        const codec = new CursorCodec(randomBytes(32));
        class ScriptedTransport implements EntityChangeTransport {
            readonly subject = new Subject<TransportSignal>();
            readonly signals$: Observable<TransportSignal> = this.subject.asObservable();
            readonly cursors = codec;
            current = "100-0";
            result: ReplayResult = { honoured: false };
            position(): string {
                return this.current;
            }
            replayAfter(): Promise<ReplayResult> {
                return Promise.resolve(this.result);
            }
        }
        const batch = (cursor: string, branchId: string | null = "branch-a"): DeliveredBatch => ({
            type: "batch",
            cursor,
            branchId,
            entities: ["client"],
        });
        const idsAndTypes = (received: Received) => received.map((e) => [codec.decode(e.id as string), e.type]);

        it("compares cursors numerically: 100-10 follows 100-9 and is not dropped as a duplicate, 100-9 is", async () => {
            const transport = new ScriptedTransport();
            transport.result = { honoured: true, batches: [batch("100-9")] };
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, codec.encode("100-8")).subscribe((e) => received.push(e));

            transport.subject.next(batch("100-9")); // held, duplicate of the replayed one
            transport.subject.next(batch("100-10")); // held, newer: string order would wrongly drop it
            await settle();

            expect(idsAndTypes(received)).toEqual([
                ["100-8", "ready"],
                ["100-9", "entity-changed"],
                ["100-10", "entity-changed"],
            ]);
            subscription.unsubscribe();
        });

        it("forwards a mid-stream reset as event: reset with a token of the new position and an empty object", async () => {
            const transport = new ScriptedTransport();
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }).subscribe((e) => received.push(e));

            transport.subject.next(batch("100-1"));
            transport.subject.next({ type: "reset", position: "abcdef012345:0" });
            transport.subject.next({ type: "batch", cursor: "abcdef012345:1", branchId: "branch-a", entities: ["call"] });

            expect(received.map((e) => [codec.decode(e.id as string), e.type, e.data])).toEqual([
                ["100-0", "ready", { resumed: false }],
                ["100-1", "entity-changed", { entities: ["client"] }],
                ["abcdef012345:0", "reset", {}],
                ["abcdef012345:1", "entity-changed", { entities: ["call"] }],
            ]);
            subscription.unsubscribe();
        });

        it("a reset that arrives during the replay read is delivered after ready and the replay", async () => {
            const transport = new ScriptedTransport();
            transport.result = { honoured: true, batches: [batch("100-9")] };
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, codec.encode("100-8")).subscribe((e) => received.push(e));

            transport.subject.next({ type: "reset", position: "abcdef012345:0" });
            await settle();

            expect(idsAndTypes(received)).toEqual([
                ["100-8", "ready"],
                ["100-9", "entity-changed"],
                ["abcdef012345:0", "reset"],
            ]);
            subscription.unsubscribe();
        });

        it("a replay that fails is treated as unavailable: ready {resumed:false}", async () => {
            const transport = new ScriptedTransport();
            transport.replayAfter = () => Promise.reject(new Error("valkey down"));
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, codec.encode("100-8")).subscribe((e) => received.push(e));
            await settle();

            expect(received.map((e) => [codec.decode(e.id as string), e.type, e.data])).toEqual([
                ["100-0", "ready", { resumed: false }],
            ]);
            subscription.unsubscribe();
        });

        it("ends the stream when the transport completes (shutdown)", () => {
            const transport = new ScriptedTransport();
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            let completed = false;
            const subscription = controller.events({ branchId: "branch-a" }).subscribe({ complete: () => (completed = true) });

            transport.subject.complete();

            expect(completed).toBe(true);
            subscription.unsubscribe();
        });
    });
});
