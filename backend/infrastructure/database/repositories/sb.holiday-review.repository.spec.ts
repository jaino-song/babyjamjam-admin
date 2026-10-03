import { Prisma } from "@prisma/client";

import { PrismaService } from "infrastructure/database/prisma.service";
import { SbHolidayReviewRepository, HOLIDAY_REVIEW_LOCK_KEY } from "./sb.holiday-review.repository";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function makeRepository() {
    const prisma = {
        end_date_review_item: {
            groupBy: jest.fn<Promise<unknown[]>, [unknown]>(async () => []),
            findFirst: jest.fn<Promise<unknown>, [unknown]>(async () => null),
            findMany: jest.fn<Promise<unknown[]>, [unknown]>(async () => []),
            updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(async () => ({ count: 1 })),
        },
        holiday_change_event: {
            findMany: jest.fn<Promise<unknown[]>, [unknown]>(async () => []),
            findFirst: jest.fn<Promise<unknown>, [unknown]>(async () => null),
        },
        client: {
            findFirst: jest.fn<Promise<unknown>, [unknown]>(async () => null),
            findMany: jest.fn<Promise<unknown[]>, [unknown]>(async () => []),
        },
    };
    return { prisma, repository: new SbHolidayReviewRepository(prisma as unknown as PrismaService) };
}

afterEach(() => {
    jest.useRealTimers();
});

