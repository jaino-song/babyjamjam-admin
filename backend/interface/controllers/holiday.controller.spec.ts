import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { CreateHolidayOverrideDto, GetHolidaysQueryDto } from "interface/dto/holiday.dto";
import { HolidayController } from "./holiday.controller";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const OTHER_BRANCH = "33333333-3333-4333-8333-333333333333";
const USER = "99999999-9999-4999-8999-999999999999";
const OVERRIDE_ID = "22222222-2222-4222-8222-222222222222";

function makeController() {
    const calendarService = {
        getEffectiveYear: jest.fn(async () => ({ year: 2026, holidays: [] })),
    };
    const overrideService = {
        createOverride: jest.fn(async () => ({ id: OVERRIDE_ID })),
        deleteOverride: jest.fn(async () => undefined),
    };
    const tenantContext = new TenantContext();
    tenantContext.assign({ userId: USER, branchId: BRANCH, globalRole: "admin", branchRole: "manager" });
    const controller = new HolidayController(calendarService as never, overrideService as never, tenantContext);
    return { controller, calendarService, overrideService };
}

function guardsOf(method: keyof HolidayController): unknown[] {
    return Reflect.getMetadata("__guards__", HolidayController.prototype[method]) ?? [];
}

describe("HolidayController guards", () => {
    it("reads need JwtGuard + TenantGuard only (any branch member)", () => {
        expect(guardsOf("list")).toEqual([JwtGuard, TenantGuard]);
    });

    it.each(["createOverride", "deleteOverride"] as const)(
        "%s needs JwtGuard, TenantGuard, BranchManagerGuard in that order",
        (method) => {
            expect(guardsOf(method)).toEqual([JwtGuard, TenantGuard, BranchManagerGuard]);
        },
    );

    it("applies no class-level guards (reads stay open to all members)", () => {
        expect(Reflect.getMetadata("__guards__", HolidayController)).toBeUndefined();
    });
});

describe("HolidayController.list", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("returns the effective year for the branch, bypassing the revision cache", async () => {
        const { controller, calendarService } = makeController();

        await controller.list(BRANCH, { year: 2027 });

        expect(calendarService.getEffectiveYear).toHaveBeenCalledWith(BRANCH, 2027, { fresh: true });
    });

    it("defaults the year to the current KST year", async () => {
        // 2026-12-31T20:00Z is already 2027-01-01 in Korea.
        jest.useFakeTimers().setSystemTime(new Date("2026-12-31T20:00:00.000Z"));
        const { controller, calendarService } = makeController();

        await controller.list(BRANCH, {});

        expect(calendarService.getEffectiveYear).toHaveBeenCalledWith(BRANCH, 2027, { fresh: true });
    });

    it("403 ACCESS_DENIED when the path branch differs from the tenant branch", () => {
        const { controller, calendarService } = makeController();

        const call = controller.list(OTHER_BRANCH, { year: 2026 });

        return expect(call).rejects.toBeInstanceOf(ForbiddenException).then(() => {
            expect(calendarService.getEffectiveYear).not.toHaveBeenCalled();
        });
    });
});

describe("HolidayController.createOverride", () => {
    it("creates the override for the tenant branch with createdBy from the request user", async () => {
        const { controller, overrideService } = makeController();

        const result = await controller.createOverride(BRANCH, { date: "2026-12-24", kind: "add", name: "임시 휴무" });

        expect(overrideService.createOverride).toHaveBeenCalledWith(BRANCH, USER, {
            date: "2026-12-24",
            kind: "add",
            name: "임시 휴무",
        });
        expect(result).toEqual({ id: OVERRIDE_ID });
    });

    it("403 on a branch mismatch, without touching the service", async () => {
        const { controller, overrideService } = makeController();

        await expect(
            controller.createOverride(OTHER_BRANCH, { date: "2026-12-24", kind: "add", name: "x" }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(overrideService.createOverride).not.toHaveBeenCalled();
    });
});

describe("HolidayController.deleteOverride", () => {
    it("deletes within the tenant branch and answers { success: true }", async () => {
        const { controller, overrideService } = makeController();

        await expect(controller.deleteOverride(BRANCH, OVERRIDE_ID)).resolves.toEqual({ success: true });
        expect(overrideService.deleteOverride).toHaveBeenCalledWith(BRANCH, OVERRIDE_ID);
    });

    it("403 on a branch mismatch", async () => {
        const { controller, overrideService } = makeController();

        await expect(controller.deleteOverride(OTHER_BRANCH, OVERRIDE_ID)).rejects.toBeInstanceOf(ForbiddenException);
        expect(overrideService.deleteOverride).not.toHaveBeenCalled();
    });

    it("404 for a malformed id instead of a database error", async () => {
        const { controller, overrideService } = makeController();

        await expect(controller.deleteOverride(BRANCH, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundException);
        expect(overrideService.deleteOverride).not.toHaveBeenCalled();
    });
});

describe("holiday DTO validation", () => {
    async function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
        const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
        return errors.map((e) => e.property);
    }

    it.each([[2000], [2026], [2100]])("accepts year %s", async (year) => {
        expect(await errorsOf(GetHolidaysQueryDto, { year: String(year) })).toEqual([]);
    });

    it.each([["1999"], ["2101"], ["abc"], ["2026.5"]])("rejects year %s", async (year) => {
        expect(await errorsOf(GetHolidaysQueryDto, { year })).toEqual(["year"]);
    });

    it("accepts an omitted year", async () => {
        expect(await errorsOf(GetHolidaysQueryDto, {})).toEqual([]);
    });

    it("accepts a valid add and a nameless exclude", async () => {
        expect(await errorsOf(CreateHolidayOverrideDto, { date: "2026-12-24", kind: "add", name: "임시 휴무" })).toEqual([]);
        expect(await errorsOf(CreateHolidayOverrideDto, { date: "2026-12-24", kind: "exclude" })).toEqual([]);
    });

    it.each([["2026-13-01"], ["2026-02-30"], ["2026-1-5"], ["20261224"], ["2026-12-24T00:00:00Z"], [""]])(
        "rejects date %p",
        async (date) => {
            expect(await errorsOf(CreateHolidayOverrideDto, { date, kind: "add", name: "x" })).toContain("date");
        },
    );

    it("rejects an unknown kind, a too-long name and undeclared fields", async () => {
        expect(await errorsOf(CreateHolidayOverrideDto, { date: "2026-12-24", kind: "remove" })).toEqual(["kind"]);
        expect(
            await errorsOf(CreateHolidayOverrideDto, { date: "2026-12-24", kind: "add", name: "가".repeat(51) }),
        ).toEqual(["name"]);
        expect(
            await errorsOf(CreateHolidayOverrideDto, { date: "2026-12-24", kind: "add", name: "x", branchId: "b" }),
        ).toEqual(["branchId"]);
    });
});
