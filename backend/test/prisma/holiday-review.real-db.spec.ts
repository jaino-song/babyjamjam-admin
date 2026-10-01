import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { HolidayReviewProcessorService } from "application/services/holiday-review-processor.service";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbHolidayCalendarRepository } from "infrastructure/database/repositories/sb.holiday-calendar.repository";
import { SbHolidayReviewRepository } from "infrastructure/database/repositories/sb.holiday-review.repository";

/**
 * Real-PostgreSQL checks for the holiday review pipeline: the partial unique index,
 * the RESTRICT foreign key and the processor end to end. Skipped unless
 * HOLIDAY_REVIEW_REAL_DB=1, and then only against a local throwaway database:
 *
 *   createdb throwaway_hrv && export DATABASE_URL=postgresql://<user>@localhost/throwaway_hrv DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/holiday-review.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;

export function assertThrowawayTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl) throw new Error("Refusing real-DB spec without DATABASE_URL and DIRECT_URL");
    if (databaseUrl !== directUrl) throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL differ");
    if (!THROWAWAY_URL.test(databaseUrl)) {
        throw new Error("Refusing real-DB spec: not a local throwaway database (name must contain 'throwaway')");
    }
}

describe("holiday review real-DB target guard", () => {
    it("accepts only a local database whose name says throwaway", () => {
        const ok = "postgresql://jaino@localhost/throwaway_hrv";
        expect(() => assertThrowawayTarget(ok, ok)).not.toThrow();
        expect(() => assertThrowawayTarget("", "")).toThrow(/without/);
        expect(() => assertThrowawayTarget(ok, "postgresql://jaino@localhost/throwaway_other")).toThrow(/differ/);
        for (const bad of [
            "postgresql://jaino@localhost/postgres",
            "postgresql://jaino@db.example.com/throwaway_hrv",
            "postgresql://user:pw@localhost/throwaway_hrv",
            "postgresql://jaino@localhost/throwaway_hrv?schema=public",
        ]) {
            expect(() => assertThrowawayTarget(bad, bad)).toThrow(/throwaway/);
        }
    });
});

const NOW = new Date("2030-01-01T00:00:00.000Z");
const OLD = new Date("2029-12-31T00:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describeReal("holiday review (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: SbHolidayReviewRepository;
    let processor: HolidayReviewProcessorService;
    let branchA: string;
    let branchB: string;
    const eventIds: string[] = [];
    const clientIds: number[] = [];

    beforeAll(async () => {
        assertThrowawayTarget();
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = Date.now().toString(36);
        branchA = (await prisma.branch.create({ data: { name: "A", slug: `throwaway-hrv-a-${suffix}` } })).id;
        branchB = (await prisma.branch.create({ data: { name: "B", slug: `throwaway-hrv-b-${suffix}` } })).id;
        repository = new SbHolidayReviewRepository(prisma as unknown as PrismaService);
        const calendar = new HolidayCalendarService(new SbHolidayCalendarRepository(prisma as unknown as PrismaService));
        processor = new HolidayReviewProcessorService(
            repository,
            calendar,
            { findAllActive: async () => [{ id: branchA, name: "A" }, { id: branchB, name: "B" }] },
            { holdsLease: () => true } as never,
        );
    });

    afterAll(async () => {
        await prisma.service_record_day.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.service_record_case.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.end_date_review_item.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.holiday_change_event.deleteMany({ where: { id: { in: eventIds } } });
        await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
        await prisma.branch_holiday_override.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.public_holiday.deleteMany({});
        await prisma.holiday_year_snapshot.deleteMany({});
        await prisma.branch.deleteMany({ where: { id: { in: [branchA, branchB] } } });
        await prisma.$disconnect();
        jest.restoreAllMocks();
    });

    /** Replaces the 2026 public calendar (built-in dates + `extra`) and bumps the revision. */
    async function setPublic2026(extra: string[]): Promise<void> {
        await prisma.public_holiday.deleteMany({});
        await prisma.public_holiday.createMany({
            data: [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), ...extra].map((date) => ({
                date: d(date),
                name: "공휴일",
                source: "kasi",
                fetchedAt: NOW,
            })),
        });
        await prisma.holiday_year_snapshot.upsert({
            where: { year: 2026 },
            create: { year: 2026, revision: 1, itemCount: 1, source: "kasi", fetchedAt: NOW, validatedAt: NOW },
            update: { validatedAt: NOW },
        });
        await prisma.holiday_calendar_revision.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
    }

    async function makeEvent(
        date: string,
        change: "added" | "removed",
        opts: { branchId?: string | null; createdAt?: Date } = {},
    ): Promise<string> {
        const row = await prisma.holiday_change_event.create({
            data: {
                branchId: opts.branchId ?? null,
                date: d(date),
                change,
                name: "임시공휴일",
                source: opts.branchId ? "branch-override" : "kasi",
                createdAt: opts.createdAt ?? OLD,
            },
        });
        eventIds.push(row.id);
        return row.id;
    }

    async function makeClient(
        branchId: string,
        partial: { start?: string; end?: string; duration?: number; status?: string | null } = {},
    ): Promise<number> {
        const row = await prisma.client.create({
            data: {
                name: `c-${Math.random().toString(36).slice(2, 8)}`,
                voucherClient: false,
                branchId,
                startDate: d(partial.start ?? "2026-11-02"),
                endDate: d(partial.end ?? "2026-11-13"),
                duration: partial.duration ?? 10,
                serviceStatus: partial.status === undefined ? "active" : partial.status,
            },
        });
        clientIds.push(row.id);
        return row.id;
    }

    const itemsOf = (clientId: number) =>
        prisma.end_date_review_item.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });

    beforeEach(async () => {
        await prisma.end_date_review_item.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.branch_holiday_override.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await prisma.holiday_change_event.updateMany({ where: { id: { in: eventIds } }, data: { processedAt: NOW } });
    });

    describe("schema", () => {
        it("has the partial unique index and the RESTRICT foreign key", async () => {
            const index = await prisma.$queryRaw<Array<{ indexdef: string }>>(Prisma.sql`
                SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_end_date_review_item_client_open'
            `);
            expect(index[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(client_id\) WHERE \(\(status\)::text = 'open'::text\)/);
            const fk = await prisma.$queryRaw<Array<{ confdeltype: string }>>(Prisma.sql`
                SELECT confdeltype::text AS confdeltype FROM pg_constraint
                WHERE conname = 'end_date_review_item_change_event_id_fkey'
            `);
            expect(fk[0]?.confdeltype).toBe("r");
        });

        it("rejects a second open item for a client, but not a second non-open one", async () => {
            const clientId = await makeClient(branchA);
            const e1 = await makeEvent("2026-11-10", "added");
            const e2 = await makeEvent("2026-11-11", "added");
            const base = { branchId: branchA, clientId, storedEnd: d("2026-11-13"), recalculatedEnd: d("2026-11-16"), affectedFrom: d("2026-11-10"), category: "safe" };
            const first = await prisma.end_date_review_item.create({ data: { ...base, changeEventId: e1 } });

            await expect(
                prisma.end_date_review_item.create({ data: { ...base, changeEventId: e2 } }),
            ).rejects.toMatchObject({ code: "P2002" });

            await prisma.end_date_review_item.update({ where: { id: first.id }, data: { status: "kept" } });
            await expect(
                prisma.end_date_review_item.create({ data: { ...base, changeEventId: e2 } }),
            ).resolves.toBeDefined();
            // A kept item does not count as open, so a third open one still fails against the second.
            await expect(
                prisma.end_date_review_item.create({
                    data: { ...base, changeEventId: await makeEvent("2026-11-12", "added") },
                }),
            ).rejects.toMatchObject({ code: "P2002" });
        });

        it("blocks deleting an event that has review items", async () => {
            const clientId = await makeClient(branchA);
            const withItem = await makeEvent("2026-11-10", "added");
            const withoutItem = await makeEvent("2026-11-11", "added");
            await prisma.end_date_review_item.create({
                data: {
                    changeEventId: withItem,
                    branchId: branchA,
                    clientId,
                    storedEnd: d("2026-11-13"),
                    recalculatedEnd: d("2026-11-16"),
                    affectedFrom: d("2026-11-10"),
                    category: "safe",
                    status: "kept",
                },
            });

            await expect(prisma.holiday_change_event.delete({ where: { id: withItem } })).rejects.toMatchObject({
                code: "P2003",
            });
            await expect(prisma.holiday_change_event.delete({ where: { id: withoutItem } })).resolves.toBeDefined();
            expect(await prisma.end_date_review_item.count({ where: { changeEventId: withItem } })).toBe(1);
        });
    });

    describe("repository.findReviewCandidates", () => {
        it("returns in-period, non-terminated clients of the branch with their sessions", async () => {
            const live = await makeClient(branchA);
            const nullStatus = await makeClient(branchA, { status: null });
            const excluded = [
                await makeClient(branchA, { status: "terminated" }),
                await makeClient(branchA, { start: "2026-11-11", end: "2026-11-20" }), // starts after the date
                await makeClient(branchA, { start: "2026-10-01", end: "2026-11-09" }), // ended before the date
                await makeClient(branchB), // another branch
            ];
            const withCase = await makeClient(branchA);
            const record = await prisma.service_record_case.create({
                data: { branchId: branchA, clientId: withCase, status: "COMPLETED" },
            });
            await prisma.service_record_day.create({
                data: {
                    branchId: branchA,
                    serviceRecordCaseId: record.id,
                    sessionIndex: 1,
                    caseSessionIndex: 1,
                    serviceDate: d("2026-11-03"),
                    locked: true,
                },
            });

            const found = await repository.findReviewCandidates(branchA, "2026-11-10");

            const foundIds = found.map((c) => c.clientId);
            expect(foundIds).toEqual(expect.arrayContaining([live, nullStatus, withCase]));
            for (const id of excluded) expect(foundIds).not.toContain(id);
            expect(found.every((c) => c.branchId === branchA)).toBe(true);
            expect(found.find((c) => c.clientId === live)).toMatchObject({
                startDate: "2026-11-02",
                endDate: "2026-11-13",
                duration: 10,
                facts: { caseStatus: null, days: [] },
            });
            expect(found.find((c) => c.clientId === withCase)!.facts).toEqual({
                caseStatus: "COMPLETED",
                days: [{ date: "2026-11-03", locked: true }],
            });
        });
    });

    describe("B1: a later event must not downgrade a risk item (audit repro)", () => {
        async function sessionOn(clientId: number, date: string): Promise<void> {
            const record = await prisma.service_record_case.create({
                data: { branchId: branchA, clientId, status: "AWAITING_COMPLETION" },
            });
            await prisma.service_record_day.create({
                data: {
                    branchId: branchA,
                    serviceRecordCaseId: record.id,
                    sessionIndex: 1,
                    caseSessionIndex: 1,
                    serviceDate: d(date),
                },
            });
        }

        it("keeps the first change's date on the recreated item, so it stays risk", async () => {
            // Public e1 added 2026-11-04, e2 added 2026-11-11; start 11-02, duration 10, stored end 11-13,
            // one session on 11-04. Between the two events the client is already risk.
            const clientId = await makeClient(branchA, { start: "2026-11-02", end: "2026-11-13", duration: 10 });
            await sessionOn(clientId, "2026-11-04");
            await setPublic2026(["2026-11-04"]);
            const e1 = await makeEvent("2026-11-04", "added", { createdAt: OLD });
            await processor.processDueEvents(NOW);
            expect((await itemsOf(clientId))[0]).toMatchObject({
                changeEventId: e1,
                category: "risk",
                reason: "session_on_or_after_date",
            });

            await setPublic2026(["2026-11-04", "2026-11-11"]);
            const e2 = await makeEvent("2026-11-11", "added", { createdAt: new Date(OLD.getTime() + 1000) });
            await processor.processDueEvents(NOW);

            const items = await itemsOf(clientId);
            expect(items.map((i) => [i.changeEventId, i.status])).toEqual([
                [e1, "obsolete"],
                [e2, "open"],
            ]);
            expect(items[1]).toMatchObject({ category: "risk", reason: "session_on_or_after_date" });
            expect(iso(items[0]!.affectedFrom)).toBe("2026-11-04");
            expect(iso(items[1]!.affectedFrom)).toBe("2026-11-04"); // min(e2 date, the replaced item's date)
        });

        it("a first-time item takes the event's own date", async () => {
            await setPublic2026(["2026-11-10"]);
            const clientId = await makeClient(branchA);
            await makeEvent("2026-11-10", "added");
            await processor.processDueEvents(NOW);
            expect(iso((await itemsOf(clientId))[0]!.affectedFrom)).toBe("2026-11-10");
        });
    });

    describe("F4: a later holiday beyond the stored end refreshes the open item", () => {
        it("includes a client whose end is before the date but whose open item's shown end is not", async () => {
            const clientId = await makeClient(branchA); // 11-02 .. 11-13
            const e1 = await makeEvent("2026-11-10", "added");
            await prisma.end_date_review_item.create({
                data: {
                    changeEventId: e1,
                    branchId: branchA,
                    clientId,
                    storedEnd: d("2026-11-13"),
                    recalculatedEnd: d("2026-11-16"),
                    affectedFrom: d("2026-11-10"),
                    category: "safe",
                },
            });

            const onDate = await repository.findReviewCandidates(branchA, "2026-11-16");
            expect(onDate.map((c) => c.clientId)).toContain(clientId);
            // Past the shown end the item no longer reaches the date.
            const beyond = await repository.findReviewCandidates(branchA, "2026-11-17");
            expect(beyond.map((c) => c.clientId)).not.toContain(clientId);
            // A client with no open item and end < date is still out.
            const plain = await makeClient(branchA, { start: "2026-11-02", end: "2026-11-13" });
            const found = await repository.findReviewCandidates(branchA, "2026-11-16");
            expect(found.map((c) => c.clientId)).not.toContain(plain);
        });

        it("end to end: the later event replaces the item with the date the manager will now see", async () => {
            const clientId = await makeClient(branchA);
            await setPublic2026(["2026-11-10"]);
            await makeEvent("2026-11-10", "added", { createdAt: OLD });
            await processor.processDueEvents(NOW);
            expect(iso((await itemsOf(clientId))[0]!.recalculatedEnd)).toBe("2026-11-16");

            // 11-16 (Mon) becomes a holiday: it lies between the stored end (11-13) and the shown end.
            await setPublic2026(["2026-11-10", "2026-11-16"]);
            const e2 = await makeEvent("2026-11-16", "added", { createdAt: new Date(OLD.getTime() + 1000) });
            await processor.processDueEvents(NOW);

            const items = await itemsOf(clientId);
            expect(items.map((i) => i.status)).toEqual(["obsolete", "open"]);
            expect(items[1]).toMatchObject({ changeEventId: e2 });
            expect(iso(items[1]!.recalculatedEnd)).toBe("2026-11-17");
            expect(iso(items[1]!.affectedFrom)).toBe("2026-11-10");
        });
    });

    describe("F1: a backlog beyond 1000 events still makes progress", () => {
        it("drains 1001 unprocessed events over several runs instead of stalling", async () => {
            await setPublic2026([]);
            const count = 1001;
            const base = OLD.getTime();
            // Branch events on a Sunday (never a business day, so every one is a cheap no-op for the
            // branch) keep the test fast; the guard and the undo set are what is under test.
            const rows = Array.from({ length: count }, (_, i) => ({
                branchId: branchA,
                date: d("2026-11-15"),
                change: "added",
                name: "x",
                source: "branch-override",
                createdAt: new Date(base + i),
            }));
            await prisma.holiday_change_event.createMany({ data: rows });
            const created = await prisma.holiday_change_event.findMany({
                where: { branchId: branchA, processedAt: null },
                select: { id: true },
            });
            expect(created).toHaveLength(count);
            eventIds.push(...created.map((row) => row.id));

            let runs = 0;
            let total = 0;
            for (; runs < 10; runs += 1) {
                const summary = await processor.processDueEvents(NOW);
                expect(summary.stopped).toBe(false);
                if (summary.processed === 0) break;
                total += summary.processed;
            }

            expect(total).toBe(count);
            expect(runs).toBeGreaterThan(1); // bounded per run, drained across runs
            expect(await prisma.holiday_change_event.count({ where: { branchId: branchA, processedAt: null } })).toBe(0);
        }, 120_000);
    });

    describe("processor end to end", () => {
        it("creates one safe item for the affected client only, and a replay adds nothing", async () => {
            await setPublic2026(["2026-11-10"]);
            const affected = await makeClient(branchA);
            const alreadyDifferent = await makeClient(branchA, { end: "2026-11-12" });
            const terminated = await makeClient(branchA, { status: "terminated" });
            const otherBranch = await makeClient(branchB);
            const eventId = await makeEvent("2026-11-10", "added");

            const summary = await processor.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 1, stopped: false });
            const items = await itemsOf(affected);
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({
                changeEventId: eventId,
                branchId: branchA,
                category: "safe",
                reason: "no_sessions_after_date",
                status: "open",
            });
            expect([iso(items[0]!.storedEnd), iso(items[0]!.recalculatedEnd)]).toEqual(["2026-11-13", "2026-11-16"]);
            expect(await itemsOf(alreadyDifferent)).toHaveLength(0); // never nagged
            expect(await itemsOf(terminated)).toHaveLength(0);
            // Public event: the other branch's client is handled too, under its own branch id.
            expect((await itemsOf(otherBranch))[0]).toMatchObject({ branchId: branchB });
            expect((await prisma.holiday_change_event.findUnique({ where: { id: eventId } }))?.processedAt).not.toBeNull();

            // Replay: processed_at cleared, same event processed again.
            await prisma.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: null } });
            await processor.processDueEvents(NOW);
            expect(await itemsOf(affected)).toHaveLength(1);
            expect((await itemsOf(affected))[0]!.status).toBe("open");
        });

        it("skips a branch that overrides the public date and does not obsolete its open items", async () => {
            await setPublic2026(["2026-11-10"]);
            const clientId = await makeClient(branchA);
            const firstEvent = await makeEvent("2026-11-10", "added");
            await processor.processDueEvents(NOW);
            expect(await itemsOf(clientId)).toHaveLength(1);

            await prisma.branch_holiday_override.create({
                data: { branchId: branchA, date: d("2026-11-10"), kind: "exclude", name: "x" },
            });
            await setPublic2026(["2026-11-10", "2026-11-11"]);
            await makeEvent("2026-11-10", "added", { createdAt: new Date(OLD.getTime() + 1000) });
            await processor.processDueEvents(NOW);

            const items = await itemsOf(clientId);
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({ changeEventId: firstEvent, status: "open" });
        });

        it("two unprocessed events in one period leave exactly one open item, under the second event", async () => {
            await setPublic2026(["2026-11-10", "2026-11-11"]);
            const clientId = await makeClient(branchA);
            const e1 = await makeEvent("2026-11-10", "added", { createdAt: OLD });
            const e2 = await makeEvent("2026-11-11", "added", { createdAt: new Date(OLD.getTime() + 1000) });

            const summary = await processor.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 2, stopped: false });
            const items = await itemsOf(clientId);
            expect(items.map((i) => [i.changeEventId, i.status])).toEqual([
                [e1, "obsolete"],
                [e2, "open"],
            ]);
            // The surviving item reflects the combined calendar: both holidays skipped.
            expect(iso(items[1]!.recalculatedEnd)).toBe("2026-11-17");
        });

        it("obsoletes an open item without a new one when a later change cancels the first", async () => {
            await setPublic2026(["2026-11-10"]);
            const clientId = await makeClient(branchA);
            await makeEvent("2026-11-10", "added", { createdAt: OLD });
            await processor.processDueEvents(NOW);
            expect((await itemsOf(clientId))[0]!.status).toBe("open");

            await setPublic2026([]);
            await makeEvent("2026-11-10", "removed", { createdAt: new Date(OLD.getTime() + 1000) });
            await processor.processDueEvents(NOW);

            const items = await itemsOf(clientId);
            expect(items.map((i) => i.status)).toEqual(["obsolete"]);
        });

        it("a risk client is listed with its reason", async () => {
            await setPublic2026(["2026-11-10"]);
            const clientId = await makeClient(branchA);
            const record = await prisma.service_record_case.create({
                data: { branchId: branchA, clientId, status: "AWAITING_COMPLETION" },
            });
            await prisma.service_record_day.create({
                data: {
                    branchId: branchA,
                    serviceRecordCaseId: record.id,
                    sessionIndex: 1,
                    caseSessionIndex: 1,
                    serviceDate: d("2026-11-12"),
                },
            });
            await makeEvent("2026-11-10", "added");

            await processor.processDueEvents(NOW);

            expect((await itemsOf(clientId))[0]).toMatchObject({
                category: "risk",
                reason: "session_on_or_after_date",
            });
            await prisma.service_record_day.deleteMany({ where: { serviceRecordCaseId: record.id } });
            await prisma.service_record_case.delete({ where: { id: record.id } });
        });
    });

    describe("repository.applyEventResult", () => {
        const draft = (clientId: number, branchId: string) => ({
            clientId,
            branchId,
            storedEnd: "2026-11-13",
            recalculatedEnd: "2026-11-16",
            previousEnd: "2026-11-13",
            affectedFrom: "2026-11-10",
            category: "safe" as const,
            reason: "no_sessions_after_date" as const,
        });

        it("reports an already processed event without writing", async () => {
            const clientId = await makeClient(branchA);
            const eventId = await makeEvent("2026-11-10", "added");
            await prisma.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: NOW } });

            const result = await repository.applyEventResult({
                eventId,
                drafts: [draft(clientId, branchA)],
                assumedOpenItemIds: {},
                expectedUnprocessedEventIds: [eventId],
            });

            expect(result).toEqual({ status: "already_processed" });
            expect(await itemsOf(clientId)).toHaveLength(0);
        });

        it("applies nothing when an unprocessed event the drafts did not account for exists", async () => {
            const clientId = await makeClient(branchA);
            const eventId = await makeEvent("2026-11-10", "added");
            const surprise = await makeEvent("2026-11-11", "added");
            await prisma.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: null } });
            await prisma.holiday_change_event.update({ where: { id: surprise }, data: { processedAt: null } });

            const result = await repository.applyEventResult({
                eventId,
                drafts: [draft(clientId, branchA)],
                assumedOpenItemIds: {},
                expectedUnprocessedEventIds: [eventId],
            });

            expect(result).toEqual({ status: "events_changed" });
            expect(await itemsOf(clientId)).toHaveLength(0);
            expect((await prisma.holiday_change_event.findUnique({ where: { id: eventId } }))?.processedAt).toBeNull();
        });

        it("applies nothing when a client's open item is no longer the one the drafts assumed", async () => {
            const clientId = await makeClient(branchA);
            const older = await makeEvent("2026-11-09", "added");
            await prisma.holiday_change_event.update({ where: { id: older }, data: { processedAt: NOW } });
            const eventId = await makeEvent("2026-11-10", "added");
            await prisma.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: null } });
            const open = await prisma.end_date_review_item.create({
                data: {
                    changeEventId: older,
                    branchId: branchA,
                    clientId,
                    storedEnd: d("2026-11-13"),
                    recalculatedEnd: d("2026-11-16"),
                    affectedFrom: d("2026-11-09"),
                    category: "safe",
                },
            });

            // The drafts saw no open item, but one exists now.
            const stale = await repository.applyEventResult({
                eventId,
                drafts: [draft(clientId, branchA)],
                assumedOpenItemIds: {},
                expectedUnprocessedEventIds: [eventId],
            });
            expect(stale).toEqual({ status: "items_changed" });
            expect((await prisma.holiday_change_event.findUnique({ where: { id: eventId } }))?.processedAt).toBeNull();

            // With the right assumption it replaces the item.
            const ok = await repository.applyEventResult({
                eventId,
                drafts: [{ ...draft(clientId, branchA), affectedFrom: "2026-11-09" }],
                assumedOpenItemIds: { [clientId]: open.id },
                expectedUnprocessedEventIds: [eventId],
            });
            expect(ok).toEqual({ status: "applied", created: 1, obsoleted: 1 });
        });

        it("rolls the whole event back when one draft fails", async () => {
            const clientId = await makeClient(branchA);
            const eventId = await makeEvent("2026-11-10", "added");
            await prisma.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: null } });

            await expect(
                repository.applyEventResult({
                    eventId,
                    drafts: [draft(clientId, branchA), draft(2_000_000_000, branchA)], // no such client: FK violation
                    assumedOpenItemIds: {},
                    expectedUnprocessedEventIds: [eventId],
                }),
            ).rejects.toBeDefined();

            expect(await itemsOf(clientId)).toHaveLength(0);
            expect((await prisma.holiday_change_event.findUnique({ where: { id: eventId } }))?.processedAt).toBeNull();
        });
    });
});
