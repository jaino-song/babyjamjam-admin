import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import { checkWriteArgs } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore, TenantStoreState } from "infrastructure/tenant/tenant-context.store";
import { HOLIDAY_SYNC_LOCK_KEY, SbHolidaySyncRepository } from "./sb.holiday-sync.repository";

const firstArg = (fn: jest.Mock): unknown => (fn.mock.calls[0] as unknown[] | undefined)?.[0];
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface FakeState {
    snapshot: { year: number } | null;
    rows: Array<{ date: Date; name: string }>;
    revision: bigint;
}

function createHarness(state: FakeState) {
    const calls: string[] = [];
    const stores: Record<string, TenantStoreState | undefined> = {};
    const record = (name: string) => {
        calls.push(name);
        stores[name] = tenantContextStore.get();
    };

    const tx = {
        $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
            record("advisory_lock");
            void sql;
            return 1;
        }),
        $queryRaw: jest.fn(async () => {
            record("revision_for_update");
            return [{ revision: state.revision }];
        }),
        holiday_year_snapshot: {
            findUnique: jest.fn(async () => {
                record("snapshot.findUnique");
                return state.snapshot;
            }),
            update: jest.fn(async () => { record("snapshot.update"); return {}; }),
            upsert: jest.fn(async () => { record("snapshot.upsert"); return {}; }),
        },
        public_holiday: {
            findMany: jest.fn(async () => { record("public_holiday.findMany"); return state.rows; }),
            update: jest.fn(async () => { record("public_holiday.update"); return {}; }),
            updateMany: jest.fn(async () => { record("public_holiday.updateMany"); return { count: 0 }; }),
            deleteMany: jest.fn(async () => { record("public_holiday.deleteMany"); return { count: 0 }; }),
            createMany: jest.fn(async () => { record("public_holiday.createMany"); return { count: 0 }; }),
        },
        holiday_change_event: {
            createMany: jest.fn(async () => { record("holiday_change_event.createMany"); return { count: 0 }; }),
        },
        holiday_calendar_revision: {
            update: jest.fn(async () => {
                record("revision.update");
                state.revision += 1n;
                return { revision: state.revision };
            }),
        },
    };
    const prisma = {
        $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const repository = new SbHolidaySyncRepository(prisma as never);
    return { repository, tx, prisma, calls, stores };
}

const baseItems = (year: number) =>
    (KOREAN_HOLIDAY_CALENDAR[year] ?? []).map((date) => ({ date, name: `n-${date}` }));

