import { HttpException, NotFoundException } from "@nestjs/common";

import {
    BranchHolidayOverrideRecord,
    CreateHolidayOverrideData,
    HolidayBranchChangeData,
    HolidayOverrideConflictError,
    IHolidayCalendarRepository,
    IHolidayOverrideTransaction,
} from "domain/repositories/holiday-calendar.repository.interface";
import { HolidayCalendarService } from "./holiday-calendar.service";
import { HolidayOverrideService } from "./holiday-override.service";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const OVERRIDE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-01T03:00:00.000Z"); // 12:00 KST, 2026-10-01

function savedRecord(partial: Partial<BranchHolidayOverrideRecord> = {}): BranchHolidayOverrideRecord {
    return {
        id: OVERRIDE_ID,
        branchId: BRANCH,
        date: "2026-12-24",
        kind: "add",
        name: "임시 휴무",
        createdBy: USER,
        createdAt: new Date("2026-10-01T03:00:00.000Z"),
        ...partial,
    };
}

function makeService() {
    const tx = {
        lookupPublicHoliday: jest
            .fn<Promise<{ yearSupported: boolean; publicName: string | null }>, [string]>()
            .mockResolvedValue({ yearSupported: true, publicName: null }),
        findOverride: jest
            .fn<Promise<BranchHolidayOverrideRecord | null>, [string, string]>()
            .mockResolvedValue(null),
        insertOverride: jest
            .fn<Promise<BranchHolidayOverrideRecord>, [CreateHolidayOverrideData]>()
            .mockImplementation(async (data) => savedRecord({ date: data.date, kind: data.kind, name: data.name })),
        deleteOverride: jest.fn<Promise<boolean>, [string, string]>().mockResolvedValue(true),
        insertBranchChangeEvent: jest.fn<Promise<void>, [HolidayBranchChangeData]>().mockResolvedValue(undefined),
    } satisfies IHolidayOverrideTransaction;
    const repository = {
        withOverrideTransaction: jest.fn(async <T>(operation: (t: IHolidayOverrideTransaction) => Promise<T>) => operation(tx)),
    };
    const calendar = { invalidateRevisionCache: jest.fn() };
    const service = new HolidayOverrideService(
        repository as unknown as IHolidayCalendarRepository,
        calendar as unknown as HolidayCalendarService,
    );
    return { service, tx, repository, calendar };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
    try {
        await promise;
    } catch (error) {
        return error as HttpException;
    }
    throw new Error("expected a rejection");
}

function expectProblem(error: HttpException, status: number, code: string) {
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code, outcome: "NOT_APPLIED" });
}

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
});

afterEach(() => {
    jest.useRealTimers();
});

