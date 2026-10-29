import { EntityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { tenantContextStore } from "../tenant/tenant-context.store";
import {
    handleEntityModelOperation,
    handleEntityRawOperation,
    watchedKindsInSql,
} from "./entity-change.extension";

function setup() {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((e) => events.push(e));

    const write = (model: string | undefined, operation: string, result: unknown) =>
        handleEntityModelOperation({ model, operation, args: {}, query: jest.fn().mockResolvedValue(result) }, bus);
    const raw = (sql: unknown, result: unknown) =>
        handleEntityRawOperation({ args: sql, query: jest.fn().mockResolvedValue(result) }, bus);

    return { bus, events, write, raw };
}

describe("entity-change extension (model operations)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("a watched write emits exactly one coalesced event, with the row's branch", async () => {
        const { events, write } = setup();

        const result = await write("client", "update", { id: 1, branchId: "b1" });

        expect(result).toEqual({ id: 1, branchId: "b1" });
        expect(events).toEqual([]);
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: "b1", entities: ["client"] }]);
    });

    it.each([
        ["client", "client"],
        ["employee", "employee"],
        ["eformsign_doc", "document"],
        ["eformsign_document_job", "document"],
        ["eformsign_dispatch_intent", "document"],
        ["message_trigger_job", "message"],
        ["message_log", "message"],
        ["service_record", "service-record"],
        ["service_record_day", "service-record"],
        ["service_record_case", "service-record"],
    ])("maps model %s to kind %s", async (model, kind) => {
        const { events, write } = setup();

        await write(model, "create", { id: 1, branchId: "b1" });
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "b1", entities: [kind] }]);
    });

    it.each([
        ["create", { id: 1, branchId: "b1" }, "b1"],
        ["update", { id: 1, branchId: "b1" }, "b1"],
        ["upsert", { id: 1, branchId: "b1" }, "b1"],
        ["delete", { id: 1, branchId: "b1" }, "b1"],
        ["createManyAndReturn", [{ id: 1, branchId: "b1" }], "b1"],
        ["updateManyAndReturn", [{ id: 1, branchId: "b1" }], "b1"],
        // count-only results carry no row, so with no tenant store the branch is unknown.
        ["createMany", { count: 2 }, null],
        ["updateMany", { count: 2 }, null],
        ["deleteMany", { count: 2 }, null],
    ])("treats %s as a write", async (operation, result, expectedBranch) => {
        const { events, write } = setup();

        await write("employee", operation, result);
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: expectedBranch, entities: ["employee"] }]);
    });

    it.each(["findMany", "findUnique", "findFirst", "count", "aggregate", "groupBy"])("a %s read never emits", async (operation) => {
        const { events, write } = setup();

        await write("client", operation, [{ id: 1, branchId: "b1" }]);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("an unwatched model never emits", async () => {
        const { events, write } = setup();

        await write("auth_session", "update", { id: "s1", branchId: "b1" });
        await write(undefined, "update", { id: 1 });
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("a failing write emits nothing and rethrows the same error", async () => {
        const { bus, events } = setup();
        const failure = new Error("constraint");

        await expect(
            handleEntityModelOperation(
                { model: "client", operation: "update", args: {}, query: jest.fn().mockRejectedValue(failure) },
                bus,
            ),
        ).rejects.toBe(failure);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("resolves the branch from the returned row first", async () => {
        const { events, write } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "store-branch" }, () =>
            write("client", "update", { id: 1, branchId: "row-branch" }),
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "row-branch", entities: ["client"] }]);
    });

    it("falls back to the tenant store when the result carries no branch", async () => {
        const { events, write } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "store-branch" }, () =>
            write("client", "updateMany", { count: 3 }),
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "store-branch", entities: ["client"] }]);
    });

    it("falls back to null (broadcast) with neither a row branch nor a tenant store", async () => {
        const { events, write } = setup();

        await write("client", "updateMany", { count: 3 });
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: null, entities: ["client"] }]);
    });

    it("a *AndReturn write notifies every distinct branch in the returned rows", async () => {
        const { events, write } = setup();

        await write("message_log", "createManyAndReturn", [
            { id: 1, branchId: "b1" },
            { id: 2, branchId: "b2" },
            { id: 3, branchId: "b1" },
        ]);
        jest.advanceTimersByTime(300);

        expect(events).toHaveLength(2);
        expect(events).toEqual(
            expect.arrayContaining([
                { branchId: "b1", entities: ["message"] },
                { branchId: "b2", entities: ["message"] },
            ]),
        );
    });

    it("a *AndReturn write with rows [B, null] notifies B and broadcasts for the null row", async () => {
        const { events, write } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "store-branch" }, () =>
            write("client", "updateManyAndReturn", [
                { id: 1, branchId: "b1" },
                { id: 2, branchId: null },
            ]),
        );
        jest.advanceTimersByTime(300);

        expect(events).toHaveLength(2);
        expect(events).toEqual(
            expect.arrayContaining([
                { branchId: "b1", entities: ["client"] },
                { branchId: null, entities: ["client"] },
            ]),
        );
    });

    it("a *AndReturn write with rows [B, B] yields one B event", async () => {
        const { events, write } = setup();

        await write("client", "createManyAndReturn", [
            { id: 1, branchId: "b1" },
            { id: 2, branchId: "b1" },
        ]);
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "b1", entities: ["client"] }]);
    });

    it("a single row with an explicit null branchId broadcasts instead of using the tenant store", async () => {
        const { events, write } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "store-branch" }, () =>
            write("message_log", "create", { id: 1, branchId: null }),
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: null, entities: ["message"] }]);
    });

    it("a row without a branchId field still falls back to the tenant store", async () => {
        const { events, write } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "store-branch" }, () =>
            write("message_log", "create", { id: 1 }),
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "store-branch", entities: ["message"] }]);
    });

    it("a burst of 5 writes inside the window yields one event with the distinct kinds", async () => {
        const { events, write } = setup();

        await write("client", "update", { id: 1, branchId: "b1" });
        await write("client", "update", { id: 2, branchId: "b1" });
        await write("message_log", "create", { id: 3, branchId: "b1" });
        await write("employee", "update", { id: 4, branchId: "b1" });
        await write("message_trigger_job", "update", { id: 5, branchId: "b1" });
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "b1", entities: ["client", "message", "employee"] }]);
    });

    it("updateMany that touched nothing emits nothing; one that touched a row emits once", async () => {
        const { events, write } = setup();

        await write("message_trigger_job", "updateMany", { count: 0 });
        await write("message_trigger_job", "updateManyAndReturn", []);
        await write("message_trigger_job", "update", null);
        jest.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        await write("message_trigger_job", "updateMany", { count: 1 });
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: null, entities: ["message"] }]);
    });

    it("an emit that throws never fails the write", async () => {
        const throwingBus = {
            emit: jest.fn(() => {
                throw new Error("bus down");
            }),
        };
        const row = { id: 1, branchId: "b1" };

        await expect(
            handleEntityModelOperation(
                { model: "client", operation: "create", args: {}, query: jest.fn().mockResolvedValue(row) },
                throwingBus,
            ),
        ).resolves.toBe(row);
        expect(throwingBus.emit).toHaveBeenCalled();
    });
});

