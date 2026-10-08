import "reflect-metadata";

import { ExecutionContext, INestApplication, MessageEvent } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { Subscription } from "rxjs";
import request from "supertest";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { ServiceRecordCaseEventBus } from "application/services/service-record-case-event-bus.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
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
                ServiceRecordCaseEventBus,
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
            .expect(400)
            .expect((res) => {
                expect(res.body).toEqual(expect.objectContaining({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" }));
                expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNEXPECTED_FIELD" })]));
            });

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

describe("AdminServiceRecordController case-changed events", () => {
    const BRANCH_B = "22222222-2222-2222-2222-222222222222";
    let bus: ServiceRecordCaseEventBus;
    let controller: AdminServiceRecordController;
    let subscription: Subscription | undefined;

    const tenantFor = (branchId: string | undefined) => ({ branchId } as never);

    beforeEach(() => {
        jest.useFakeTimers();
        bus = new ServiceRecordCaseEventBus();
        controller = new AdminServiceRecordController(
            {} as AdminServiceRecordService,
            {} as AdminServiceRecordEditService,
            bus,
        );
    });

    afterEach(() => {
        subscription?.unsubscribe();
        subscription = undefined;
        jest.useRealTimers();
    });

    it("is GET /admin/service-records/events guarded by BranchManagerGuard", () => {
        const handler = AdminServiceRecordController.prototype.events;
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("events");
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([BranchManagerGuard]);
        expect(Reflect.getMetadata(PATH_METADATA, AdminServiceRecordController)).toBe("admin/service-records");
    });

    it("streams only the caller branch's events as case-changed without the branch id", () => {
        const received: MessageEvent[] = [];
        subscription = controller.events(tenantFor(BRANCH_ID)).subscribe((e) => received.push(e));

        bus.emit({ branchId: BRANCH_B, clientId: 7, caseId: "case-b", caseVersion: 1 });
        bus.emit({ branchId: BRANCH_ID, clientId: 42, caseId: "case-a", caseVersion: 3 });

        expect(received).toEqual([
            { type: "case-changed", data: { clientId: 42, caseId: "case-a", caseVersion: 3 } },
        ]);
        expect(JSON.stringify(received[0]!.data)).not.toContain("branchId");
    });

    it("emits no case events when the caller has no branch", () => {
        const received: MessageEvent[] = [];
        subscription = controller.events(tenantFor(undefined)).subscribe((e) => received.push(e));

        bus.emit({ branchId: "", clientId: 1, caseId: "case-x", caseVersion: 1 });
        bus.emit({ branchId: BRANCH_ID, clientId: 42, caseId: "case-a", caseVersion: 3 });

        expect(received).toEqual([]);
    });

    it("sends a ping heartbeat every 30 seconds", () => {
        const received: MessageEvent[] = [];
        subscription = controller.events(tenantFor(BRANCH_ID)).subscribe((e) => received.push(e));

        jest.advanceTimersByTime(29999);
        expect(received).toHaveLength(0);
        jest.advanceTimersByTime(1);
        expect(received).toHaveLength(1);
        expect(received[0]!.type).toBe("ping");
        expect(received[0]!.data).toEqual({ at: expect.any(Number) });
    });
});
