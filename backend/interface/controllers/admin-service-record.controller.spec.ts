import "reflect-metadata";

import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantGuard } from "infrastructure/tenant";

import {
    AdminServiceRecordController,
    AdminServiceRecordNoQueryPipe,
} from "./admin-service-record.controller";

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

describe("AdminServiceRecordController query boundary", () => {
    let app: INestApplication;
    const adminService = {
        getClientEditor: jest.fn(),
    };
    const editService = {
        startDraft: jest.fn(),
    };

    const guard = {
        canActivate: (context: ExecutionContext) => {
            const requestContext = context.switchToHttp().getRequest();
            requestContext.user = { userId: "admin-1" };
            requestContext.tenant = {
                branchId: BRANCH_ID,
                userId: "admin-1",
                globalRole: "admin",
                branchRole: "admin",
            };
            return true;
        },
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [AdminServiceRecordController],
            providers: [
                { provide: AdminServiceRecordService, useValue: adminService },
                { provide: AdminServiceRecordEditService, useValue: editService },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(guard)
            .overrideGuard(TenantGuard)
            .useValue(guard)
            .overrideGuard(OwnerOrAdminGuard)
            .useValue(guard)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        adminService.getClientEditor.mockResolvedValue({ record: null, assignments: [] });
        editService.startDraft.mockResolvedValue({ draft: null, sourceChanged: false });
    });

    it("rejects a forged query on a read route before the service sees the request", async () => {
        await request(app.getHttpServer())
            .get("/admin/service-records/client/42/editor")
            .query({ branchId: "22222222-2222-2222-2222-222222222222" })
            .expect(400);

        expect(adminService.getClientEditor).not.toHaveBeenCalled();
    });

    it("rejects a forged query on a write route while an omitted query remains valid", async () => {
        await request(app.getHttpServer())
            .post("/admin/service-records/client/42/draft")
            .send({})
            .expect(201);
        expect(editService.startDraft).toHaveBeenCalledWith(
            BRANCH_ID,
            42,
            "admin-1",
            {},
        );

        jest.clearAllMocks();
        await request(app.getHttpServer())
            .post("/admin/service-records/client/42/draft")
            .query({ branchId: "22222222-2222-2222-2222-222222222222" })
            .send({})
            .expect(400);

        expect(editService.startDraft).not.toHaveBeenCalled();
    });

    it("rejects non-object values if the parameter pipe is invoked directly", () => {
        expect(() => new AdminServiceRecordNoQueryPipe().transform(["branchId"])).toThrow(
            /query parameter/,
        );
    });
});
