import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { ListHolidayReviewItemsQueryDto, ResolveHolidayReviewItemsDto } from "interface/dto/holiday-review.dto";
import { HolidayReviewController } from "./holiday-review.controller";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const OTHER_BRANCH = "33333333-3333-4333-8333-333333333333";
const USER = "99999999-9999-4999-8999-999999999999";
const EVENT = "22222222-2222-4222-8222-222222222222";

function makeController() {
    const reviewService = {
        listEvents: jest.fn(async () => []),
        listItems: jest.fn(async () => []),
        resolve: jest.fn(async () => ({ fixed: 0, kept: 0, skipped: [] })),
    };
    const tenantContext = new TenantContext();
    tenantContext.assign({ userId: USER, branchId: BRANCH, globalRole: "admin", branchRole: "manager" });
    const controller = new HolidayReviewController(reviewService as never, tenantContext);
    return { controller, reviewService };
}

function guardsOf(method: keyof HolidayReviewController): unknown[] {
    return Reflect.getMetadata("__guards__", HolidayReviewController.prototype[method]) ?? [];
}

describe("HolidayReviewController guards", () => {
    it.each(["listEvents", "listItems", "resolve"] as const)(
        "%s needs JwtGuard, TenantGuard, BranchManagerGuard in that order",
        (method) => {
            expect(guardsOf(method)).toEqual([JwtGuard, TenantGuard, BranchManagerGuard]);
        },
    );

    it("applies no class-level guards", () => {
        expect(Reflect.getMetadata("__guards__", HolidayReviewController)).toBeUndefined();
    });

    it("routes under /branches/:branchId/holidays/review-events with the resolve POST answering 200", () => {
        const path = (method: keyof HolidayReviewController) =>
            Reflect.getMetadata("path", HolidayReviewController.prototype[method]);
        expect(path("listEvents")).toBe("branches/:branchId/holidays/review-events");
        expect(path("listItems")).toBe("branches/:branchId/holidays/review-events/:id/items");
        expect(path("resolve")).toBe("branches/:branchId/holidays/review-events/:id/resolve");
        expect(Reflect.getMetadata("__httpCode__", HolidayReviewController.prototype.resolve)).toBe(200);
    });
});

