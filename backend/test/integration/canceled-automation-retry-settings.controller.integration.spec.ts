import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { CanceledAutomationRetrySettingsController } from "interface/controllers/canceled-automation-retry-settings.controller";

describe("canceled automation retry settings HTTP boundary", () => {
    const path = "/settings/message-automation-policies/canceled-retry";
    const settings = { list: jest.fn(), update: jest.fn() };
    const findMembership = jest.fn();
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [CanceledAutomationRetrySettingsController],
            providers: [
                TenantContext,
                { provide: CanceledAutomationRetrySettingsService, useValue: settings },
                { provide: PrismaService, useValue: {
                    user_branch: { findFirst: findMembership },
                    branch: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
                } },
            ],
        }).overrideGuard(JwtGuard).useValue({
            canActivate(context: ExecutionContext) {
                const req = context.switchToHttp().getRequest();
                if (!req.headers["x-test-authenticated-branch"]) return false;
                req.user = { userId: "caller", branchId: req.headers["x-test-authenticated-branch"], role: "user" };
                return true;
            },
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
        await app.listen(0, "127.0.0.1");
    });

    afterAll(async () => app?.close());

    beforeEach(() => {
        jest.clearAllMocks();
        settings.list.mockResolvedValue([]);
        settings.update.mockResolvedValue({ enabled: true, enabledAt: "2026-11-23T08:00:00.000Z" });
        findMembership.mockImplementation(({ where }) => Promise.resolve({
            role: where.branchId === "branch-A" ? "admin" : "user",
            branch: { isActive: true },
        }));
    });

    it.each([["branch-A", true], ["branch-B", false]] as const)("lets the authenticated tenant %s read settings", async (branchId, canManageActivation) => {
        const response = await request(app.getHttpServer()).get(path)
            .query({ expectedBranchId: branchId }).set("x-test-authenticated-branch", branchId).expect(200);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.body).toEqual({ routines: [], canManageActivation });
        expect(settings.list).toHaveBeenCalledWith(branchId);
        expect(findMembership).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "caller", branchId } }));
    });

    it("requires current write permission", async () => {
        const url = `${path}/shared-info`;
        await request(app.getHttpServer()).put(url).query({ expectedBranchId: "branch-B" })
            .set("x-test-authenticated-branch", "branch-B").send({ enabled: true }).expect(403);
        expect(settings.update).not.toHaveBeenCalled();

        await request(app.getHttpServer()).put(url).query({ expectedBranchId: "branch-A" })
            .set("x-test-authenticated-branch", "branch-A").send({ enabled: true }).expect(200);
        expect(settings.update).toHaveBeenCalledWith("branch-A", "shared-info", true);

        findMembership.mockResolvedValue({ role: "user", branch: { isActive: true } });
        await request(app.getHttpServer()).put(url).query({ expectedBranchId: "branch-A" })
            .set("x-test-authenticated-branch", "branch-A").send({ enabled: false }).expect(403);
        expect(settings.update).toHaveBeenCalledTimes(1);
    });

    it("rejects branch switching between the captured request and authentication", async () => {
        findMembership.mockResolvedValue({ role: "admin", branch: { isActive: true } });
        const headers = { "x-test-authenticated-branch": "branch-B" };
        const response = await request(app.getHttpServer()).put(`${path}/shared-info`)
            .query({ expectedBranchId: "branch-A" }).set(headers).send({ enabled: true }).expect(409);
        expect(response.body.code).toBe("BRANCH_CONTEXT_CHANGED");
        await request(app.getHttpServer()).get(path).query({ expectedBranchId: "branch-A" }).set(headers).expect(409);
        await request(app.getHttpServer()).put(`${path}/shared-info`).set(headers).send({ enabled: true }).expect(409);
        expect(settings.update).not.toHaveBeenCalled();
        expect(settings.list).not.toHaveBeenCalled();
    });

    it.each([{ enabled: "false" }, { enabled: false, branchId: "branch-B" }, {}])("rejects invalid input %j", async (body) => {
        await request(app.getHttpServer()).put(`${path}/shared-info`).query({ expectedBranchId: "branch-A" })
            .set("x-test-authenticated-branch", "branch-A").send(body).expect(400);
        expect(settings.update).not.toHaveBeenCalled();
    });
});
