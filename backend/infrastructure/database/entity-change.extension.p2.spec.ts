import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EntityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";
import { tenantContextStore } from "../tenant/tenant-context.store";
import {
    ENTITY_KIND_BY_MODEL,
    GLOBAL_MODELS,
    handleEntityModelOperation,
    handleEntityRawOperation,
    watchedKindsInSql,
} from "./entity-change.extension";

/** Phase 2 models: [model, kind]. Shared (branch-less) ones are in GLOBAL_MODELS. */
const NEW_MODELS: ReadonlyArray<readonly [string, string]> = [
    ["message_template", "message"],
    ["message_trigger_rule", "message"],
    ["message_trigger_rule_branch_override", "message"],
    ["service_record_revision", "service-record"],
    ["service_record_day_edit_log", "service-record"],
    ["service_record_revision_document_state", "service-record"],
    ["employee_schedule", "service-record"],
    ["service_record_token", "service-record"],
    ["consultation_inquiry", "inquiry"],
    ["call_record", "call"],
    ["client_draft", "call"],
    ["document", "file"],
    ["document_category", "file"],
    ["public_holiday", "holiday"],
    ["branch_holiday_override", "holiday"],
    ["holiday_year_snapshot", "holiday"],
    ["holiday_calendar_revision", "holiday"],
    ["holiday_change_event", "holiday"],
    ["end_date_review_item", "holiday"],
    ["system_setting", "settings"],
    ["area", "settings"],
    ["doc_template", "settings"],
    ["voucher_price_info", "settings"],
    ["out_of_pocket_price_info", "settings"],
    ["bank_account_info", "settings"],
    ["system_template", "settings"],
    ["branch", "settings"],
    ["notification", "notification"],
];

function setup() {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((e) => events.push(e));
    const controller = new RealtimeController(bus);
    const subscribe = (branchId: string) => {
        const received: Array<{ type?: string; data: unknown }> = [];
        // Cursor ids and the opening `ready` are the transport's concern (realtime.controller.spec.ts);
        // these assertions are about which entity-changed hints reach which branch.
        const subscription = controller.events({ branchId }).subscribe(({ type, data }) => {
            if (type !== "ready") received.push({ type, data });
        });
        return { received, subscription };
    };

    const write = (model: string, operation: string, result: unknown) =>
        handleEntityModelOperation({ model, operation, args: {}, query: jest.fn().mockResolvedValue(result) }, bus);
    const raw = (sql: unknown, result: unknown) =>
        handleEntityRawOperation({ args: sql, query: jest.fn().mockResolvedValue(result) }, bus);
    return { bus, events, write, raw, subscribe };
}