describe("entity-change extension (raw SQL)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("a raw UPDATE on a watched table that changed a row emits one event (tagged form)", async () => {
        const { events, raw } = setup();

        await raw({ strings: ["UPDATE message_trigger_job SET status = ", " WHERE id = ", ""], values: ["sent", 1] }, 1);
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: null, entities: ["message"] }]);
    });

    it("a raw UPDATE that changed nothing emits nothing", async () => {
        const { events, raw } = setup();

        await raw({ strings: ["UPDATE message_trigger_job SET status = 'x'"], values: [] }, 0);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("uses the tenant store's branch for raw writes", async () => {
        const { events, raw } = setup();

        await tenantContextStore.run({ origin: "http", branchId: "b1" }, () =>
            raw(['INSERT INTO "message_log" (id) VALUES ($1)', 7], 1),
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: "b1", entities: ["message"] }]);
    });

    it("a SELECT ... FOR UPDATE does not emit", async () => {
        const { events, raw } = setup();

        await raw(["SELECT id FROM message_trigger_job WHERE id = $1 FOR UPDATE SKIP LOCKED", 1], [{ id: 1 }]);
        await raw({ strings: ["SELECT * FROM client FOR UPDATE"], values: [] }, [{ id: 1 }]);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("$queryRaw returning no rows emits nothing; returning rows emits", async () => {
        const { events, raw } = setup();
        const sql = ["WITH moved AS (UPDATE service_record_day SET a = 1 RETURNING id) SELECT id FROM moved"];

        await raw(sql, []);
        jest.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        await raw(sql, [{ id: 1 }]);
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: null, entities: ["service-record"] }]);
    });

    it("a statement touching several watched tables emits every matched kind", async () => {
        const { events, raw } = setup();

        await raw(
            [
                "WITH a AS (UPDATE client SET x = 1 RETURNING id), b AS (DELETE FROM eformsign_doc WHERE id = 1 RETURNING id) SELECT 1",
            ],
            [{ "?column?": 1 }],
        );
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: null, entities: ["client", "document"] }]);
    });

    it("ignores unwatched tables and lookalike table names", async () => {
        const { events, raw } = setup();

        await raw(["UPDATE client_note SET a = 1"], 1);
        await raw(["UPDATE auth_session SET a = 1"], 1);
        await raw(["INSERT INTO message_trigger_rule_archive (id) VALUES (1)"], 1);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("ignores write keywords inside string literals and comments", () => {
        expect(watchedKindsInSql("SELECT 'UPDATE client' AS note")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT 1 /* UPDATE employee */")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT 1 -- DELETE FROM client\n")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT 'it''s UPDATE client'")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT $q$ UPDATE client $q$")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT $1, $$ INSERT INTO employee $$")).toEqual(new Set());
        expect(watchedKindsInSql("SELECT /* a /* nested UPDATE client */ still comment */ 1")).toEqual(new Set());
    });

    it("still matches real writes next to comments, quoted identifiers and string literals", () => {
        expect(watchedKindsInSql(`UPDATE "client" SET name = 'x -- y'`)).toEqual(new Set(["client"]));
        expect(watchedKindsInSql("/* note */ UPDATE message_trigger_job SET a = 1")).toEqual(new Set(["message"]));
        expect(watchedKindsInSql("-- header\nDELETE FROM employee WHERE note = 'a''b'")).toEqual(new Set(["employee"]));
        expect(watchedKindsInSql("UPDATE client SET a = $1 /* UPDATE branch */")).toEqual(new Set(["client"]));
    });

    it("does not shadow service_record_day / service_record_case with the service_record prefix", () => {
        expect(watchedKindsInSql("UPDATE service_record_case SET a = 1")).toEqual(new Set(["service-record"]));
        expect(watchedKindsInSql('UPDATE "public"."service_record_day" SET a = 1')).toEqual(new Set(["service-record"]));
        expect(watchedKindsInSql("update EMPLOYEE set a = 1")).toEqual(new Set(["employee"]));
    });

    it("returns the raw result unchanged and never fails the statement when emit throws", async () => {
        const throwingBus = {
            emit: jest.fn(() => {
                throw new Error("bus down");
            }),
        };

        await expect(
            handleEntityRawOperation(
                { args: ["UPDATE client SET a = 1"], query: jest.fn().mockResolvedValue(2) },
                throwingBus,
            ),
        ).resolves.toBe(2);
        expect(throwingBus.emit).toHaveBeenCalled();
    });

    it("a failing raw statement emits nothing and rethrows", async () => {
        const { bus, events } = setup();
        const failure = new Error("syntax");

        await expect(
            handleEntityRawOperation({ args: ["UPDATE client SET a = 1"], query: jest.fn().mockRejectedValue(failure) }, bus),
        ).rejects.toBe(failure);
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });
});