describe("HolidayReviewController", () => {
    it("lists the open events of the tenant branch", async () => {
        const { controller, reviewService } = makeController();

        await controller.listEvents(BRANCH);

        expect(reviewService.listEvents).toHaveBeenCalledWith(BRANCH);
    });

    it("passes the filters through, trimming the name query and dropping an empty one", async () => {
        const { controller, reviewService } = makeController();

        await controller.listItems(BRANCH, EVENT, { category: "safe", status: "kept", q: "  김  " });
        await controller.listItems(BRANCH, EVENT, { q: "   " });

        expect(reviewService.listItems).toHaveBeenNthCalledWith(1, BRANCH, EVENT, {
            category: "safe",
            status: "kept",
            q: "김",
        });
        expect(reviewService.listItems).toHaveBeenNthCalledWith(2, BRANCH, EVENT, {
            category: undefined,
            status: undefined,
            q: undefined,
        });
    });

    it("resolves as the current user", async () => {
        const { controller, reviewService } = makeController();
        const itemIds = ["44444444-4444-4444-8444-444444444444"];

        await controller.resolve(BRANCH, EVENT, { itemIds, action: "fix" });

        expect(reviewService.resolve).toHaveBeenCalledWith(BRANCH, EVENT, USER, { itemIds, action: "fix" });
    });

    describe("branch mismatch", () => {
        it("403 on every endpoint, without touching the service", async () => {
            const { controller, reviewService } = makeController();
            const body = { itemIds: ["44444444-4444-4444-8444-444444444444"], action: "keep" as const };

            await expect(controller.listEvents(OTHER_BRANCH)).rejects.toBeInstanceOf(ForbiddenException);
            await expect(controller.listItems(OTHER_BRANCH, EVENT, {})).rejects.toBeInstanceOf(ForbiddenException);
            await expect(controller.resolve(OTHER_BRANCH, EVENT, body)).rejects.toBeInstanceOf(ForbiddenException);

            expect(reviewService.listEvents).not.toHaveBeenCalled();
            expect(reviewService.listItems).not.toHaveBeenCalled();
            expect(reviewService.resolve).not.toHaveBeenCalled();
        });

        it("reports ACCESS_DENIED", async () => {
            const { controller } = makeController();
            const error = await controller.listEvents(OTHER_BRANCH).catch((cause: unknown) => cause);
            expect((error as ForbiddenException).getResponse()).toMatchObject({ code: "ACCESS_DENIED" });
        });
    });

    describe("malformed event id", () => {
        it("404 RESOURCE_NOT_FOUND instead of a database error", async () => {
            const { controller, reviewService } = makeController();
            const body = { itemIds: ["44444444-4444-4444-8444-444444444444"], action: "keep" as const };

            const listed = await controller.listItems(BRANCH, "not-a-uuid", {}).catch((cause: unknown) => cause);
            const resolved = await controller.resolve(BRANCH, "not-a-uuid", body).catch((cause: unknown) => cause);

            for (const error of [listed, resolved]) {
                expect(error).toBeInstanceOf(NotFoundException);
                expect((error as NotFoundException).getResponse()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
            }
            expect(reviewService.listItems).not.toHaveBeenCalled();
            expect(reviewService.resolve).not.toHaveBeenCalled();
        });
    });
});

describe("holiday review DTO validation", () => {
    const ids = (count: number) =>
        Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    async function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
        const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
        return errors.map((e) => e.property);
    }

    describe("resolve body", () => {
        it("accepts 1..50 ids for fix and up to 500 for keep", async () => {
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(1), action: "fix" })).toEqual([]);
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(50), action: "fix" })).toEqual([]);
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(500), action: "keep" })).toEqual([]);
        });

        it("rejects 51 ids for fix but still accepts them for keep", async () => {
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(51), action: "fix" })).toEqual([
                "itemIds",
            ]);
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(51), action: "keep" })).toEqual([]);
        });

        it("rejects 501 ids for keep", async () => {
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(501), action: "keep" })).toEqual([
                "itemIds",
            ]);
        });

        it.each([
            ["an empty list", { itemIds: [], action: "keep" }],
            ["a missing list", { action: "keep" }],
            ["a non-array", { itemIds: ids(1)[0], action: "keep" }],
            ["a non-uuid id", { itemIds: ["abc"], action: "keep" }],
            ["duplicate ids", { itemIds: [ids(1)[0], ids(1)[0]], action: "keep" }],
            ["an unknown action", { itemIds: ids(1), action: "delete" }],
            ["a missing action", { itemIds: ids(1) }],
        ])("rejects %s", async (_label, body) => {
            expect((await errorsOf(ResolveHolidayReviewItemsDto, body)).length).toBeGreaterThan(0);
        });

        it("rejects unexpected fields", async () => {
            expect(await errorsOf(ResolveHolidayReviewItemsDto, { itemIds: ids(1), action: "keep", extra: 1 })).toEqual([
                "extra",
            ]);
        });
    });

    describe("items query", () => {
        it("accepts the documented filters, all optional", async () => {
            expect(await errorsOf(ListHolidayReviewItemsQueryDto, {})).toEqual([]);
            expect(
                await errorsOf(ListHolidayReviewItemsQueryDto, { category: "risk", status: "obsolete", q: "김" }),
            ).toEqual([]);
        });

        it.each([
            [{ category: "other" }, "category"],
            [{ status: "done" }, "status"],
            [{ q: "x".repeat(101) }, "q"],
        ])("rejects %j", async (query, property) => {
            expect(await errorsOf(ListHolidayReviewItemsQueryDto, query)).toEqual([property]);
        });
    });
});
