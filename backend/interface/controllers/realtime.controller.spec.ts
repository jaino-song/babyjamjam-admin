import { firstValueFrom, Subject } from "rxjs";

import type { EntityChangedEvent, EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "./realtime.controller";

function setup() {
    const subject = new Subject<EntityChangedEvent>();
    const controller = new RealtimeController({ events$: subject.asObservable() } as unknown as EntityChangeEventBus);
    const subscribe = (branchId: string) => {
        const received: Array<{ type?: string; data: unknown }> = [];
        const subscription = controller.events({ branchId }).subscribe((e) => received.push(e));
        return { received, subscription };
    };
    return { subject, controller, subscribe };
}

describe("RealtimeController", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("delivers an event for the subscriber's own branch as entity-changed with only the entities", () => {
        const { subject, subscribe } = setup();
        const a = subscribe("branch-a");

        subject.next({ branchId: "branch-a", entities: ["client", "message"] });

        expect(a.received).toEqual([{ type: "entity-changed", data: { entities: ["client", "message"] } }]);
        expect(JSON.stringify(a.received)).not.toContain("branch-a");
        a.subscription.unsubscribe();
    });

    it("does not deliver another branch's event", () => {
        const { subject, subscribe } = setup();
        const a = subscribe("branch-a");
        const b = subscribe("branch-b");

        subject.next({ branchId: "branch-b", entities: ["employee"] });

        expect(a.received).toEqual([]);
        expect(b.received).toEqual([{ type: "entity-changed", data: { entities: ["employee"] } }]);
        a.subscription.unsubscribe();
        b.subscription.unsubscribe();
    });

    it("delivers a null-branch (broadcast) event to every subscriber", () => {
        const { subject, subscribe } = setup();
        const a = subscribe("branch-a");
        const b = subscribe("branch-b");

        subject.next({ branchId: null, entities: ["message"] });

        expect(a.received).toEqual([{ type: "entity-changed", data: { entities: ["message"] } }]);
        expect(b.received).toEqual([{ type: "entity-changed", data: { entities: ["message"] } }]);
        a.subscription.unsubscribe();
        b.subscription.unsubscribe();
    });

    it("emits a ping with an epoch-ms timestamp every 30s", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-10-28T00:00:00Z"));
        const { controller } = setup();

        const ping = firstValueFrom(controller.events({ branchId: "branch-a" }));
        jest.advanceTimersByTime(30000);

        await expect(ping).resolves.toEqual({
            type: "ping",
            data: { at: new Date("2026-10-28T00:00:30Z").getTime() },
        });
    });
});