/** The tenant extension only accepts a top-level `where.branchId` on aggregates and writes. */
const whereOf = (mock: jest.Mock): Record<string, unknown> =>
    (mock.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;

describe("SbHolidayReviewRepository HTTP-path methods", () => {
    describe("listOpenEventSummaries", () => {
        it("groups this branch's open items and reads only public or own events by id", async () => {
            const { prisma, repository } = makeRepository();
            prisma.end_date_review_item.groupBy.mockResolvedValue([
                { changeEventId: EVENT, category: "safe", _count: { _all: 3 } },
                { changeEventId: EVENT, category: "risk", _count: { _all: 2 } },
            ]);
            prisma.holiday_change_event.findMany.mockResolvedValue([
                {
                    id: EVENT,
                    branchId: null,
                    date: day("2026-11-10"),
                    change: "added",
                    name: "임시공휴일",
                    source: "kasi",
                    createdAt: new Date("2026-11-01T00:00:00Z"),
                },
            ]);

            const events = await repository.listOpenEventSummaries(BRANCH);

            expect(prisma.end_date_review_item.groupBy).toHaveBeenCalledWith(
                expect.objectContaining({ where: { branchId: BRANCH, status: "open" } }),
            );
            expect(prisma.holiday_change_event.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: { in: [EVENT] }, OR: [{ branchId: null }, { branchId: BRANCH }] },
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                }),
            );
            expect(events).toEqual([
                expect.objectContaining({ id: EVENT, date: "2026-11-10", safeOpen: 3, riskOpen: 2, branchId: null }),
            ]);
        });

        it("does not read events at all when the branch has no open items", async () => {
            const { prisma, repository } = makeRepository();

            await expect(repository.listOpenEventSummaries(BRANCH)).resolves.toEqual([]);
            expect(prisma.holiday_change_event.findMany).not.toHaveBeenCalled();
        });
    });

    describe("reads carry the branch in the top-level where", () => {
        it("branchHasEventItems", async () => {
            const { prisma, repository } = makeRepository();
            prisma.end_date_review_item.findFirst.mockResolvedValue({ id: ITEM });

            await expect(repository.branchHasEventItems(BRANCH, EVENT)).resolves.toBe(true);
            expect(whereOf(prisma.end_date_review_item.findFirst)).toEqual({ branchId: BRANCH, changeEventId: EVENT });
        });

        it("findEventRecord never reads an event by bare id", async () => {
            const { prisma, repository } = makeRepository();

            await expect(repository.findEventRecord(BRANCH, EVENT)).resolves.toBeNull();
            expect(whereOf(prisma.holiday_change_event.findFirst)).toEqual({
                id: EVENT,
                OR: [{ branchId: null }, { branchId: BRANCH }],
            });
        });

        it("listEventItems applies the filters on top of branch and event, sorted by client name then id", async () => {
            const { prisma, repository } = makeRepository();

            await repository.listEventItems(BRANCH, EVENT, { category: "risk", status: "kept", q: "김" });

            expect(prisma.end_date_review_item.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        branchId: BRANCH,
                        changeEventId: EVENT,
                        category: "risk",
                        status: "kept",
                        client: { name: { contains: "김", mode: "insensitive" } },
                    },
                    orderBy: [{ client: { name: "asc" } }, { id: "asc" }],
                }),
            );
        });

        it("listEventItems without filters only scopes by branch and event", async () => {
            const { prisma, repository } = makeRepository();

            await repository.listEventItems(BRANCH, EVENT, {});

            expect(whereOf(prisma.end_date_review_item.findMany)).toEqual({ branchId: BRANCH, changeEventId: EVENT });
        });

        it("findEventItemsByIds scopes by branch and event and skips the query for no ids", async () => {
            const { prisma, repository } = makeRepository();

            await repository.findEventItemsByIds(BRANCH, EVENT, [ITEM]);
            await repository.findEventItemsByIds(BRANCH, EVENT, []);

            expect(prisma.end_date_review_item.findMany).toHaveBeenCalledTimes(1);
            expect(whereOf(prisma.end_date_review_item.findMany)).toEqual({
                branchId: BRANCH,
                changeEventId: EVENT,
                id: { in: [ITEM] },
            });
        });

        it("findFixSnapshot looks the client up inside the branch", async () => {
            const { prisma, repository } = makeRepository();

            await expect(repository.findFixSnapshot(BRANCH, 7)).resolves.toBeNull();
            expect(whereOf(prisma.client.findFirst)).toEqual({ id: 7, branchId: BRANCH });
        });
    });

    describe("writes only move OPEN items of this branch and event", () => {
        it.each([0, 1])("claimOpenItemForFix locks the processor and CASes the entire calculation (count=%s)", async (count) => {
            const { prisma, repository } = makeRepository();
            const transaction = {
                $executeRaw: jest.fn<Promise<number>, [Prisma.Sql]>(async () => 1),
                end_date_review_item: { updateMany: jest.fn(async () => ({ count })) },
            };
            const expected = {
                id: ITEM, clientId: 7, clientName: "김아기", storedEnd: "2026-11-13",
                recalculatedEnd: "2026-11-16", affectedFrom: "2026-11-10",
                category: "safe" as const, reason: "no_sessions_after_date" as const, status: "open" as const,
            };

            expect(await repository.claimOpenItemForFix(
                BRANCH, EVENT, expected, "user-1", transaction as unknown as Prisma.TransactionClient,
            )).toBe(count === 1);
            const lock = transaction.$executeRaw.mock.calls[0]?.[0];
            expect(lock?.sql).toContain("pg_advisory_xact_lock");
            expect(lock?.values).toEqual([HOLIDAY_REVIEW_LOCK_KEY]);
            expect(transaction.$executeRaw.mock.invocationCallOrder[0])
                .toBeLessThan(transaction.end_date_review_item.updateMany.mock.invocationCallOrder[0] ?? 0);
            expect(transaction.end_date_review_item.updateMany).toHaveBeenCalledWith({
                where: {
                    id: ITEM, branchId: BRANCH, changeEventId: EVENT, clientId: 7, status: "open",
                    storedEnd: day(expected.storedEnd), recalculatedEnd: day(expected.recalculatedEnd),
                    affectedFrom: day(expected.affectedFrom), category: "safe", reason: "no_sessions_after_date",
                },
                data: { status: "fixed", resolvedBy: "user-1", resolvedAt: expect.any(Date) },
            });
            expect(prisma.end_date_review_item.updateMany).not.toHaveBeenCalled();
        });

        it("closeOpenItem", async () => {
            const { prisma, repository } = makeRepository();

            await expect(
                repository.closeOpenItem(BRANCH, EVENT, ITEM, { status: "kept", resolvedBy: "user-1" }),
            ).resolves.toBe(true);

            expect(prisma.end_date_review_item.updateMany).toHaveBeenCalledWith({
                where: { id: ITEM, branchId: BRANCH, changeEventId: EVENT, status: "open" },
                data: { status: "kept", resolvedBy: "user-1", resolvedAt: expect.any(Date) },
            });
        });

        it("closeOpenItem reports false when nothing was open", async () => {
            const { prisma, repository } = makeRepository();
            prisma.end_date_review_item.updateMany.mockResolvedValue({ count: 0 });

            await expect(
                repository.closeOpenItem(BRANCH, EVENT, ITEM, { status: "fixed", resolvedBy: null }),
            ).resolves.toBe(false);
        });

        it("reclassifyOpenItem", async () => {
            const { prisma, repository } = makeRepository();

            await expect(
                repository.reclassifyOpenItem(BRANCH, EVENT, ITEM, {
                    category: "risk",
                    reason: "finalized",
                    recalculatedEnd: "2026-11-17",
                }),
            ).resolves.toBe(true);

            expect(prisma.end_date_review_item.updateMany).toHaveBeenCalledWith({
                where: { id: ITEM, branchId: BRANCH, changeEventId: EVENT, status: "open" },
                data: { category: "risk", reason: "finalized", recalculatedEnd: day("2026-11-17") },
            });
        });
    });

    it("findFixSnapshot maps the client row to dates, duration, termination and case facts", async () => {
        jest.useFakeTimers({ now: new Date("2026-10-01T03:00:00.000Z") });
        const { prisma, repository } = makeRepository();
        prisma.client.findFirst.mockResolvedValue({
            startDate: day("2026-11-02"),
            endDate: day("2026-11-13"),
            duration: 10,
            serviceStatus: "terminated",
            serviceRecordCase: { status: "COMPLETED", days: [{ serviceDate: day("2026-11-03"), locked: true }] },
        });

        await expect(repository.findFixSnapshot(BRANCH, 7)).resolves.toEqual({
            startDate: "2026-11-02",
            endDate: "2026-11-13",
            duration: 10,
            terminated: true,
            finished: false,
            facts: { caseStatus: "COMPLETED", days: [{ date: "2026-11-03", locked: true }] },
        });
    });

    describe("finished clients (stored end date before today, Asia/Seoul)", () => {
        beforeEach(() => {
            // 2026-09-30T20:00Z is already 2026-10-01 in Seoul.
            jest.useFakeTimers({ now: new Date("2026-09-30T20:00:00.000Z") });
        });

        const snapshotRow = (endDate: Date | null) => ({
            startDate: day("2026-04-27"),
            endDate,
            duration: 10,
            serviceStatus: "active",
            serviceRecordCase: null,
        });

        it.each([
            ["the day before today", "2026-09-30", true],
            ["today", "2026-10-01", false],
            ["after today", "2026-10-02", false],
        ])("findFixSnapshot: an end date %s is finished=%s", async (_label, end, finished) => {
            const { prisma, repository } = makeRepository();
            prisma.client.findFirst.mockResolvedValue(snapshotRow(day(end)));

            await expect(repository.findFixSnapshot(BRANCH, 7)).resolves.toMatchObject({ finished });
        });

        it("findFixSnapshot: a client without an end date is not finished", async () => {
            const { prisma, repository } = makeRepository();
            prisma.client.findFirst.mockResolvedValue(snapshotRow(null));

            await expect(repository.findFixSnapshot(BRANCH, 7)).resolves.toMatchObject({ finished: false });
        });

        it("findReviewCandidates bounds BOTH branches of the period rule by end >= today, not by the event date", async () => {
            const { prisma, repository } = makeRepository();

            // A change dated in the past (2026-05-01) still asks for ongoing clients only.
            await repository.findReviewCandidates(BRANCH, "2026-05-01");

            const where = whereOf(prisma.client.findMany) as { startDate: unknown; AND: Array<Record<string, unknown>> };
            expect(where.startDate).toEqual({ lte: day("2026-05-01") });
            // Top-level AND entry: it applies to the in-period branch and to the open-item branch alike.
            expect(where.AND).toContainEqual({ endDate: { gte: day("2026-10-01") } });
            expect(where.AND).toContainEqual({
                OR: [
                    { endDate: { gte: day("2026-05-01") } },
                    { endDateReviewItems: { some: { status: "open", recalculatedEnd: { gte: day("2026-05-01") } } } },
                ],
            });
        });
    });
});

