import { Prisma } from "@prisma/client";

import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { EntityChangeEventBus, ENTITY_CHANGE_COALESCE_MS, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { persistClientMessageAutomationIntent } from "application/services/message-automation-intent-writer";
import { entityChangeExtension } from "infrastructure/database/entity-change.extension";
import { PrismaService } from "infrastructure/database/prisma.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

/**
 * The shared, branchless automation-recovery marker rule is created once, from inside a branch's
 * request. Its one-time creation must reach EVERY branch's realtime hint (`branchId: null`), not just
 * the creating branch, and must follow the caller's transaction: nothing on rollback, nothing when
 * the row already exists.
 *
 * Both write sites run through the REAL registered `entityChangeExtension()` on a real Prisma client
 * (same harness as `entity-change.extension.tx.spec.ts`); only the terminal database answer is
 * stubbed, with PostgreSQL's `INSERT ... ON CONFLICT DO NOTHING` semantics: a winning creator is
 * given the inserted row back, a losing one nothing.
 */

const CALLER_BRANCH = "branch-caller";

interface Control {
    markerExists: boolean;
    /** The pre-read saw no row, but a concurrent creator inserted it first (ON CONFLICT DO NOTHING). */
    lostRace: boolean;
    rollback: boolean;
    operations: string[];
}

function terminalStub(control: Control) {
    return Prisma.defineExtension({
        name: "test-terminal-response",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args }) {
                    control.operations.push(`${model}.${operation}`);
                    if (model === "message_trigger_rule") {
                        if (operation === "findUnique") {
                            expect(args).toMatchObject({ where: { deletedAt: null } });
                            return control.markerExists ? { id: "marker" } : null;
                        }
                        if (operation === "createManyAndReturn") {
                            return control.markerExists || control.lostRace ? [] : [{ id: "marker", branchId: null }];
                        }
                        // A count-only write, as the pre-fix code issued, carries no row to read a branch from.
                        if (operation === "createMany") return { count: control.markerExists || control.lostRace ? 0 : 1 };
                    }
                    return { id: "row", branchId: CALLER_BRANCH };
                },
            },
        },
    });
}

function setup() {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((event) => events.push(event));
    const control: Control = { markerExists: false, lostRace: false, rollback: false, operations: [] };

    // Mirrors the engine: the interactive callback gets the (extended) client, then commit / rollback.
    async function fakeTransaction(this: unknown, ...args: unknown[]): Promise<unknown> {
        const result = await (args[0] as (tx: unknown) => Promise<unknown>)(this);
        if (control.rollback) throw new Error("transaction rolled back");
        return result;
    }

    const client = new PrismaService().$extends(entityChangeExtension(bus, fakeTransaction)).$extends(terminalStub(control)) as unknown as {
        $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
    };

    const inCallerBranch = <T>(run: () => Promise<T>) => tenantContextStore.run({ origin: "http", branchId: CALLER_BRANCH }, run);
    const flush = () => jest.advanceTimersByTime(ENTITY_CHANGE_COALESCE_MS);
    const messageEventFor = (branchId: string | null) =>
        events.filter((event) => event.branchId === branchId && event.entities.includes("message"));
    return { client, control, events, inCallerBranch, flush, messageEventFor };
}

const sites: Array<{ name: string; run: (tx: Prisma.TransactionClient) => Promise<unknown> }> = [
    {
        name: "message-automation-intent-writer",
        run: (tx) => persistClientMessageAutomationIntent(tx, {
            branchId: CALLER_BRANCH,
            clientId: 31,
            includePast: false,
            suppressGreeting: false,
            intentAt: new Date("2026-10-30T00:00:00.000Z"),
        }),
    },
    {
        name: "agent-automation-record-store (ensureInternalRule)",
        run: (tx) => (new AgentAutomationRecordStoreService({} as never) as unknown as {
            ensureInternalRule(transaction: unknown): Promise<void>;
        }).ensureInternalRule(tx),
    },
];

describe.each(sites)("marker rule realtime hint: $name", ({ run }) => {
    beforeEach(() => {
        // Only the bus window is faked; Prisma schedules work on nextTick/microtasks/setImmediate.
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("first creation, committed: the message hint is broadcast to every branch (null), not only the caller's", async () => {
        const { client, control, inCallerBranch, flush, messageEventFor } = setup();

        await inCallerBranch(() => client.$transaction((tx) => run(tx)));
        flush();

        expect(control.operations).toContain("message_trigger_rule.createManyAndReturn");
        expect(messageEventFor(null)).toEqual([{ branchId: null, entities: ["message"] }]);
    });

    it("existing marker: no insert is issued and no broadcast hint is raised", async () => {
        const { client, control, inCallerBranch, flush, messageEventFor } = setup();
        control.markerExists = true;

        await inCallerBranch(() => client.$transaction((tx) => run(tx)));
        flush();

        expect(control.operations.filter((operation) => operation.startsWith("message_trigger_rule.create"))).toEqual([]);
        expect(messageEventFor(null)).toEqual([]);
    });

    it("lost creation race (the insert returned no row): no broadcast hint", async () => {
        const { client, control, inCallerBranch, flush, messageEventFor } = setup();
        control.lostRace = true;

        await inCallerBranch(() => client.$transaction((tx) => run(tx)));
        flush();

        expect(control.operations).toContain("message_trigger_rule.createManyAndReturn");
        expect(messageEventFor(null)).toEqual([]);
    });

    it("rolled-back transaction: the first creation raises no hint at all", async () => {
        const { client, control, events, inCallerBranch, flush } = setup();
        control.rollback = true;

        await expect(inCallerBranch(() => client.$transaction((tx) => run(tx)))).rejects.toThrow("transaction rolled back");
        flush();

        expect(control.operations).toContain("message_trigger_rule.createManyAndReturn");
        expect(events).toEqual([]);
    });

    it("holds the broadcast until the transaction commits", async () => {
        const { client, inCallerBranch, flush, messageEventFor } = setup();
        let seenInsideTransaction: number | undefined;

        await inCallerBranch(() => client.$transaction(async (tx) => {
            await run(tx);
            flush();
            seenInsideTransaction = messageEventFor(null).length;
        }));
        flush();

        expect(seenInsideTransaction).toBe(0);
        expect(messageEventFor(null)).toHaveLength(1);
    });
});
