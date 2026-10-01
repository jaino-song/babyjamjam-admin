import { PrismaService } from "infrastructure/database/prisma.service";
import { SbHolidayReviewRepository } from "./sb.holiday-review.repository";

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
        },
    };
    return { prisma, repository: new SbHolidayReviewRepository(prisma as unknown as PrismaService) };
}

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
            facts: { caseStatus: "COMPLETED", days: [{ date: "2026-11-03", locked: true }] },
        });
    });
});
