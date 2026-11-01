import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { SystemAdminService } from "application/services/system-admin.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { SystemAdminController } from "interface/controllers/system-admin.controller";

/**
 * Release-1 contract for the branch 지점장 field: `adminId` is the real name, `ownerId` is a
 * deprecated alias. The controller folds the alias in so the service only ever sees `adminId`.
 */
describe("SystemAdminController branch admin aliases (Integration)", () => {
    const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
    const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
    const OTHER_ID = "33333333-3333-4333-8333-333333333333";
    const branchInput = { name: "연수점", slug: "yeonsu", isActive: true };

    let app: INestApplication;
    let systemAdminService: { createBranch: jest.Mock; updateBranch: jest.Mock; listBranchRequests: jest.Mock };

    beforeEach(async () => {
        systemAdminService = {
            createBranch: jest.fn().mockResolvedValue({ id: BRANCH_ID }),
            updateBranch: jest.fn().mockResolvedValue({ id: BRANCH_ID }),
            listBranchRequests: jest.fn().mockResolvedValue([]),
        };
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [SystemAdminController],
            providers: [{ provide: SystemAdminService, useValue: systemAdminService }],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
                    context.switchToHttp().getRequest().user = { userId: "owner-user-id", role: "owner" };
                    return true;
                },
            })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.listen(0, "127.0.0.1");
    });

    afterEach(async () => {
        await app.close();
    });

    describe("POST /system-admin/branches", () => {
        it("accepts the new adminId name", async () => {
            const response = await request(app.getHttpServer())
                .post("/system-admin/branches")
                .send({ ...branchInput, adminId: ADMIN_ID });

            expect(response.status).toBe(201);
            expect(systemAdminService.createBranch).toHaveBeenCalledWith({ ...branchInput, adminId: ADMIN_ID });
        });

        it("still accepts the deprecated ownerId name and hands the service only adminId", async () => {
            const response = await request(app.getHttpServer())
                .post("/system-admin/branches")
                .send({ ...branchInput, ownerId: ADMIN_ID });

            expect(response.status).toBe(201);
            const dto = systemAdminService.createBranch.mock.calls[0]![0];
            expect(dto).toEqual({ ...branchInput, adminId: ADMIN_ID });
            expect(dto).not.toHaveProperty("ownerId");
        });

        it("accepts both names when they carry the same id", async () => {
            const response = await request(app.getHttpServer())
                .post("/system-admin/branches")
                .send({ ...branchInput, adminId: ADMIN_ID, ownerId: ADMIN_ID });

            expect(response.status).toBe(201);
            expect(systemAdminService.createBranch).toHaveBeenCalledWith({ ...branchInput, adminId: ADMIN_ID });
        });

        it("answers 400 pointing at /adminId when the two names disagree", async () => {
            const response = await request(app.getHttpServer())
                .post("/system-admin/branches")
                .send({ ...branchInput, adminId: ADMIN_ID, ownerId: OTHER_ID });

            expect(response.status).toBe(400);
            expect(response.body.errors).toEqual([expect.objectContaining({ pointer: "/adminId" })]);
            expect(systemAdminService.createBranch).not.toHaveBeenCalled();
        });
    });

    describe("PATCH /system-admin/branches/:branchId", () => {
        it("accepts the new adminId name", async () => {
            const response = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ adminId: ADMIN_ID });

            expect(response.status).toBe(200);
            expect(systemAdminService.updateBranch).toHaveBeenCalledWith(BRANCH_ID, { adminId: ADMIN_ID });
        });

        it("still accepts the deprecated ownerId name and hands the service only adminId", async () => {
            const response = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ ownerId: ADMIN_ID });

            expect(response.status).toBe(200);
            const dto = systemAdminService.updateBranch.mock.calls[0]![1];
            expect(dto).toEqual({ adminId: ADMIN_ID });
            expect(dto).not.toHaveProperty("ownerId");
        });

        it.each([["adminId"], ["ownerId"]])("clears the 지점장 through an explicit null %s", async (field) => {
            const response = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ [field]: null });

            expect(response.status).toBe(200);
            expect(systemAdminService.updateBranch).toHaveBeenCalledWith(BRANCH_ID, { adminId: null });
        });

        it("leaves the 지점장 untouched when neither name is sent", async () => {
            const response = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ name: "새 이름" });

            expect(response.status).toBe(200);
            expect(systemAdminService.updateBranch).toHaveBeenCalledWith(BRANCH_ID, { name: "새 이름" });
        });

        it("answers 400 pointing at /adminId when the two names disagree (including a null against an id)", async () => {
            const conflicting = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ adminId: ADMIN_ID, ownerId: OTHER_ID });
            const nullAgainstId = await request(app.getHttpServer())
                .patch(`/system-admin/branches/${BRANCH_ID}`)
                .send({ adminId: null, ownerId: OTHER_ID });

            expect(conflicting.status).toBe(400);
            expect(conflicting.body.errors).toEqual([expect.objectContaining({ pointer: "/adminId" })]);
            expect(nullAgainstId.status).toBe(400);
            expect(systemAdminService.updateBranch).not.toHaveBeenCalled();
        });
    });
});
