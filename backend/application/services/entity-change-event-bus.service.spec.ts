import { EntityChangeEventBus, type EntityChangedEvent } from "./entity-change-event-bus.service";

describe("EntityChangeEventBus", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function collect(bus: EntityChangeEventBus): EntityChangedEvent[] {
        const events: EntityChangedEvent[] = [];
        bus.events$.subscribe((e) => events.push(e));
        return events;
    }

    it("publishes nothing until the 300ms trailing window elapses, then exactly one event", () => {
        const bus = new EntityChangeEventBus();
        const events = collect(bus);

        bus.emit({ branchId: "b1", kind: "client" });
        jest.advanceTimersByTime(299);
        expect(events).toEqual([]);

        jest.advanceTimersByTime(1);
        expect(events).toEqual([{ branchId: "b1", entities: ["client"] }]);

        jest.advanceTimersByTime(5000);
        expect(events).toHaveLength(1);
    });

    it("collapses a burst for one branch into one event with the distinct kinds", () => {
        const bus = new EntityChangeEventBus();
        const events = collect(bus);

        bus.emit({ branchId: "b1", kind: "message" });
        bus.emit({ branchId: "b1", kind: "message" });
        jest.advanceTimersByTime(100);
        bus.emit({ branchId: "b1", kind: "client" });
        bus.emit({ branchId: "b1", kind: "message" });
        bus.emit({ branchId: "b1", kind: "document" });
        jest.advanceTimersByTime(200);

        expect(events).toEqual([{ branchId: "b1", entities: ["message", "client", "document"] }]);
    });

    it("keeps branches (and the null broadcast) in separate batches", () => {
        const bus = new EntityChangeEventBus();
        const events = collect(bus);

        bus.emit({ branchId: "b1", kind: "client" });
        bus.emit({ branchId: "b2", kind: "employee" });
        bus.emit({ branchId: null, kind: "message" });
        jest.advanceTimersByTime(300);

        expect(events).toEqual(
            expect.arrayContaining([
                { branchId: "b1", entities: ["client"] },
                { branchId: "b2", entities: ["employee"] },
                { branchId: null, entities: ["message"] },
            ]),
        );
        expect(events).toHaveLength(3);
    });

    it("starts a fresh window after a flush", () => {
        const bus = new EntityChangeEventBus();
        const events = collect(bus);

        bus.emit({ branchId: "b1", kind: "client" });
        jest.advanceTimersByTime(300);
        bus.emit({ branchId: "b1", kind: "employee" });
        jest.advanceTimersByTime(300);

        expect(events).toEqual([
            { branchId: "b1", entities: ["client"] },
            { branchId: "b1", entities: ["employee"] },
        ]);
    });

    it("honours an injected window", () => {
        const bus = new EntityChangeEventBus(50);
        const events = collect(bus);

        bus.emit({ branchId: "b1", kind: "client" });
        jest.advanceTimersByTime(50);

        expect(events).toHaveLength(1);
    });
});
