import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbHolidayCalendarRepository } from "infrastructure/database/repositories/sb.holiday-calendar.repository";
import { SbHolidaySyncRepository } from "infrastructure/database/repositories/sb.holiday-sync.repository";

/**
 * Real-PostgreSQL checks for the revision triggers (migration 20261001000000_add_holiday_calendar):
 * every change to the calendar tables bumps `holiday_calendar_revision`, raw SQL included, because
 * running servers cache each branch's calendar by that revision. Skipped unless
 * HOLIDAY_REVIEW_REAL_DB=1, and then only against a local throwaway database:
 *
 *   createdb throwaway_hrv && export DATABASE_URL=postgresql://<user>@localhost/throwaway_hrv DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/holiday-calendar-revision.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

// Same guard as holiday-review.real-db.spec.ts (a spec cannot be imported without running it).
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

const EXTRA = "2026-11-10"; // a Tuesday, not in the built-in list
const BUILTIN_2026 = (KOREAN_HOLIDAY_CALENDAR[2026] ?? []).map((date) => ({ date, name: "공휴일" }));

describeReal("holiday calendar revision triggers (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let sync: SbHolidaySyncRepository;
    let calendarService: HolidayCalendarService;
    let branchId: string;

    const revision = async (): Promise<number> => {
        const rows = await prisma.$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
            SELECT revision FROM holiday_calendar_revision WHERE id = 1
        `);
        return Number(rows[0]?.revision);
    };

    async function cleanCalendar(): Promise<void> {
        await prisma.branch_holiday_override.deleteMany({ where: { branchId } });
        await prisma.public_holiday.deleteMany({});
        await prisma.holiday_year_snapshot.deleteMany({});
        // The sync writes public change events; leaving them unprocessed would leak into the review specs.
        await prisma.holiday_change_event.deleteMany({ where: { branchId: null, source: "kasi", processedAt: null } });
    }

    beforeAll(async () => {
        assertThrowawayTarget();
        for (const level of ["log", "warn", "debug", "error"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
        }
        prisma = new PrismaClient();
        await prisma.$connect();
        branchId = (await prisma.branch.create({
            data: { name: "T", slug: `throwaway-hrr-${Date.now().toString(36)}` },
        })).id;
        sync = new SbHolidaySyncRepository(prisma as unknown as PrismaService);
        calendarService = new HolidayCalendarService(new SbHolidayCalendarRepository(prisma as unknown as PrismaService));
    });

    afterAll(async () => {
        await cleanCalendar();
        await prisma.branch.deleteMany({ where: { id: branchId } });
        await prisma.$disconnect();
        jest.restoreAllMocks();
    });

    beforeEach(cleanCalendar);

    it("installs the revision triggers", async () => {
        const rows = await prisma.$queryRaw<Array<{ tgname: string }>>(Prisma.sql`
            SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg\_%\_bump\_revision' ORDER BY tgname
        `);
        expect(rows.map((row) => row.tgname)).toEqual([
            "trg_branch_holiday_override_bump_revision",
            "trg_holiday_year_snapshot_bump_revision",
            "trg_public_holiday_bump_revision",
            "trg_public_holiday_update_bump_revision",
        ]);
    });

    it("F1: deleting the synced rows returns a running server to the built-in list", async () => {
        await sync.applyYearSync({
            year: 2026,
            items: [...BUILTIN_2026, { date: EXTRA, name: "임시공휴일" }],
            rawCount: BUILTIN_2026.length + 1,
        });
        const synced = await calendarService.forBranch(branchId, { fresh: true });
        expect(synced.isBusinessDay(EXTRA)).toBe(false);

        // Done outside the app, with no revision bump of its own.
        await prisma.$executeRawUnsafe("DELETE FROM public_holiday");
        await prisma.$executeRawUnsafe("DELETE FROM holiday_year_snapshot");

        const afterDelete = await calendarService.forBranch(branchId, { fresh: true });
        expect(afterDelete.isBusinessDay(EXTRA)).toBe(true);
    });

    it("bumps on raw inserts, deletes, truncates and name changes, in every watched table", async () => {
        const bumps = async (statement: string): Promise<number> => {
            const before = await revision();
            await prisma.$executeRawUnsafe(statement);
            return (await revision()) - before;
        };

        expect(await bumps(
            "INSERT INTO holiday_year_snapshot (year, revision, item_count, source, fetched_at, validated_at) "
            + "VALUES (2026, 0, 0, 'kasi', now(), now())",
        )).toBe(1);
        expect(await bumps(
            `INSERT INTO public_holiday (date, name, source, fetched_at) VALUES ('${EXTRA}', 'a', 'kasi', now())`,
        )).toBe(1);
        expect(await bumps(`UPDATE public_holiday SET name = 'b' WHERE date = '${EXTRA}'`)).toBe(1);
        expect(await bumps(
            `INSERT INTO branch_holiday_override (branch_id, date, kind, name) VALUES ('${branchId}', '${EXTRA}', 'add', 'x')`,
        )).toBe(1);
        expect(await bumps(`UPDATE branch_holiday_override SET name = 'y' WHERE branch_id = '${branchId}'`)).toBe(1);
        expect(await bumps(`DELETE FROM branch_holiday_override WHERE branch_id = '${branchId}'`)).toBe(1);
        expect(await bumps("DELETE FROM holiday_year_snapshot")).toBe(1);
        expect(await bumps("TRUNCATE public_holiday")).toBe(1);
    });

    it("a no-change daily sync does not bump the revision, a rename does", async () => {
        const input = { year: 2026, items: BUILTIN_2026, rawCount: BUILTIN_2026.length };
        await expect(sync.applyYearSync(input)).resolves.toMatchObject({ status: "updated" });

        const before = await revision();
        await expect(sync.applyYearSync(input)).resolves.toEqual({ status: "unchanged", added: 0, removed: 0 });
        await expect(sync.applyYearSync(input)).resolves.toEqual({ status: "unchanged", added: 0, removed: 0 });
        expect(await revision()).toBe(before); // fetched_at / validated_at refreshes are not calendar changes

        const renamed = BUILTIN_2026.map((item, i) => (i === 0 ? { ...item, name: "다른 이름" } : item));
        await expect(sync.applyYearSync({ ...input, items: renamed })).resolves.toMatchObject({ status: "unchanged" });
        expect(await revision()).toBeGreaterThan(before);
    });

    it("the migration is re-runnable: replaying the trigger statements leaves exactly the same triggers", async () => {
        const body = `
            CREATE OR REPLACE FUNCTION "holiday_calendar_bump_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                UPDATE "holiday_calendar_revision" SET "revision" = "revision" + 1, "updated_at" = now() WHERE "id" = 1;
                RETURN NULL;
            END;
            $$`;
        // One statement per call: the driver refuses several commands in one prepared statement.
        await prisma.$executeRawUnsafe(body);
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "trg_public_holiday_bump_revision" ON "public_holiday"`);
        await prisma.$executeRawUnsafe(
            `CREATE TRIGGER "trg_public_holiday_bump_revision" AFTER INSERT OR DELETE OR TRUNCATE ON "public_holiday" `
            + `FOR EACH STATEMENT EXECUTE FUNCTION "holiday_calendar_bump_revision"()`,
        );
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT count(*) AS count FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'trg_public_holiday_bump_revision'
        `);
        expect(Number(rows[0]?.count)).toBe(1);
        const before = await revision();
        await prisma.$executeRawUnsafe(`INSERT INTO public_holiday (date, name, source, fetched_at) VALUES ('${EXTRA}', 'a', 'kasi', now())`);
        expect((await revision()) - before).toBe(1);
    });

    it("a raw insert of a public holiday reaches the next calendar read", async () => {
        await sync.applyYearSync({ year: 2026, items: BUILTIN_2026, rawCount: BUILTIN_2026.length });
        const before = await calendarService.forBranch(branchId, { fresh: true });
        expect(before.isBusinessDay(EXTRA)).toBe(true);

        await prisma.$executeRawUnsafe(
            `INSERT INTO public_holiday (date, name, source, fetched_at) VALUES ('${EXTRA}', '직접 입력', 'kasi', now())`,
        );

        expect((await calendarService.forBranch(branchId, { fresh: true })).isBusinessDay(EXTRA)).toBe(false);
    });
});