describe("HolidayOverrideService.createOverride", () => {
    it("adds a branch holiday: override + 'added' event in one transaction, createdBy recorded", async () => {
        const { service, tx, repository, calendar } = makeService();

        const view = await service.createOverride(BRANCH, USER, { date: "2026-12-24", kind: "add", name: "  임시 휴무  " });

        expect(repository.withOverrideTransaction).toHaveBeenCalledTimes(1);
        expect(tx.insertOverride).toHaveBeenCalledWith({
            branchId: BRANCH,
            date: "2026-12-24",
            kind: "add",
            name: "임시 휴무",
            createdBy: USER,
        });
        expect(tx.insertBranchChangeEvent).toHaveBeenCalledWith({
            branchId: BRANCH,
            date: "2026-12-24",
            change: "added",
            name: "임시 휴무",
        });
        expect(view).toEqual({
            id: OVERRIDE_ID,
            date: "2026-12-24",
            kind: "add",
            name: "임시 휴무",
            createdAt: "2026-10-01T03:00:00.000Z",
        });
        expect(calendar.invalidateRevisionCache).toHaveBeenCalled();
    });

    it("excludes a public holiday: copies the public name and writes a 'removed' event", async () => {
        const { service, tx } = makeService();
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: "개천절" });

        await service.createOverride(BRANCH, USER, { date: "2026-10-03", kind: "exclude" });

        expect(tx.insertOverride).toHaveBeenCalledWith(expect.objectContaining({ kind: "exclude", name: "개천절" }));
        expect(tx.insertBranchChangeEvent).toHaveBeenCalledWith({
            branchId: BRANCH,
            date: "2026-10-03",
            change: "removed",
            name: "개천절",
        });
    });

    it("keeps a supplied name on exclude", async () => {
        const { service, tx } = makeService();
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: "개천절" });

        await service.createOverride(BRANCH, null, { date: "2026-10-03", kind: "exclude", name: "근무일" });

        expect(tx.insertOverride).toHaveBeenCalledWith(expect.objectContaining({ name: "근무일", createdBy: null }));
    });

    it("accepts today (KST) as the date", async () => {
        const { service } = makeService();

        await expect(
            service.createOverride(BRANCH, USER, { date: "2026-10-01", kind: "add", name: "오늘" }),
        ).resolves.toMatchObject({ kind: "add" });
    });

    it("HOLIDAY_DATE_IN_PAST (409) before any transaction when the date is before today in KST", async () => {
        const { service, repository } = makeService();

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2026-09-30", kind: "add", name: "x" })),
            409,
            "HOLIDAY_DATE_IN_PAST",
        );
        expect(repository.withOverrideTransaction).not.toHaveBeenCalled();
    });

    it.each([
        ["missing", undefined],
        ["blank", "   "],
        ["too long", "가".repeat(51)],
    ])("HOLIDAY_NAME_REQUIRED (400) for an add with a %s name", async (_label, name) => {
        const { service, repository } = makeService();

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2026-12-24", kind: "add", name })),
            400,
            "HOLIDAY_NAME_REQUIRED",
        );
        expect(repository.withOverrideTransaction).not.toHaveBeenCalled();
    });

    it("HOLIDAY_YEAR_UNSUPPORTED (409) when the year has neither snapshot nor built-in data", async () => {
        const { service, tx } = makeService();
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: false, publicName: null });

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2090-05-01", kind: "add", name: "x" })),
            409,
            "HOLIDAY_YEAR_UNSUPPORTED",
        );
        expect(tx.insertOverride).not.toHaveBeenCalled();
        expect(tx.insertBranchChangeEvent).not.toHaveBeenCalled();
    });

    it("HOLIDAY_ALREADY_PUBLIC (409) when adding a date that is already a public holiday", async () => {
        const { service, tx } = makeService();
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: "개천절" });

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2026-10-03", kind: "add", name: "x" })),
            409,
            "HOLIDAY_ALREADY_PUBLIC",
        );
    });

    it.each([
        ["Saturday", "2026-12-26"],
        ["Sunday", "2026-12-27"],
    ])("HOLIDAY_NOT_WEEKDAY (400) when adding a %s", async (_label, date) => {
        const { service, tx } = makeService();

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date, kind: "add", name: "x" })),
            400,
            "HOLIDAY_NOT_WEEKDAY",
        );
        expect(tx.insertOverride).not.toHaveBeenCalled();
    });

    it("HOLIDAY_NOT_PUBLIC (409) when excluding a date that is not a public holiday", async () => {
        const { service } = makeService();

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2026-12-24", kind: "exclude" })),
            409,
            "HOLIDAY_NOT_PUBLIC",
        );
    });

    it("HOLIDAY_OVERRIDE_EXISTS (409) when the repository reports the unique violation", async () => {
        const { service, tx, calendar } = makeService();
        tx.insertOverride.mockRejectedValue(new HolidayOverrideConflictError());

        expectProblem(
            await rejection(service.createOverride(BRANCH, USER, { date: "2026-12-24", kind: "add", name: "x" })),
            409,
            "HOLIDAY_OVERRIDE_EXISTS",
        );
        expect(tx.insertBranchChangeEvent).not.toHaveBeenCalled();
        expect(calendar.invalidateRevisionCache).toHaveBeenCalled();
    });

    it("rethrows unexpected errors", async () => {
        const { service, tx } = makeService();
        const failure = new Error("db down");
        tx.insertOverride.mockRejectedValue(failure);

        await expect(
            service.createOverride(BRANCH, USER, { date: "2026-12-24", kind: "add", name: "x" }),
        ).rejects.toBe(failure);
    });
});

