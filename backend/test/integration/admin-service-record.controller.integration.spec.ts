import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { AdminServiceRecordController } from "interface/controllers/admin-service-record.controller";

describe("AdminServiceRecordController (Integration)", () => {
    const tenant = {
        userId: "admin-1",
        branchId: "branch-1",
        globalRole: "admin",
        branchRole: "admin",
    };

    let moduleFixture: TestingModule;
    let controller: AdminServiceRecordController;
    let adminServiceRecordService: {
        getClientEditor: jest.Mock;
    };

    beforeEach(async () => {
        adminServiceRecordService = {
            getClientEditor: jest.fn(),
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [AdminServiceRecordController],
            providers: [
                {
                    provide: AdminServiceRecordService,
                    useValue: adminServiceRecordService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(TenantGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = moduleFixture.get(AdminServiceRecordController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    it("protects the read-only editor route with owner/admin authority", () => {
        const handler = AdminServiceRecordController.prototype.getClientEditor;
        expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).toContain(OwnerOrAdminGuard);
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("client/:clientId/editor");
    });

    it("leaves the legacy overview route guard surface unchanged", () => {
        const handler = AdminServiceRecordController.prototype.getClientOverview;
        expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).not.toContain(OwnerOrAdminGuard);
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("client/:clientId");
    });

    it("passes the verified tenant branch to the read-only service path", async () => {
        const overview = { record: null, assignments: [] };
        adminServiceRecordService.getClientEditor.mockResolvedValue(overview);

        await expect(controller.getClientEditor(tenant, 42)).resolves.toBe(overview);
        expect(adminServiceRecordService.getClientEditor).toHaveBeenCalledWith("branch-1", 42);
    });
});
