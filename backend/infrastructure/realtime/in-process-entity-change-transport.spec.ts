import { Subject } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { createEntityChangeTransport } from "./create-entity-change-transport";
import { InProcessEntityChangeTransport, RealtimeRingBuffer } from "./in-process-entity-change-transport";
import type { TransportSignal } from "./entity-change-transport";
import { ValkeyEntityChangeTransport } from "./valkey-entity-change-transport";

const event = (branchId: string | null, kind: EntityChangedEvent["entities"][number] = "client"): EntityChangedEvent => ({
    branchId,
    entities: [kind],
});

describe("RealtimeRingBuffer", () => {
    it("stamps batches with <epoch>:<seq> starting at 1 and reports the newest as the position", () => {
        const ring = new RealtimeRingBuffer();
        expect(ring.position()).toBe(`${ring.epoch}:0`);

        expect(ring.append(event("a")).cursor).toBe(`${ring.epoch}:1`);
        expect(ring.append(event("b")).cursor).toBe(`${ring.epoch}:2`);
        expect(ring.position()).toBe(`${ring.epoch}:2`);
    });

    it("uses a different random epoch per instance (per process boot)", () => {
        expect(new RealtimeRingBuffer().epoch).not.toBe(new RealtimeRingBuffer().epoch);
    });

    it("replays strictly after the cursor, every branch, in order", () => {
        const ring = new RealtimeRingBuffer();
        ring.append(event("a"));
        ring.append(event("b", "employee"));
        ring.append(event(null, "settings"));

        const result = ring.replayAfter(`${ring.epoch}:1`);

        expect(result.honoured).toBe(true);
        expect(result.honoured && result.batches.map((b) => [b.cursor, b.branchId, b.entities])).toEqual([
            [`${ring.epoch}:2`, "b", ["employee"]],
            [`${ring.epoch}:3`, null, ["settings"]],
        ]);
    });

    it("honours the newest cursor with an empty replay and the origin cursor on an empty ring", () => {
        const empty = new RealtimeRingBuffer();
        expect(empty.replayAfter(`${empty.epoch}:0`)).toEqual({ honoured: true, batches: [] });

        const ring = new RealtimeRingBuffer();
        ring.append(event("a"));
        expect(ring.replayAfter(`${ring.epoch}:1`)).toEqual({ honoured: true, batches: [] });
    });

    it("does not honour an expired, future, foreign-epoch or malformed cursor", () => {
        const ring = new RealtimeRingBuffer(2);
        for (let i = 0; i < 5; i += 1) ring.append(event("a"));
        // retained: 4, 5

        expect(ring.replayAfter(`${ring.epoch}:2`)).toEqual({ honoured: false });
        expect(ring.replayAfter(`${ring.epoch}:3`).honoured).toBe(true);
        expect(ring.replayAfter(`${ring.epoch}:6`)).toEqual({ honoured: false });
        expect(ring.replayAfter("deadbeef0000:5")).toEqual({ honoured: false });
        expect(ring.replayAfter("1700000000000-0")).toEqual({ honoured: false });
        expect(ring.replayAfter("%%%")).toEqual({ honoured: false });
    });
});

describe("InProcessEntityChangeTransport", () => {
    it("delivers each bus batch synchronously, with a cursor, to every subscriber", () => {
        const bus = new Subject<EntityChangedEvent>();
        const transport = new InProcessEntityChangeTransport({ events$: bus.asObservable() });
        const first: TransportSignal[] = [];
        const second: TransportSignal[] = [];
        transport.signals$.subscribe((s) => first.push(s));
        transport.signals$.subscribe((s) => second.push(s));

        bus.next(event("a", "message"));

        const expected = [{ type: "batch", cursor: `${transport.ring.epoch}:1`, branchId: "a", entities: ["message"] }];
        expect(first).toEqual(expected);
        expect(second).toEqual(expected);
        expect(transport.position()).toBe(`${transport.ring.epoch}:1`);
    });

    it("replays from its ring", async () => {
        const bus = new Subject<EntityChangedEvent>();
        const transport = new InProcessEntityChangeTransport({ events$: bus.asObservable() });
        bus.next(event("a"));
        bus.next(event("b"));

        const result = await transport.replayAfter(`${transport.ring.epoch}:1`);

        expect(result.honoured && result.batches.map((b) => b.branchId)).toEqual(["b"]);
    });

    it("stops listening to the bus and completes its stream on destroy", () => {
        const bus = new Subject<EntityChangedEvent>();
        const transport = new InProcessEntityChangeTransport({ events$: bus.asObservable() });
        const seen: TransportSignal[] = [];
        let completed = false;
        transport.signals$.subscribe({ next: (s) => seen.push(s), complete: () => (completed = true) });

        transport.onModuleDestroy();
        bus.next(event("a"));

        expect(seen).toEqual([]);
        expect(completed).toBe(true);
    });
});

describe("createEntityChangeTransport", () => {
    const bus = { events$: new Subject<EntityChangedEvent>().asObservable() };

    it("is in-process without VALKEY_URL (unset, empty or blank)", () => {
        for (const env of [{}, { VALKEY_URL: "" }, { VALKEY_URL: "   " }]) {
            expect(createEntityChangeTransport(bus, env)).toBeInstanceOf(InProcessEntityChangeTransport);
        }
    });

    it("is the Valkey transport when VALKEY_URL is set, and starts in the in-process path until connected", () => {
        const transport = createEntityChangeTransport(bus, { VALKEY_URL: "redis://127.0.0.1:1" });
        try {
            expect(transport).toBeInstanceOf(ValkeyEntityChangeTransport);
            expect((transport as ValkeyEntityChangeTransport).activeMode).toBe("fallback");
        } finally {
            transport.onModuleDestroy();
        }
    });
});
