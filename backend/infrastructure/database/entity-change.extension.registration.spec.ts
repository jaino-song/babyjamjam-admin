import { Prisma } from "@prisma/client";

import { EntityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { tenantContextStore } from "../tenant/tenant-context.store";
import { entityChangeExtension } from "./entity-change.extension";
import { PrismaService } from "./prisma.service";

/**
 * Drives the REAL registered `entityChangeExtension()` through an actual Prisma client: the
 * helper-level specs call the exported handlers directly and would stay green even if the
 * factory stopped registering them. Only the terminal database response is stubbed, by an
 * innermost extension that answers instead of calling `query` (no engine, no DB); every hook of
 * the extension under test stays in the call path.
 */

interface TerminalResponses {
    model: (model: string | undefined, operation: string) => unknown;
    raw: (operation: string) => unknown;
}

function terminalStub(responses: TerminalResponses) {
    return Prisma.defineExtension({
        name: "test-terminal-response",
        query: {
            $allModels: {
                async $allOperations({ model, operation }) {
                    return responses.model(model, operation);
                },
            },
            async $queryRaw() {
                return responses.raw("$queryRaw");
            },
            async $queryRawUnsafe() {
                return responses.raw("$queryRawUnsafe");
            },
            async $executeRaw() {
                return responses.raw("$executeRaw");
            },
            async $executeRawUnsafe() {
                return responses.raw("$executeRawUnsafe");
            },
        },
    });
}

function setup(responses: Partial<TerminalResponses> = {}) {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((e) => events.push(e));

    // Prisma runs the FIRST-registered extension outermost, so the terminal stub is registered
    // last: it is the innermost layer and answers where the engine would.
    const client = new PrismaService()
        .$extends(entityChangeExtension(bus))
        .$extends(
            terminalStub({
                model: responses.model ?? (() => ({ id: 1, branchId: "b1" })),
                raw: responses.raw ?? (() => 1),
            }),
        );
    return { client, events };
}

describe("entityChangeExtension() as registered on a real Prisma client", () => {
    beforeEach(() => {
        // Only the bus window is faked: Prisma schedules work on nextTick/microtasks/setImmediate.
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("client.update publishes one `client` event for the row's branch", async () => {
        const { client, events } = setup();

        await client.client.update({ where: { id: 1 }, data: { name: "x" } });
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "b1", entities: ["client"] }]);
    });

    it("message_trigger_job.updateMany publishes `message` for the tenant branch when count > 0, nothing when 0", async () => {
        let count = 0;
        const { client, events } = setup({ model: () => ({ count }) });

        await tenantContextStore.run({ origin: "http", branchId: "b9" }, async () => {
            // Awaited inside the run: a PrismaPromise is lazy and would otherwise execute outside the store.
            await client.message_trigger_job.updateMany({ where: {}, data: {} });
        },
        );
        jest.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        count = 2;
        await tenantContextStore.run({ origin: "http", branchId: "b9" }, async () => {
            // Awaited inside the run: a PrismaPromise is lazy and would otherwise execute outside the store.
            await client.message_trigger_job.updateMany({ where: {}, data: {} });
        },
        );
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: "b9", entities: ["message"] }]);
    });

    it("$executeRawUnsafe on a watched table publishes `message`; a SELECT ... FOR UPDATE does not", async () => {
        const { client, events } = setup({ raw: () => 1 });

        await client.$executeRawUnsafe("SELECT id FROM message_trigger_job FOR UPDATE");
        jest.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        await client.$executeRawUnsafe("UPDATE message_trigger_job SET status = $1", "sent");
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: null, entities: ["message"] }]);
    });

    it("the tagged $executeRaw and $queryRaw forms are hooked too", async () => {
        const { client, events } = setup({ raw: (operation) => (operation === "$queryRaw" ? [{ id: 1 }] : 1) });

        await client.$executeRaw`UPDATE employee SET name = ${"x"}`;
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: null, entities: ["employee"] }]);

        await client.$queryRaw`WITH m AS (UPDATE client SET a = ${1} RETURNING id) SELECT id FROM m`;
        jest.advanceTimersByTime(300);
        expect(events).toHaveLength(2);
        expect(events[1]).toEqual({ branchId: null, entities: ["client"] });
    });

    it("a read (findMany) publishes nothing", async () => {
        const { client, events } = setup({ model: () => [{ id: 1, branchId: "b1" }] });

        await client.client.findMany();
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });
});