describe("SbHolidayReviewRepository.applyEventResult", () => {
    const CLIENT = 7;
    const draft = {
        clientId: CLIENT,
        branchId: BRANCH,
        storedEnd: "2026-11-13",
        recalculatedEnd: "2026-11-16",
        previousEnd: "2026-11-13",
        affectedFrom: "2026-11-10",
        category: "safe" as const,
        reason: "no_sessions_after_date" as const,
    };
    const input = {
        eventId: EVENT,
        drafts: [draft],
        assumedOpenItemIds: {},
        expectedUnprocessedEventIds: [EVENT],
    };

    function makeTxRepository(currentEnd: Date | null | "missing") {
        const tx = {
            $executeRaw: jest.fn<Promise<number>, [Prisma.Sql]>(async () => 1),
            holiday_change_event: {
                findFirst: jest.fn(async () => ({ id: EVENT })),
                findMany: jest.fn(async () => [{ id: EVENT }]),
                update: jest.fn(async () => ({})),
            },
            end_date_review_item: {
                findMany: jest.fn(async () => []),
                updateMany: jest.fn(async () => ({ count: 0 })),
                upsert: jest.fn(async () => ({})),
            },
            client: {
                findMany: jest.fn(async () => (currentEnd === "missing" ? [] : [{ id: CLIENT, endDate: currentEnd }])),
            },
        };
        const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
        return { tx, repository: new SbHolidayReviewRepository(prisma as unknown as PrismaService) };
    }

    it("applies the drafts when each client's end date is still the one they were computed from", async () => {
        const { tx, repository } = makeTxRepository(day("2026-11-13"));

        await expect(repository.applyEventResult(input)).resolves.toEqual({ status: "applied", created: 1, obsoleted: 0 });

        const lock = tx.$executeRaw.mock.calls[0]?.[0];
        expect(lock?.values).toEqual([HOLIDAY_REVIEW_LOCK_KEY]);
        expect(tx.client.findMany).toHaveBeenCalledWith({
            where: { id: { in: [CLIENT] }, branchId: { in: [BRANCH] } },
            select: { id: true, endDate: true },
        });
        expect(tx.end_date_review_item.upsert).toHaveBeenCalledTimes(1);
        expect(tx.holiday_change_event.update).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["moved to another date since", day("2026-11-17")],
        ["was cleared", null],
        ["is gone", "missing" as const],
    ])("N2: returns items_changed and writes nothing when a client's end date %s", async (_label, currentEnd) => {
        const { tx, repository } = makeTxRepository(currentEnd);

        await expect(repository.applyEventResult(input)).resolves.toEqual({ status: "items_changed" });

        expect(tx.end_date_review_item.upsert).not.toHaveBeenCalled();
        expect(tx.end_date_review_item.updateMany).not.toHaveBeenCalled();
        // The event stays unprocessed so the next run recomputes it.
        expect(tx.holiday_change_event.update).not.toHaveBeenCalled();
    });
});
