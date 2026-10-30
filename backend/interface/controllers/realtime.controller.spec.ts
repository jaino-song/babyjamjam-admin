import { MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

import type { EntityChangedEvent, EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
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
    const cursor = (seq: number) => `${epoch}:${seq}`;
    const subscribe = (branchId: string, since?: string, lastEventId?: string) => {
        const received: Received = [];
        const subscription = controller.events({ branchId }, since, lastEventId).subscribe((e) => received.push(e));
        return { received, subscription };
    };
    return { subject, bus, transport, controller, epoch, cursor, subscribe };
}

describe("RealtimeController", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    describe("fresh connection", () => {
        it("opens with ready {resumed:false} whose id is the transport's current position", () => {
            const { subject, subscribe, cursor } = setup();
            subject.next({ branchId: "branch-a", entities: ["client"] });
            subject.next({ branchId: "branch-a", entities: ["client"] });

            const a = subscribe("branch-a");

            expect(a.received).toEqual([{ id: cursor(2), type: "ready", data: { resumed: false } }]);
            a.subscription.unsubscribe();
        });

        it("delivers an event for the subscriber's own branch as entity-changed with its cursor id and only the entities", () => {
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");

            subject.next({ branchId: "branch-a", entities: ["client", "message"] });

            expect(a.received.slice(1)).toEqual([
                { id: cursor(1), type: "entity-changed", data: { entities: ["client", "message"] } },
            ]);
            expect(JSON.stringify(a.received)).not.toContain("branch-a");
            a.subscription.unsubscribe();
        });

        it("does not deliver another branch's event", () => {
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");
            const b = subscribe("branch-b");

            subject.next({ branchId: "branch-b", entities: ["employee"] });

            expect(a.received.map((e) => e.type)).toEqual(["ready"]);
            expect(b.received.slice(1)).toEqual([
                { id: cursor(1), type: "entity-changed", data: { entities: ["employee"] } },
            ]);
            a.subscription.unsubscribe();
            b.subscription.unsubscribe();
        });

        it("delivers a null-branch (broadcast) event to every subscriber", () => {
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");
            const b = subscribe("branch-b");

            subject.next({ branchId: null, entities: ["message"] });

            const expected = [{ id: cursor(1), type: "entity-changed", data: { entities: ["message"] } }];
            expect(a.received.slice(1)).toEqual(expected);
            expect(b.received.slice(1)).toEqual(expected);
            a.subscription.unsubscribe();
            b.subscription.unsubscribe();
        });

        it("gives every entity-changed message its own distinct cursor id", () => {
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");

            subject.next({ branchId: "branch-a", entities: ["client"] });
            subject.next({ branchId: null, entities: ["settings"] });
            subject.next({ branchId: "branch-a", entities: ["document"] });

            expect(a.received.filter((e) => e.type === "entity-changed").map((e) => e.id)).toEqual([
                cursor(1),
                cursor(2),
                cursor(3),
            ]);
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

    describe("position and ping", () => {
        it("emits a ping every 30s with an epoch-ms timestamp, whose id is the connection position", () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date("2026-10-28T00:00:00Z"));
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");
            subject.next({ branchId: "branch-a", entities: ["client"] });

            jest.advanceTimersByTime(30000);

            expect(a.received.at(-1)).toEqual({
                id: cursor(1),
                type: "ping",
                data: { at: new Date("2026-10-28T00:00:30Z").getTime() },
            });
            a.subscription.unsubscribe();
        });

        it("another branch's batches advance the position (ping id) without being sent", () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor } = setup();
            const a = subscribe("branch-a");

            subject.next({ branchId: "branch-b", entities: ["employee"] });
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            jest.advanceTimersByTime(30000);

            expect(a.received.map((e) => e.type)).toEqual(["ready", "ping"]);
            expect(a.received[0]?.id).toBe(cursor(0));
            expect(a.received[1]?.id).toBe(cursor(2));
            a.subscription.unsubscribe();
        });

        it("resuming from a ping id (quiet branch) replays nothing and loses nothing", async () => {
            jest.useFakeTimers();
            const { subject, subscribe, cursor } = setup();
            const first = subscribe("branch-a");
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            subject.next({ branchId: "branch-b", entities: ["employee"] });
            jest.advanceTimersByTime(30000);
            const pingId = first.received.find((e) => e.type === "ping")?.id as string;
            first.subscription.unsubscribe();

            subject.next({ branchId: "branch-b", entities: ["client"] });
            const second = subscribe("branch-a", pingId);
            await settle();
            expect(second.received).toEqual([{ id: pingId, type: "ready", data: { resumed: true } }]);

            subject.next({ branchId: "branch-a", entities: ["document"] });
            expect(second.received.slice(1)).toEqual([
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
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);

            const a = subscribe("branch-a", cursor(1));
            await settle();

            expect(a.received).toEqual([
                { id: cursor(1), type: "ready", data: { resumed: true } },
                { id: cursor(3), type: "entity-changed", data: { entities: ["message"] } },
                { id: cursor(4), type: "entity-changed", data: { entities: ["document"] } },
            ]);
            a.subscription.unsubscribe();
        });

        it("filters the replay by branch: branch B gets its own and the broadcast, not branch A's", async () => {
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);

            const b = subscribe("branch-b", cursor(0));
            await settle();

            expect(b.received.map((e) => [e.id, e.type])).toEqual([
                [cursor(0), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            b.subscription.unsubscribe();
        });

        it("continues live after the replay", async () => {
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);
            const a = subscribe("branch-a", cursor(4));
            await settle();
            expect(a.received).toEqual([{ id: cursor(4), type: "ready", data: { resumed: true } }]);

            subject.next({ branchId: "branch-a", entities: ["call"] });

            expect(a.received.at(-1)).toEqual({ id: cursor(5), type: "entity-changed", data: { entities: ["call"] } });
            a.subscription.unsubscribe();
        });

        it("accepts the cursor from the Last-Event-ID header", async () => {
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);

            const a = subscribe("branch-a", undefined, cursor(3));
            await settle();

            expect(a.received.map((e) => [e.id, e.type, (e.data as { resumed?: boolean }).resumed])).toEqual([
                [cursor(3), "ready", true],
                [cursor(4), "entity-changed", undefined],
            ]);
            a.subscription.unsubscribe();
        });

        it("the query wins over the header, even when the query is the unusable one", async () => {
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);

            const queryGood = subscribe("branch-a", cursor(3), "deadbeef0000:1");
            const queryBad = subscribe("branch-a", "deadbeef0000:1", cursor(3));
            await settle();

            expect(queryGood.received[0]?.data).toEqual({ resumed: true });
            expect(queryBad.received[0]?.data).toEqual({ resumed: false });
            queryGood.subscription.unsubscribe();
            queryBad.subscription.unsubscribe();
        });

        it.each([
            ["malformed (charset)", "not a cursor!"],
            ["malformed (too long)", "a".repeat(65)],
            ["from another process epoch", "deadbeef0000:1"],
            ["a Valkey stream id (other id space)", "1700000000000-0"],
            ["ahead of anything this process issued", "FUTURE"],
        ])("%s: ready {resumed:false}, no replay, position is the current one", async (_label, since) => {
            const { subject, subscribe, cursor } = setup();
            seedFour(subject);
            const sinceValue = since === "FUTURE" ? cursor(99) : since;

            const a = subscribe("branch-a", sinceValue);
            await settle();

            expect(a.received).toEqual([{ id: cursor(4), type: "ready", data: { resumed: false } }]);
            a.subscription.unsubscribe();
        });

        it("an expired cursor (older than the ring still holds) is not honoured, while the oldest honourable one is", async () => {
            const { subject, subscribe, cursor } = setup(2);
            seedFour(subject); // ring holds 3 and 4

            const expired = subscribe("branch-a", cursor(1));
            const oldestHonourable = subscribe("branch-a", cursor(2));
            await settle();

            expect(expired.received).toEqual([{ id: cursor(4), type: "ready", data: { resumed: false } }]);
            expect(oldestHonourable.received.map((e) => [e.id, e.type])).toEqual([
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
            const received: Received = [];
            return { subject, controller, release, cursor, received };
        }

        it("a batch emitted while the retained range is read and also contained in it is delivered once", async () => {
            const { subject, controller, release, cursor, received } = build(false);
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1
            subject.next({ branchId: "branch-a", entities: ["message"] }); // 2

            const subscription = controller.events({ branchId: "branch-a" }, cursor(1)).subscribe((e) => received.push(e));
            subject.next({ branchId: "branch-a", entities: ["document"] }); // 3, arrives during the read
            release();
            await settle();

            expect(received.map((e) => [e.id, e.type])).toEqual([
                [cursor(1), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            subscription.unsubscribe();
        });

        it("a batch emitted while the retained range is read and NOT contained in it is not lost", async () => {
            const { subject, controller, release, cursor, received } = build(true);
            subject.next({ branchId: "branch-a", entities: ["client"] }); // 1
            subject.next({ branchId: "branch-a", entities: ["message"] }); // 2

            const subscription = controller.events({ branchId: "branch-a" }, cursor(1)).subscribe((e) => received.push(e));
            await settle();
            subject.next({ branchId: "branch-a", entities: ["document"] }); // 3, after the range was read
            release();
            await settle();

            expect(received.map((e) => [e.id, e.type])).toEqual([
                [cursor(1), "ready"],
                [cursor(2), "entity-changed"],
                [cursor(3), "entity-changed"],
            ]);
            subscription.unsubscribe();
        });
    });

    describe("cursor ordering and resets (scripted transport)", () => {
        class ScriptedTransport implements EntityChangeTransport {
            readonly subject = new Subject<TransportSignal>();
            readonly signals$: Observable<TransportSignal> = this.subject.asObservable();
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

        it("compares cursors numerically: 100-10 follows 100-9 and is not dropped as a duplicate, 100-9 is", async () => {
            const transport = new ScriptedTransport();
            transport.result = { honoured: true, batches: [batch("100-9")] };
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, "100-8").subscribe((e) => received.push(e));

            transport.subject.next(batch("100-9")); // held, duplicate of the replayed one
            transport.subject.next(batch("100-10")); // held, newer: string order would wrongly drop it
            await settle();

            expect(received.map((e) => [e.id, e.type])).toEqual([
                ["100-8", "ready"],
                ["100-9", "entity-changed"],
                ["100-10", "entity-changed"],
            ]);
            subscription.unsubscribe();
        });

        it("forwards a mid-stream reset as event: reset with the new position as id and an empty object", async () => {
            const transport = new ScriptedTransport();
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }).subscribe((e) => received.push(e));

            transport.subject.next(batch("100-1"));
            transport.subject.next({ type: "reset", position: "epoch1:0" });
            transport.subject.next({ type: "batch", cursor: "epoch1:1", branchId: "branch-a", entities: ["call"] });

            expect(received.map((e) => [e.id, e.type, e.data])).toEqual([
                ["100-0", "ready", { resumed: false }],
                ["100-1", "entity-changed", { entities: ["client"] }],
                ["epoch1:0", "reset", {}],
                ["epoch1:1", "entity-changed", { entities: ["call"] }],
            ]);
            subscription.unsubscribe();
        });

        it("a reset that arrives during the replay read is delivered after ready and the replay", async () => {
            const transport = new ScriptedTransport();
            transport.result = { honoured: true, batches: [batch("100-9")] };
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, "100-8").subscribe((e) => received.push(e));

            transport.subject.next({ type: "reset", position: "epoch1:0" });
            await settle();

            expect(received.map((e) => [e.id, e.type])).toEqual([
                ["100-8", "ready"],
                ["100-9", "entity-changed"],
                ["epoch1:0", "reset"],
            ]);
            subscription.unsubscribe();
        });

        it("a replay that fails is treated as unavailable: ready {resumed:false}", async () => {
            const transport = new ScriptedTransport();
            transport.replayAfter = () => Promise.reject(new Error("valkey down"));
            const controller = new RealtimeController({ events$: new Subject() } as unknown as EntityChangeEventBus, transport);
            const received: Received = [];
            const subscription = controller.events({ branchId: "branch-a" }, "100-8").subscribe((e) => received.push(e));
            await settle();

            expect(received).toEqual([{ id: "100-0", type: "ready", data: { resumed: false } }]);
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
