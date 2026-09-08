import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
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
    let adminServiceRecordEditService: {
        startDraft: jest.Mock;
        getDraft: jest.Mock;
        updateDraft: jest.Mock;
        discardDraft: jest.Mock;
    };

    beforeEach(async () => {
        adminServiceRecordService = {
            getClientEditor: jest.fn(),
        };
        adminServiceRecordEditService = {
            startDraft: jest.fn(),
            getDraft: jest.fn(),
            updateDraft: jest.fn(),
            discardDraft: jest.fn(),
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [AdminServiceRecordController],
            providers: [
                {
                    provide: AdminServiceRecordService,
                    useValue: adminServiceRecordService,
                },
                {
                    provide: AdminServiceRecordEditService,
                    useValue: adminServiceRecordEditService,
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

    it.each([
        ["startDraft", RequestMethod.POST, "client/:clientId/draft"],
        ["getDraft", RequestMethod.GET, "client/:clientId/draft"],
        ["updateDraft", RequestMethod.PATCH, "drafts/:draftId"],
        ["discardDraft", RequestMethod.POST, "drafts/:draftId/discard"],
    ] as const)("protects %s with owner/admin authority", (methodName, httpMethod, path) => {
        const handler = AdminServiceRecordController.prototype[methodName];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).toContain(OwnerOrAdminGuard);
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(httpMethod);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    });

    it("forwards the authenticated actor and branch to draft mutations", async () => {
        const body = { changes: { header: { momName: "Draft" } } };
        const response = { draft: { id: "draft-1" }, sourceChanged: false };
        adminServiceRecordEditService.startDraft.mockResolvedValue(response);
        adminServiceRecordEditService.updateDraft.mockResolvedValue(response);
        adminServiceRecordEditService.discardDraft.mockResolvedValue(response);

        await expect(controller.startDraft(tenant, 42, body)).resolves.toBe(response);
        await expect(controller.updateDraft(tenant, "draft-1", {
            expectedDraftVersion: 1,
            changes: {},
        })).resolves.toBe(response);
        await expect(controller.discardDraft(tenant, "draft-1", { expectedDraftVersion: 2 })).resolves.toBe(response);

        expect(adminServiceRecordEditService.startDraft).toHaveBeenCalledWith("branch-1", 42, "admin-1", body);
        expect(adminServiceRecordEditService.updateDraft).toHaveBeenCalledWith("branch-1", "draft-1", "admin-1", {
            expectedDraftVersion: 1,
            changes: {},
        });
        expect(adminServiceRecordEditService.discardDraft).toHaveBeenCalledWith("branch-1", "draft-1", "admin-1", {
            expectedDraftVersion: 2,
        });
    });

    it("reads a draft through the branch-pinned service without creating one in the controller", async () => {
        const response = { draft: null, sourceChanged: false };
        adminServiceRecordEditService.getDraft.mockResolvedValue(response);

        await expect(controller.getDraft(tenant, 42)).resolves.toBe(response);
        expect(adminServiceRecordEditService.getDraft).toHaveBeenCalledWith("branch-1", 42);
    });
});
