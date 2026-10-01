import { ForbiddenException, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { HolidayReviewResolveService } from "application/services/holiday-review-resolve.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { HolidayReviewController } from "interface/controllers/holiday-review.controller";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

const ids = (count: number) =>
    Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("HolidayReviewController (HTTP)", () => {
    let app: INestApplication;
    let managerAllowed: boolean;
    const reviewService = {
        listEvents: jest.fn(),
        listItems: jest.fn(),
        resolve: jest.fn(),
    };

    beforeEach(async () => {
        managerAllowed = true;
        jest.resetAllMocks();
        reviewService.listEvents.mockResolvedValue([]);
        reviewService.listItems.mockResolvedValue([]);
        reviewService.resolve.mockResolvedValue({ fixed: 0, kept: 0, skipped: [] });

        const module = await Test.createTestingModule({
            controllers: [HolidayReviewController],
            providers: [
                { provide: HolidayReviewResolveService, useValue: reviewService },
                { provide: TenantContext, useValue: { branchId: BRANCH, userId: USER } },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(TenantGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(BranchManagerGuard)
            .useValue({
                canActivate: () => {
                    if (!managerAllowed) throw new ForbiddenException({ code: "ACCESS_DENIED" });
                    return true;
                },
            })
            .compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const base = `/branches/${BRANCH}/holidays/review-events`;

    it("lists the events", async () => {
        reviewService.listEvents.mockResolvedValue([{ id: EVENT, safeOpen: 1, riskOpen: 0 }]);

        const response = await request(app.getHttpServer()).get(base).expect(200);

        expect(response.body).toEqual([{ id: EVENT, safeOpen: 1, riskOpen: 0 }]);
        expect(reviewService.listEvents).toHaveBeenCalledWith(BRANCH);
    });

    it("passes the item filters to the service", async () => {
        await request(app.getHttpServer())
            .get(`${base}/${EVENT}/items`)
            .query({ category: "safe", status: "open", q: "김" })
            .expect(200);

        expect(reviewService.listItems).toHaveBeenCalledWith(BRANCH, EVENT, {
            category: "safe",
            status: "open",
            q: "김",
        });
    });

    it("rejects an unknown filter value with VALIDATION_FAILED", async () => {
        const response = await request(app.getHttpServer())
            .get(`${base}/${EVENT}/items`)
            .query({ status: "done" })
            .expect(400);

        expect(response.body).toMatchObject({ code: "VALIDATION_FAILED" });
        expect(reviewService.listItems).not.toHaveBeenCalled();
    });

    it("404s RESOURCE_NOT_FOUND for a malformed event id", async () => {
        const response = await request(app.getHttpServer()).get(`${base}/not-a-uuid/items`).expect(404);

        expect(response.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
        expect(reviewService.listItems).not.toHaveBeenCalled();
    });

    it("403s a path branch that is not the caller's branch", async () => {
        const response = await request(app.getHttpServer())
            .get("/branches/33333333-3333-4333-8333-333333333333/holidays/review-events")
            .expect(403);

        expect(response.body).toMatchObject({ code: "ACCESS_DENIED" });
        expect(reviewService.listEvents).not.toHaveBeenCalled();
    });

    it("answers 403 on every route when the caller is not a branch manager", async () => {
        managerAllowed = false;
        const server = app.getHttpServer();

        await request(server).get(base).expect(403);
        await request(server).get(`${base}/${EVENT}/items`).expect(403);
        await request(server).post(`${base}/${EVENT}/resolve`).send({ itemIds: ids(1), action: "keep" }).expect(403);
        expect(reviewService.resolve).not.toHaveBeenCalled();
    });

    describe("POST resolve", () => {
        it("answers 200 with the service result and acts as the current user", async () => {
            reviewService.resolve.mockResolvedValue({ fixed: 1, kept: 0, skipped: [{ itemId: ids(2)[1], code: "ITEM_RISK" }] });

            const response = await request(app.getHttpServer())
                .post(`${base}/${EVENT}/resolve`)
                .send({ itemIds: ids(2), action: "fix" })
                .expect(200);

            expect(response.body).toEqual({ fixed: 1, kept: 0, skipped: [{ itemId: ids(2)[1], code: "ITEM_RISK" }] });
            expect(reviewService.resolve).toHaveBeenCalledWith(BRANCH, EVENT, USER, { itemIds: ids(2), action: "fix" });
        });

        it("accepts 50 ids for fix and 500 for keep", async () => {
            await request(app.getHttpServer()).post(`${base}/${EVENT}/resolve`).send({ itemIds: ids(50), action: "fix" }).expect(200);
            await request(app.getHttpServer()).post(`${base}/${EVENT}/resolve`).send({ itemIds: ids(500), action: "keep" }).expect(200);
        });

        it.each([
            ["51 ids for fix", { itemIds: ids(51), action: "fix" }],
            ["501 ids for keep", { itemIds: ids(501), action: "keep" }],
            ["no ids", { itemIds: [], action: "keep" }],
            ["a non-uuid id", { itemIds: ["abc"], action: "keep" }],
            ["duplicate ids", { itemIds: [ids(1)[0], ids(1)[0]], action: "keep" }],
            ["an unknown action", { itemIds: ids(1), action: "delete" }],
            ["an unexpected field", { itemIds: ids(1), action: "keep", force: true }],
        ])("rejects %s with VALIDATION_FAILED", async (_label, body) => {
            const response = await request(app.getHttpServer()).post(`${base}/${EVENT}/resolve`).send(body).expect(400);

            expect(response.body).toMatchObject({ code: "VALIDATION_FAILED" });
            expect(reviewService.resolve).not.toHaveBeenCalled();
        });
    });
});