describe("SbHolidaySyncRepository", () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("locks (advisory then revision row FOR UPDATE) before any read, with a 15s transaction timeout", async () => {
        const h = createHarness({ snapshot: null, rows: [], revision: 7n });
        await h.repository.applyYearSync({ year: 2026, items: baseItems(2026), rawCount: 30 });

        expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15000 });
        expect(h.calls.slice(0, 3)).toEqual(["advisory_lock", "revision_for_update", "snapshot.findUnique"]);

        const lockSql = firstArg(h.tx.$executeRaw) as Prisma.Sql;
        expect(lockSql.sql).toContain("pg_advisory_xact_lock");
        expect(lockSql.values).toContain(HOLIDAY_SYNC_LOCK_KEY);
        expect(HOLIDAY_SYNC_LOCK_KEY).toBe("holiday-calendar-sync");

        const revisionSql = firstArg(h.tx.$queryRaw) as Prisma.Sql;
        expect(revisionSql.sql).toMatch(/FROM holiday_calendar_revision WHERE id = 1 FOR UPDATE/);
    });

    it("first sync of a built-in year diffs against the built-in list (removed + added events)", async () => {
        const h = createHarness({ snapshot: null, rows: [], revision: 1n });
        const builtIn = [...KOREAN_HOLIDAY_CALENDAR[2026]!];
        const dropped = builtIn[3]!;
        const items = baseItems(2026).filter((item) => item.date !== dropped);
        items.push({ date: "2026-12-28", name: "임시공휴일" });

        const result = await h.repository.applyYearSync({ year: 2026, items, rawCount: 33 });

        expect(result).toEqual({ status: "updated", added: 1, removed: 1 });
        const events = (firstArg(h.tx.holiday_change_event.createMany) as { data: unknown[] }).data;
        expect(events).toEqual([
            { branchId: null, date: utc("2026-12-28"), change: "added", name: "임시공휴일", source: "kasi", processedAt: null },
            { branchId: null, date: utc(dropped), change: "removed", name: null, source: "kasi", processedAt: null },
        ]);
    });

    it("diffs against public_holiday rows once the year has a snapshot", async () => {
        const rows = [
            { date: utc("2026-01-01"), name: "신정" },
            { date: utc("2026-03-01"), name: "삼일절" },
        ];
        const h = createHarness({ snapshot: { year: 2026 }, rows, revision: 4n });

        const result = await h.repository.applyYearSync({
            year: 2026,
            items: [{ date: "2026-01-01", name: "신정" }, { date: "2026-05-05", name: "어린이날" }],
            rawCount: 2,
        });

        expect(result).toEqual({ status: "updated", added: 1, removed: 1 });
        const events = (firstArg(h.tx.holiday_change_event.createMany) as { data: Array<{ change: string; name: string | null }> }).data;
        expect(events.map((e) => [e.change, e.name])).toEqual([["added", "어린이날"], ["removed", "삼일절"]]);
    });

    it("replaces rows, bumps the revision once and upserts the snapshot with Number(revision) and the raw count", async () => {
        const h = createHarness({ snapshot: { year: 2026 }, rows: [{ date: utc("2026-01-01"), name: "신정" }], revision: 9n });
        await h.repository.applyYearSync({
            year: 2026,
            items: [{ date: "2026-01-01", name: "신정" }, { date: "2026-03-01", name: "삼일절" }],
            rawCount: 5,
        });

        expect(h.tx.holiday_calendar_revision.update).toHaveBeenCalledTimes(1);
        expect(h.tx.holiday_calendar_revision.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
            select: { revision: true },
        });
        expect(h.tx.public_holiday.deleteMany).toHaveBeenCalledWith({
            where: { date: { gte: utc("2026-01-01"), lte: utc("2026-12-31") } },
        });
        const created = (firstArg(h.tx.public_holiday.createMany) as { data: Array<{ date: Date; name: string; source: string }> }).data;
        expect(created.map((r) => [r.date.toISOString(), r.name, r.source])).toEqual([
            ["2026-01-01T00:00:00.000Z", "신정", "kasi"],
            ["2026-03-01T00:00:00.000Z", "삼일절", "kasi"],
        ]);

        const upsert = firstArg(h.tx.holiday_year_snapshot.upsert) as {
            create: { revision: unknown; itemCount: number; source: string };
            update: { revision: unknown };
        };
        expect(upsert.create.revision).toBe(10);
        expect(typeof upsert.create.revision).toBe("number");
        expect(upsert.update.revision).toBe(10);
        expect(upsert.create.itemCount).toBe(5);
        expect(upsert.create.source).toBe("kasi");
        // events are written before the rows they describe are replaced
        expect(h.calls.indexOf("holiday_change_event.createMany")).toBeLessThan(h.calls.indexOf("public_holiday.deleteMany"));
    });

    it("no diff with an existing snapshot only refreshes timestamps: no events, no row replace, no revision bump", async () => {
        const rows = [
            { date: utc("2026-01-01"), name: "신정" },
            { date: utc("2026-03-01"), name: "삼일절" },
        ];
        const h = createHarness({ snapshot: { year: 2026 }, rows, revision: 4n });

        const result = await h.repository.applyYearSync({
            year: 2026,
            items: [{ date: "2026-01-01", name: "신정" }, { date: "2026-03-01", name: "삼일절" }],
            rawCount: 2,
        });

        expect(result).toEqual({ status: "unchanged", added: 0, removed: 0 });
        expect(h.tx.holiday_change_event.createMany).not.toHaveBeenCalled();
        expect(h.tx.public_holiday.deleteMany).not.toHaveBeenCalled();
        expect(h.tx.public_holiday.createMany).not.toHaveBeenCalled();
        expect(h.tx.holiday_calendar_revision.update).not.toHaveBeenCalled();
        expect(h.tx.holiday_year_snapshot.upsert).not.toHaveBeenCalled();
        expect(h.tx.public_holiday.update).not.toHaveBeenCalled();
        const refresh = firstArg(h.tx.holiday_year_snapshot.update) as { where: { year: number }; data: { fetchedAt: Date; validatedAt: Date } };
        expect(refresh.where).toEqual({ year: 2026 });
        expect(refresh.data.fetchedAt).toBeInstanceOf(Date);
        expect(refresh.data.validatedAt).toBeInstanceOf(Date);
        expect(refresh.data).not.toHaveProperty("revision");
    });

    it("no date diff but a renamed holiday updates the name AND bumps the revision (readers cache by revision), without change events", async () => {
        const h = createHarness({
            snapshot: { year: 2026 },
            rows: [{ date: utc("2026-01-01"), name: "신정" }, { date: utc("2026-03-01"), name: "삼일절" }],
            revision: 4n,
        });
        const result = await h.repository.applyYearSync({
            year: 2026,
            items: [{ date: "2026-01-01", name: "1월1일" }, { date: "2026-03-01", name: "삼일절" }],
            rawCount: 2,
        });
        expect(result).toEqual({ status: "unchanged", added: 0, removed: 0 });
        expect(h.tx.public_holiday.update).toHaveBeenCalledTimes(1);
        expect(h.tx.public_holiday.update).toHaveBeenCalledWith({
            where: { date: utc("2026-01-01") },
            data: { name: "1월1일", fetchedAt: expect.any(Date) },
        });
        expect(h.tx.holiday_calendar_revision.update).toHaveBeenCalledTimes(1);
        expect(h.tx.holiday_calendar_revision.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
            select: { revision: true },
        });
        expect(h.tx.holiday_year_snapshot.update).toHaveBeenCalledWith({
            where: { year: 2026 },
            data: { revision: 5, fetchedAt: expect.any(Date), validatedAt: expect.any(Date) },
        });
        expect(h.tx.holiday_change_event.createMany).not.toHaveBeenCalled();
        expect(h.tx.public_holiday.deleteMany).not.toHaveBeenCalled();
        expect(h.tx.holiday_year_snapshot.upsert).not.toHaveBeenCalled();
    });

    it("first sync with identical dates still writes rows, snapshot and a revision bump (year becomes synced)", async () => {
        const h = createHarness({ snapshot: null, rows: [], revision: 0n });
        const result = await h.repository.applyYearSync({ year: 2026, items: baseItems(2026), rawCount: 30 });
        expect(result).toEqual({ status: "updated", added: 0, removed: 0 });
        expect(h.tx.holiday_change_event.createMany).not.toHaveBeenCalled();
        expect(h.tx.holiday_calendar_revision.update).toHaveBeenCalledTimes(1);
        expect(h.tx.holiday_year_snapshot.upsert).toHaveBeenCalledTimes(1);
    });

    it("a previously unsupported year (no snapshot, not built-in) writes NO change events", async () => {
        expect(KOREAN_HOLIDAY_CALENDAR[2031]).toBeUndefined();
        const h = createHarness({ snapshot: null, rows: [], revision: 0n });
        const result = await h.repository.applyYearSync({
            year: 2031,
            items: [{ date: "2031-01-01", name: "신정" }],
            rawCount: 1,
        });
        expect(result).toEqual({ status: "updated", added: 0, removed: 0 });
        expect(h.tx.holiday_change_event.createMany).not.toHaveBeenCalled();
        expect(h.tx.public_holiday.createMany).toHaveBeenCalledTimes(1);
        expect(h.tx.holiday_year_snapshot.upsert).toHaveBeenCalledTimes(1);
    });

    describe("system scope", () => {
        it("runs every statement in system scope even when triggered from an HTTP branch request, and that bypass is load-bearing", async () => {
            const branchId = "11111111-1111-4111-8111-111111111111";
            const h = createHarness({ snapshot: null, rows: [], revision: 1n });
            const items = baseItems(2026).filter((item) => item.date !== "2026-01-01");

            await tenantContextStore.run({ origin: "http", branchId }, () =>
                h.repository.applyYearSync({ year: 2026, items, rawCount: 29 }),
            );

            for (const call of h.calls) {
                expect(h.stores[call]).toMatchObject({ origin: "system", systemScope: true });
            }
            expect(h.stores["holiday_change_event.createMany"]?.systemScope).toBe(true);

            // The exact args written would be rejected under the request's branch scope.
            const createManyArgs = firstArg(h.tx.holiday_change_event.createMany);
            expect(checkWriteArgs("createMany", createManyArgs, branchId)).toBe("branch_mutation");
        });
    });
});
