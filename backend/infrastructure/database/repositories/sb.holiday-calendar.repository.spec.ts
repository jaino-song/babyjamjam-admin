import { Prisma } from "@prisma/client";

import {
    BUILTIN_PUBLIC_HOLIDAY_NAME,
    HolidayOverrideConflictError,
    IHolidayOverrideTransaction,
} from "domain/repositories/holiday-calendar.repository.interface";
import { checkWriteArgs } from "infrastructure/database/tenant-isolation.extension";
import { SbHolidayCalendarRepository } from "./sb.holiday-calendar.repository";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const OVERRIDE_ID = "22222222-2222-4222-8222-222222222222";

function makeHarness() {
    const calls: string[] = [];
    const record = <T>(name: string, result: T) =>
        jest.fn<Promise<T>, unknown[]>().mockImplementation(async () => {
            calls.push(name);
            return result;
        });

    const tx = {
        holiday_calendar_revision: { update: record("revision.update", { revision: 8n }) },
        holiday_year_snapshot: { findUnique: record<unknown>("snapshot.findUnique", null) },
        public_holiday: { findUnique: record<unknown>("public.findUnique", null) },
        branch_holiday_override: {
            findFirst: record<unknown>("override.findFirst", null),
            create: record<unknown>("override.create", {
                id: OVERRIDE_ID,
                branchId: BRANCH,
                date: new Date("2026-12-24T00:00:00.000Z"),
                kind: "add",
                name: "임시",
                createdBy: null,
                createdAt: new Date("2026-10-01T00:00:00.000Z"),
            }),
            deleteMany: record("override.deleteMany", { count: 1 }),
        },
        holiday_change_event: { create: record("event.create", {}) },
    };
    const prisma = {
        $transaction: jest
            .fn<Promise<unknown>, [(client: typeof tx) => Promise<unknown>, { timeout: number }?]>()
            .mockImplementation(async (fn) => fn(tx)),
        holiday_calendar_revision: { findUnique: jest.fn() },
        holiday_year_snapshot: { findMany: jest.fn() },
        public_holiday: { findMany: jest.fn() },
        branch_holiday_override: { findMany: jest.fn() },
    };
    const repository = new SbHolidayCalendarRepository(prisma as never);
    return { repository, prisma, tx, calls };
}

describe("SbHolidayCalendarRepository reads", () => {
    it("reads the revision as a number and defaults to 0 without a row", async () => {
        const { repository, prisma } = makeHarness();
        prisma.holiday_calendar_revision.findUnique.mockResolvedValueOnce({ id: 1, revision: 41n });
        await expect(repository.readRevision()).resolves.toBe(41);
        expect(prisma.holiday_calendar_revision.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });

        prisma.holiday_calendar_revision.findUnique.mockResolvedValueOnce(null);
        await expect(repository.readRevision()).resolves.toBe(0);
    });

    it("reads snapshot years and public rows as ISO dates", async () => {
        const { repository, prisma } = makeHarness();
        const validatedAt = new Date("2026-10-01T04:00:00.000Z");
        prisma.holiday_year_snapshot.findMany.mockResolvedValue([{ year: 2026, validatedAt }]);
        prisma.public_holiday.findMany.mockResolvedValue([
            { date: new Date("2026-10-03T00:00:00.000Z"), name: "개천절" },
        ]);

        await expect(repository.readPublicCalendar()).resolves.toEqual({
            snapshots: [{ year: 2026, validatedAt }],
            holidays: [{ date: "2026-10-03", name: "개천절" }],
        });
    });

    it("filters overrides by the explicit branch id", async () => {
        const { repository, prisma } = makeHarness();
        prisma.branch_holiday_override.findMany.mockResolvedValue([
            {
                id: OVERRIDE_ID,
                branchId: BRANCH,
                date: new Date("2026-12-24T00:00:00.000Z"),
                kind: "exclude",
                name: null,
                createdBy: null,
                createdAt: new Date("2026-10-01T00:00:00.000Z"),
            },
        ]);

        const rows = await repository.readBranchOverrides(BRANCH);

        expect(prisma.branch_holiday_override.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { branchId: BRANCH } }),
        );
        expect(rows).toEqual([expect.objectContaining({ id: OVERRIDE_ID, date: "2026-12-24", kind: "exclude" })]);
    });
});