describe("entity-change extension (phase 2 models)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each(NEW_MODELS)("maps %s to kind %s", (model, kind) => {
        expect(ENTITY_KIND_BY_MODEL[model]).toBe(kind);
    });

    it.each(NEW_MODELS)("%s: a row write emits its kind; count 0 / null emit nothing", async (model, kind) => {
        const { events, write } = setup();
        const row = GLOBAL_MODELS.has(model) ? { id: 1 } : { id: 1, branchId: "b1" };

        await write(model, "update", null);
        await write(model, "updateMany", { count: 0 });
        await write(model, "deleteMany", { count: 0 });
        jest.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        await write(model, "create", row);
        jest.advanceTimersByTime(300);
        expect(events).toEqual([{ branchId: GLOBAL_MODELS.has(model) ? null : "b1", entities: [kind] }]);

        events.length = 0;
        await write(model, "updateMany", { count: 1 });
        jest.advanceTimersByTime(300);
        expect(events).toHaveLength(1);
        expect(events[0]?.entities).toEqual([kind]);
    });

    it("a GLOBAL model has no branchId column and every other new model has one (schema is the source of truth)", () => {
        const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
        const hasBranchId = (model: string): boolean => {
            const body = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1];
            if (body === undefined) throw new Error(`model ${model} missing from schema.prisma`);
            return /^\s+branchId\s/m.test(body);
        };

        for (const [model] of NEW_MODELS) {
            expect({ model, global: GLOBAL_MODELS.has(model) }).toEqual({ model, global: !hasBranchId(model) });
        }
    });

    describe("branch scope", () => {
        it.each([...GLOBAL_MODELS])(
            "a %s write inside branch A's tenant context broadcasts, so a branch B subscriber receives it",
            async (model) => {
                const { write, subscribe } = setup();
                const a = subscribe("branch-a");
                const b = subscribe("branch-b");

                await tenantContextStore.run({ origin: "http", branchId: "branch-a" }, () =>
                    write(model, "update", { id: 1 }),
                );
                jest.advanceTimersByTime(300);

                const kind = ENTITY_KIND_BY_MODEL[model];
                expect(a.received).toEqual([{ type: "entity-changed", data: { entities: [kind] } }]);
                expect(b.received).toEqual([{ type: "entity-changed", data: { entities: [kind] } }]);
                a.subscription.unsubscribe();
                b.subscription.unsubscribe();
            },
        );

        it("a GLOBAL count-only write (updateMany) in branch A's context also broadcasts", async () => {
            const { events, write } = setup();

            await tenantContextStore.run({ origin: "http", branchId: "branch-a" }, () =>
                write("voucher_price_info", "updateMany", { count: 3 }),
            );
            jest.advanceTimersByTime(300);

            expect(events).toEqual([{ branchId: null, entities: ["settings"] }]);
        });

        it("a branch-owned model (consultation_inquiry, branch A) reaches branch A and not branch B", async () => {
            const { write, subscribe } = setup();
            const a = subscribe("branch-a");
            const b = subscribe("branch-b");

            await write("consultation_inquiry", "create", { id: 1, branchId: "branch-a" });
            jest.advanceTimersByTime(300);

            expect(a.received).toEqual([{ type: "entity-changed", data: { entities: ["inquiry"] } }]);
            expect(b.received).toEqual([]);
            a.subscription.unsubscribe();
            b.subscription.unsubscribe();
        });

        it("a branch-owned model with an explicit null branchId still broadcasts", async () => {
            const { events, write } = setup();

            await write("message_trigger_rule", "upsert", { id: "r1", branchId: null });
            jest.advanceTimersByTime(300);

            expect(events).toEqual([{ branchId: null, entities: ["message"] }]);
        });
    });

    describe("raw SQL", () => {
        it("a raw write on a GLOBAL table broadcasts even inside a tenant context", async () => {
            const { events, raw } = setup();

            await tenantContextStore.run({ origin: "http", branchId: "branch-a" }, () =>
                raw(['UPDATE "public_holiday" SET fetched_at = now()', 1], 1),
            );
            jest.advanceTimersByTime(300);

            expect(events).toEqual([{ branchId: null, entities: ["holiday"] }]);
        });

        it("a raw write on a branch-owned table keeps the tenant branch (positive direction)", async () => {
            const { events, raw } = setup();

            await tenantContextStore.run({ origin: "http", branchId: "branch-a" }, () =>
                raw(['UPDATE "consultation_inquiry" SET status = $1', "x"], 1),
            );
            jest.advanceTimersByTime(300);

            expect(events).toEqual([{ branchId: "branch-a", entities: ["inquiry"] }]);
        });

        it("a statement touching a GLOBAL and a branch-owned table: global kind broadcasts, the other keeps the tenant branch", async () => {
            const { events, raw } = setup();
            const sql = `WITH h AS (UPDATE "system_setting" SET value = 'x' RETURNING 1)
                UPDATE "notification" SET read_at = now()`;

            await tenantContextStore.run({ origin: "http", branchId: "branch-a" }, () => raw([sql], 2));
            jest.advanceTimersByTime(300);

            expect(events).toHaveLength(2);
            expect(events).toEqual(
                expect.arrayContaining([
                    { branchId: null, entities: ["settings"] },
                    { branchId: "branch-a", entities: ["notification"] },
                ]),
            );
        });

        it("a global raw write that changed nothing emits nothing", async () => {
            const { events, raw } = setup();

            await raw(['UPDATE "system_setting" SET value = $1', "x"], 0);
            jest.advanceTimersByTime(1000);

            expect(events).toEqual([]);
        });

        it("tells the file library apart from the eformsign `document` kind and from its prefix lookalikes", () => {
            expect([...watchedKindsInSql('UPDATE "document_category" SET label = $1')]).toEqual(["file"]);
            expect([...watchedKindsInSql("UPDATE document SET label = $1")]).toEqual(["file"]);
            expect([...watchedKindsInSql('UPDATE "eformsign_doc" SET status = $1')]).toEqual(["document"]);
            expect([...watchedKindsInSql('UPDATE "branch_holiday_override" SET a = 1')]).toEqual(["holiday"]);
            expect([...watchedKindsInSql('UPDATE "branch" SET a = 1')]).toEqual(["settings"]);
            expect([...watchedKindsInSql('UPDATE "branches_archive" SET a = 1')]).toEqual([]);
            expect([...watchedKindsInSql("SELECT 1 FROM document FOR UPDATE")]).toEqual([]);
        });
    });
});