describe("HolidayOverrideService.deleteOverride", () => {
    it("removes an add override and writes the inverse 'removed' event", async () => {
        const { service, tx, calendar } = makeService();
        tx.findOverride.mockResolvedValue(savedRecord({ kind: "add", date: "2026-12-24", name: "임시 휴무" }));

        await service.deleteOverride(BRANCH, OVERRIDE_ID);

        expect(tx.findOverride).toHaveBeenCalledWith(OVERRIDE_ID, BRANCH);
        expect(tx.deleteOverride).toHaveBeenCalledWith(OVERRIDE_ID, BRANCH);
        expect(tx.insertBranchChangeEvent).toHaveBeenCalledWith({
            branchId: BRANCH,
            date: "2026-12-24",
            change: "removed",
            name: "임시 휴무",
        });
        expect(calendar.invalidateRevisionCache).toHaveBeenCalled();
    });

    it("removes an exclude override (다시 포함) and writes an 'added' event with the public name", async () => {
        const { service, tx } = makeService();
        tx.findOverride.mockResolvedValue(savedRecord({ kind: "exclude", date: "2026-10-03", name: null }));
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: "개천절" });

        await service.deleteOverride(BRANCH, OVERRIDE_ID);

        expect(tx.insertBranchChangeEvent).toHaveBeenCalledWith({
            branchId: BRANCH,
            date: "2026-10-03",
            change: "added",
            name: "개천절",
        });
    });

    it("writes no event when removing the override does not flip the date's effective state", async () => {
        const { service, tx } = makeService();
        // An exclude whose date is no longer public.
        tx.findOverride.mockResolvedValue(savedRecord({ kind: "exclude", date: "2026-10-03" }));
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: null });
        await service.deleteOverride(BRANCH, OVERRIDE_ID);

        // An add whose date a later sync made public.
        tx.findOverride.mockResolvedValue(savedRecord({ kind: "add", date: "2026-10-09" }));
        tx.lookupPublicHoliday.mockResolvedValue({ yearSupported: true, publicName: "한글날" });
        await service.deleteOverride(BRANCH, OVERRIDE_ID);

        expect(tx.deleteOverride).toHaveBeenCalledTimes(2);
        expect(tx.insertBranchChangeEvent).not.toHaveBeenCalled();
    });

    it("404 RESOURCE_NOT_FOUND for a missing or other branch's override", async () => {
        const { service, tx } = makeService();

        const error = await rejection(service.deleteOverride(BRANCH, OVERRIDE_ID));

        expect(error).toBeInstanceOf(NotFoundException);
        expectProblem(error, 404, "RESOURCE_NOT_FOUND");
        expect(tx.deleteOverride).not.toHaveBeenCalled();
    });

    it("404 RESOURCE_NOT_FOUND when the pinned delete removes nothing (concurrent delete)", async () => {
        const { service, tx } = makeService();
        tx.findOverride.mockResolvedValue(savedRecord());
        tx.deleteOverride.mockResolvedValue(false);

        expectProblem(await rejection(service.deleteOverride(BRANCH, OVERRIDE_ID)), 404, "RESOURCE_NOT_FOUND");
        expect(tx.insertBranchChangeEvent).not.toHaveBeenCalled();
    });

    it("HOLIDAY_DATE_IN_PAST (409) when the override's date has passed", async () => {
        const { service, tx } = makeService();
        tx.findOverride.mockResolvedValue(savedRecord({ date: "2026-09-30" }));

        expectProblem(await rejection(service.deleteOverride(BRANCH, OVERRIDE_ID)), 409, "HOLIDAY_DATE_IN_PAST");
        expect(tx.deleteOverride).not.toHaveBeenCalled();
    });
});