describe("SbHolidayCalendarRepository.withOverrideTransaction", () => {
    it("increments the revision first, with the 15s timeout", async () => {
        const { repository, prisma, tx, calls } = makeHarness();
        let seenInside = "";
        await repository.withOverrideTransaction(async (ops) => {
            seenInside = calls.join(",");
            await ops.findOverride(OVERRIDE_ID, BRANCH);
        });

        expect(tx.holiday_calendar_revision.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
        });
        expect(seenInside).toBe("revision.update");
        expect(calls).toEqual(["revision.update", "override.findFirst"]);
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15000 });
    });

    it("propagates an operation failure so the transaction (and the bump) rolls back", async () => {
        const { repository } = makeHarness();
        await expect(
            repository.withOverrideTransaction(async () => {
                throw new Error("rejected");
            }),
        ).rejects.toThrow("rejected");
    });

    async function withOps<T>(
        harness: ReturnType<typeof makeHarness>,
        fn: (ops: IHolidayOverrideTransaction) => Promise<T>,
    ): Promise<T> {
        return harness.repository.withOverrideTransaction(fn);
    }

    describe("lookupPublicHoliday", () => {
        it("uses public_holiday rows when the year has a snapshot", async () => {
            const harness = makeHarness();
            harness.tx.holiday_year_snapshot.findUnique.mockResolvedValue({ year: 2026 });
            harness.tx.public_holiday.findUnique.mockResolvedValue({ name: "개천절" });

            const lookup = await withOps(harness, (ops) => ops.lookupPublicHoliday("2026-10-03"));

            expect(lookup).toEqual({ yearSupported: true, publicName: "개천절" });
            expect(harness.tx.public_holiday.findUnique).toHaveBeenCalledWith({
                where: { date: new Date("2026-10-03T00:00:00.000Z") },
            });
        });

        it("treats a snapshot year without a row for the date as not public (no built-in fallback)", async () => {
            const harness = makeHarness();
            harness.tx.holiday_year_snapshot.findUnique.mockResolvedValue({ year: 2026 });
            harness.tx.public_holiday.findUnique.mockResolvedValue(null);

            // 2026-01-01 is in the built-in list, but the snapshot is authoritative for the year.
            const lookup = await withOps(harness, (ops) => ops.lookupPublicHoliday("2026-01-01"));

            expect(lookup).toEqual({ yearSupported: true, publicName: null });
        });

        it("falls back to the built-in calendar for a built-in year without a snapshot", async () => {
            const harness = makeHarness();

            const holiday = await withOps(harness, (ops) => ops.lookupPublicHoliday("2026-01-01"));
            const weekday = await withOps(harness, (ops) => ops.lookupPublicHoliday("2026-01-02"));

            expect(holiday).toEqual({ yearSupported: true, publicName: BUILTIN_PUBLIC_HOLIDAY_NAME });
            expect(weekday).toEqual({ yearSupported: true, publicName: null });
            expect(harness.tx.public_holiday.findUnique).not.toHaveBeenCalled();
        });

        it("reports an unsupported year when there is neither snapshot nor built-in data", async () => {
            const harness = makeHarness();

            const lookup = await withOps(harness, (ops) => ops.lookupPublicHoliday("2090-01-01"));

            expect(lookup).toEqual({ yearSupported: false, publicName: null });
        });
    });

    describe("branch writes", () => {
        it("inserts an override with the date at UTC midnight and the branch pinned", async () => {
            const harness = makeHarness();

            const created = await withOps(harness, (ops) =>
                ops.insertOverride({ branchId: BRANCH, date: "2026-12-24", kind: "add", name: "임시", createdBy: null }),
            );

            const args = harness.tx.branch_holiday_override.create.mock.calls[0]![0] as { data: Record<string, unknown> };
            expect(args.data).toEqual({
                branchId: BRANCH,
                date: new Date("2026-12-24T00:00:00.000Z"),
                kind: "add",
                name: "임시",
                createdBy: null,
            });
            expect(checkWriteArgs("create", args, BRANCH)).toBeNull();
            expect(created).toMatchObject({ id: OVERRIDE_ID, date: "2026-12-24", kind: "add" });
        });

        it("maps a unique violation to HolidayOverrideConflictError", async () => {
            const harness = makeHarness();
            harness.tx.branch_holiday_override.create.mockRejectedValueOnce(
                new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
            );

            await expect(
                withOps(harness, (ops) =>
                    ops.insertOverride({ branchId: BRANCH, date: "2026-12-24", kind: "add", name: "임시", createdBy: null }),
                ),
            ).rejects.toBeInstanceOf(HolidayOverrideConflictError);
        });

        it("rethrows other database errors untouched", async () => {
            const harness = makeHarness();
            const failure = new Error("connection lost");
            harness.tx.branch_holiday_override.create.mockRejectedValueOnce(failure);

            await expect(
                withOps(harness, (ops) =>
                    ops.insertOverride({ branchId: BRANCH, date: "2026-12-24", kind: "add", name: "임시", createdBy: null }),
                ),
            ).rejects.toBe(failure);
        });

        it("deletes with id AND branchId (an id-only delete is unpinned_write) and reports the count", async () => {
            const harness = makeHarness();

            await expect(withOps(harness, (ops) => ops.deleteOverride(OVERRIDE_ID, BRANCH))).resolves.toBe(true);
            harness.tx.branch_holiday_override.deleteMany.mockResolvedValueOnce({ count: 0 });
            await expect(withOps(harness, (ops) => ops.deleteOverride(OVERRIDE_ID, BRANCH))).resolves.toBe(false);

            const args = harness.tx.branch_holiday_override.deleteMany.mock.calls[0]![0];
            expect(args).toEqual({ where: { id: OVERRIDE_ID, branchId: BRANCH } });
            expect(checkWriteArgs("deleteMany", args, BRANCH)).toBeNull();
            expect(checkWriteArgs("delete", { where: { id: OVERRIDE_ID } }, BRANCH)).toBe("unpinned_write");
        });

        it("looks overrides up by id and branch", async () => {
            const harness = makeHarness();

            await expect(withOps(harness, (ops) => ops.findOverride(OVERRIDE_ID, BRANCH))).resolves.toBeNull();

            expect(harness.tx.branch_holiday_override.findFirst).toHaveBeenCalledWith({
                where: { id: OVERRIDE_ID, branchId: BRANCH },
            });
        });

        it("writes a branch change event pinned to the branch, unprocessed, source 'branch'", async () => {
            const harness = makeHarness();

            await withOps(harness, (ops) =>
                ops.insertBranchChangeEvent({ branchId: BRANCH, date: "2026-12-24", change: "added", name: "임시" }),
            );

            const args = harness.tx.holiday_change_event.create.mock.calls[0]![0] as { data: Record<string, unknown> };
            expect(args.data).toEqual({
                branchId: BRANCH,
                date: new Date("2026-12-24T00:00:00.000Z"),
                change: "added",
                name: "임시",
                source: "branch",
                processedAt: null,
            });
            expect(checkWriteArgs("create", args, BRANCH)).toBeNull();
        });
    });
});
