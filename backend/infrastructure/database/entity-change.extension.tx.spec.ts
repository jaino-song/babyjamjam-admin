import { Prisma } from "@prisma/client";

import { EntityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { tenantContextStore } from "../tenant/tenant-context.store";
import { withoutEntityChangeHints } from "./entity-change-suppression";
import { entityChangeExtension, handleEntityModelOperation } from "./entity-change.extension";
import { PrismaService } from "./prisma.service";

/**
 * Commit-scoped emission and the `withoutEntityChangeHints` opt-out, driven through the REAL
 * registered `entityChangeExtension()` on a real Prisma client (same harness as the registration
 * spec: only the terminal database answer is stubbed).
 *
 * The engine cannot open a transaction without a database, so the extension's `runTransaction`
 * seam stands in for Prisma's own `$transaction`: it runs the callback / batch against the
 * extended client exactly where the engine would, then resolves (commit) or rethrows (rollback).
 * Calling Prisma's real `$transaction` through the override was checked by hand against a local
 * Postgres (interactive + batch + rollback + options); that is not repeatable in a hermetic spec.
 */

type TransactionArgs = unknown[];
interface SeenTransaction {
    args: TransactionArgs;
    thisArg: unknown;
}

function terminalStub(model: () => unknown, raw: () => unknown) {
    return Prisma.defineExtension({
        name: "test-terminal-response",
        query: {
            $allModels: {
                async $allOperations() {
                    return model();
                },
            },
            async $queryRaw() {
                return raw();
            },
            async $queryRawUnsafe() {
                return raw();
            },
            async $executeRaw() {
                return raw();
            },
            async $executeRawUnsafe() {
                return raw();
            },
        },
    });
}

function setup() {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((e) => events.push(e));
    // What `runTransaction` should do after the callback/batch ran: resolve = commit.
    const control = { settle: async (): Promise<void> => undefined };
    const seen: SeenTransaction[] = [];

    // Mirrors the engine: an interactive transaction hands the callback a client (here: the same
    // extended client) and resolves with its result; a batch executes every queued write.
    async function fakeTransaction(this: unknown, ...args: TransactionArgs): Promise<unknown> {
        seen.push({ args, thisArg: this });
        const [first] = args;
        const result = typeof first === "function"
            ? await (first as (tx: unknown) => Promise<unknown>)(this)
            : await Promise.all(first as Array<PromiseLike<unknown>>);
        await control.settle();
        return result;
    }

    const client = new PrismaService()
        .$extends(entityChangeExtension(bus, fakeTransaction))
        .$extends(terminalStub(() => ({ id: 1, branchId: "b1" }), () => 1));
    // The `$extends` chain is typed against the generated client, which has no `$transaction` seam
    // knowledge; the spec only needs the call surface.
    const typed = client as unknown as {
        $transaction(...args: TransactionArgs): Promise<unknown>;
        $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
        client: { update(args: unknown): Promise<unknown> };
        employee: { update(args: unknown): Promise<unknown> };
        system_setting: { update(args: unknown): Promise<unknown> };
        message_log: { update(args: unknown): Promise<unknown> };
    };
    const flush = () => jest.advanceTimersByTime(300);
    return { bus, events, control, seen, client: typed, flush };
}

describe("entity-change extension: commit-scoped emission", () => {
    beforeEach(() => {
        // Only the bus window is faked; Prisma schedules work on nextTick/microtasks/setImmediate.
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("interactive transaction: nothing before the callback resolves, one hint after the commit", async () => {
        const { client, events, bus, flush } = setup();
        const emitSpy = jest.spyOn(bus, "emit");
        let releaseCallback: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            releaseCallback = resolve;
        });

        const tx = client.$transaction(async (db: typeof client) => {
            await db.client.update({ where: { id: 1 }, data: {} });
            await gate;
        });
        await new Promise((resolve) => setImmediate(resolve));

        // The write has returned inside the transaction, the transaction has not committed yet.
        expect(emitSpy).not.toHaveBeenCalled();
        releaseCallback();
        await tx;
        expect(emitSpy).toHaveBeenCalledTimes(1);
        flush();
        expect(events).toEqual([{ branchId: "b1", entities: ["client"] }]);
    });

    it("interactive transaction that throws emits nothing, and the error reaches the caller", async () => {
        const { client, events, bus, flush } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await expect(
            client.$transaction(async (db: typeof client) => {
                await db.client.update({ where: { id: 1 }, data: {} });
                throw new Error("rollback me");
            }),
        ).rejects.toThrow("rollback me");

        flush();
        expect(emitSpy).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    it("a rejection at commit time (callback fine, commit fails) also drops the hints", async () => {
        const { client, events, control, flush } = setup();
        control.settle = async () => {
            throw new Error("commit failed");
        };

        await expect(
            client.$transaction(async (db: typeof client) => {
                await db.client.update({ where: { id: 1 }, data: {} });
            }),
        ).rejects.toThrow("commit failed");

        flush();
        expect(events).toEqual([]);
    });

    it("batch transaction: hints after commit; rejected batch emits nothing", async () => {
        const { client, events, control, flush } = setup();

        await client.$transaction([
            client.employee.update({ where: { id: 1 }, data: {} }),
            client.message_log.update({ where: { id: 1 }, data: {} }),
        ]);
        flush();
        expect(events).toEqual([{ branchId: "b1", entities: ["employee", "message"] }]);

        events.length = 0;
        control.settle = async () => {
            throw new Error("batch rolled back");
        };
        await expect(
            client.$transaction([client.client.update({ where: { id: 1 }, data: {} })]),
        ).rejects.toThrow("batch rolled back");
        flush();
        expect(events).toEqual([]);
    });

    it("two sequential transactions flush in order, each only after its own commit", async () => {
        const { client, bus } = setup();
        const emitted: string[] = [];
        jest.spyOn(bus, "emit").mockImplementation(({ kind }) => {
            emitted.push(kind);
        });

        await client.$transaction(async (db: typeof client) => {
            await db.client.update({ where: { id: 1 }, data: {} });
            await db.employee.update({ where: { id: 1 }, data: {} });
            expect(emitted).toEqual([]);
        });
        expect(emitted).toEqual(["client", "employee"]);

        await client.$transaction(async (db: typeof client) => {
            await db.message_log.update({ where: { id: 1 }, data: {} });
            expect(emitted).toEqual(["client", "employee"]);
        });
        expect(emitted).toEqual(["client", "employee", "message"]);
    });

    it("a write outside any transaction still emits immediately", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await client.client.update({ where: { id: 1 }, data: {} });

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith({ branchId: "b1", kind: "client" });
    });

    it("a write after a transaction settled (outside it) is immediate again", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await client.$transaction(async (db: typeof client) => {
            await db.client.update({ where: { id: 1 }, data: {} });
        });
        emitSpy.mockClear();
        await client.employee.update({ where: { id: 1 }, data: {} });

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith({ branchId: "b1", kind: "employee" });
    });

    it("a detached write that finishes after its transaction settled is emitted, not lost", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");
        let detached: Promise<unknown> = Promise.resolve();
        let releaseDetached: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            releaseDetached = resolve;
        });

        await client.$transaction(async () => {
            // Started inside the callback (inherits the scope) but completes after the commit.
            detached = gate.then(() => client.employee.update({ where: { id: 1 }, data: {} }));
        });
        expect(emitSpy).not.toHaveBeenCalled();
        releaseDetached();
        await detached;

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith({ branchId: "b1", kind: "employee" });
    });

    it("a raw write inside a transaction follows the transaction rule (held, then flushed; dropped on rollback)", async () => {
        const { client, bus, control } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await client.$transaction(async (db: typeof client) => {
            await db.$executeRawUnsafe("UPDATE message_trigger_job SET status = $1", "sent");
            expect(emitSpy).not.toHaveBeenCalled();
        });
        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith({ branchId: null, kind: "message" });

        emitSpy.mockClear();
        await expect(
            client.$transaction(async (db: typeof client) => {
                await db.$executeRawUnsafe("UPDATE message_trigger_job SET status = $1", "sent");
                throw new Error("nope");
            }),
        ).rejects.toThrow("nope");
        expect(emitSpy).not.toHaveBeenCalled();

        // And outside a transaction the same raw write is immediate.
        control.settle = async () => undefined;
        await client.$executeRawUnsafe("UPDATE message_trigger_job SET status = $1", "sent");
        expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it("the branch is resolved when the write runs, not when the transaction flushes", async () => {
        const { client, events, flush } = setup();
        await tenantContextStore.run({ origin: "http", branchId: "b-write" }, async () => {
            await client.$transaction(async (db: typeof client) => {
                await tenantContextStore.run({ origin: "http", branchId: "b-inner" }, async () => {
                    // GLOBAL model: broadcast whatever the tenant is.
                    await db.system_setting.update({ where: { id: 1 }, data: {} });
                });
                await tenantContextStore.run({ origin: "http", branchId: "b-inner" }, async () => {
                    // Raw writes take their branch from the tenant store at write time.
                    await db.$executeRawUnsafe("UPDATE employee SET name = $1", "x");
                });
            });
        });
        // Leaving the tenant scopes before the flush must not change the branch the hint carries.
        flush();
        expect(events).toEqual(
            expect.arrayContaining([
                { branchId: null, entities: ["settings"] },
                { branchId: "b-inner", entities: ["employee"] },
            ]),
        );
    });

    it("system-scope and tenant ALS stay intact around and inside the transaction", async () => {
        const { client } = setup();
        const seenInside: Array<{ origin?: string; branchId?: string; systemScope?: boolean }> = [];

        const result = await tenantContextStore.run({ origin: "system", systemScope: true }, async () =>
            client.$transaction(async (db: typeof client) => {
                seenInside.push({ ...tenantContextStore.get() });
                await db.client.update({ where: { id: 1 }, data: {} });
                await tenantContextStore.run({ origin: "http", branchId: "b2" }, async () => {
                    seenInside.push({ ...tenantContextStore.get() });
                });
                seenInside.push({ ...tenantContextStore.get() });
                return "done";
            }),
        );

        expect(result).toBe("done");
        expect(seenInside).toEqual([
            { origin: "system", systemScope: true },
            { origin: "http", branchId: "b2" },
            { origin: "system", systemScope: true },
        ]);
    });

    it("a $transaction started inside another transaction's callback flushes on its own commit", async () => {
        const { client, bus } = setup();
        const emitted: string[] = [];
        jest.spyOn(bus, "emit").mockImplementation(({ kind }) => {
            emitted.push(kind);
        });

        await expect(
            client.$transaction(async (outer: typeof client) => {
                await outer.client.update({ where: { id: 1 }, data: {} });
                await client.$transaction(async (inner: typeof client) => {
                    await inner.employee.update({ where: { id: 1 }, data: {} });
                });
                // The inner transaction committed: its hint is out while the outer is still open.
                expect(emitted).toEqual(["employee"]);
                throw new Error("outer rolls back");
            }),
        ).rejects.toThrow("outer rolls back");

        // The outer write was rolled back and never announced; the inner commit was.
        expect(emitted).toEqual(["employee"]);
    });

    it("a root-client write inside a transaction callback waits for that transaction (documented classification)", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await client.$transaction(async () => {
            await client.client.update({ where: { id: 1 }, data: {} });
            expect(emitSpy).not.toHaveBeenCalled();
        });

        expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it("passes the arguments (callback, options) and `this` through to the underlying $transaction", async () => {
        const { client, seen } = setup();
        const callback = async () => "value";
        const options = { timeout: 1234, maxWait: 567, isolationLevel: "Serializable" };

        const result = await client.$transaction(callback, options);

        expect(result).toBe("value");
        expect(seen).toHaveLength(1);
        expect(seen[0]?.args[0]).toBe(callback);
        expect(seen[0]?.args[1]).toBe(options);
        expect(seen[0]?.thisArg).toBeDefined();
    });

    it("a hint-bus failure never fails the committed transaction", async () => {
        const { client, bus } = setup();
        jest.spyOn(bus, "emit").mockImplementation(() => {
            throw new Error("bus down");
        });

        await expect(
            client.$transaction(async (db: typeof client) => {
                await db.client.update({ where: { id: 1 }, data: {} });
                return "ok";
            }),
        ).resolves.toBe("ok");
    });
});

describe("withoutEntityChangeHints", () => {
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("emits nothing for a direct write, and returns the callback's value", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        const result = await withoutEntityChangeHints(async () => {
            await client.client.update({ where: { id: 1 }, data: {} });
            return "kept";
        });

        expect(result).toBe("kept");
        expect(emitSpy).not.toHaveBeenCalled();
    });

    it("emits nothing for a model write or a raw write inside a transaction opened within it", async () => {
        const { client, bus, flush, events } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await withoutEntityChangeHints(async () => {
            await client.$transaction(async (db: typeof client) => {
                await db.system_setting.update({ where: { id: 1 }, data: {} });
                await db.$executeRawUnsafe("UPDATE system_setting SET value = $1", "x");
            });
        });

        flush();
        expect(emitSpy).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    it("suppresses only the wrapped write when it sits inside an ordinary transaction", async () => {
        const { client, bus } = setup();
        const emitted: string[] = [];
        jest.spyOn(bus, "emit").mockImplementation(({ kind }) => {
            emitted.push(kind);
        });

        await client.$transaction(async (db: typeof client) => {
            await withoutEntityChangeHints(() => db.system_setting.update({ where: { id: 1 }, data: {} }) as Promise<unknown>);
            await db.client.update({ where: { id: 1 }, data: {} });
        });

        expect(emitted).toEqual(["client"]);
    });

    it("a concurrent write outside the callback still emits, while the wrapped one does not", async () => {
        const { client, bus } = setup();
        const emitted: string[] = [];
        jest.spyOn(bus, "emit").mockImplementation(({ kind }) => {
            emitted.push(kind);
        });

        await Promise.all([
            withoutEntityChangeHints(async () => {
                await new Promise((resolve) => setImmediate(resolve));
                await client.employee.update({ where: { id: 1 }, data: {} });
            }),
            (async () => {
                await new Promise((resolve) => setImmediate(resolve));
                await client.client.update({ where: { id: 1 }, data: {} });
            })(),
        ]);

        expect(emitted).toEqual(["client"]);
    });

    it("does not leak after the callback finishes: the next write emits", async () => {
        const { client, bus } = setup();
        const emitSpy = jest.spyOn(bus, "emit");

        await withoutEntityChangeHints(() => client.employee.update({ where: { id: 1 }, data: {} }) as Promise<unknown>);
        expect(emitSpy).not.toHaveBeenCalled();
        await client.client.update({ where: { id: 1 }, data: {} });

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith({ branchId: "b1", kind: "client" });
    });

    it("applies to the exported handler too (no client involved)", async () => {
        const bus = new EntityChangeEventBus();
        const emitSpy = jest.spyOn(bus, "emit");
        const write = () =>
            handleEntityModelOperation(
                { model: "client", operation: "update", args: {}, query: jest.fn().mockResolvedValue({ id: 1, branchId: "b1" }) },
                bus,
            );

        await withoutEntityChangeHints(write);
        expect(emitSpy).not.toHaveBeenCalled();
        await write();
        expect(emitSpy).toHaveBeenCalledTimes(1);
    });
});
