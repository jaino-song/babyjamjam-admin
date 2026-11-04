import { Test, TestingModule } from "@nestjs/testing";
import {
    BadRequestException,
    ConflictException,
    ExecutionContext,
    INestApplication,
    NotFoundException,
    ValidationPipe,
} from "@nestjs/common";
import request from "supertest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { MessageTriggerController } from "interface/controllers/message-trigger.controller";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import {
    MessageTriggerService,
    type MessageLogRecordView,
    type UpcomingMessageTriggerJobView,
} from "application/services/message-trigger.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
    type MessageTriggerTemplateCatalogItem,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { SmsRetryService } from "application/services/sms-retry.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";

describe("MessageTriggerController (Integration)", () => {
    type RuleOverrides = Partial<{
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        createdAt: Date;
        updatedAt: Date;
    }>;

    let app: INestApplication;
    let triggerService: {
        listRules: jest.Mock;
        listUpcomingJobs: jest.Mock;
        listClientUpcomingJobs: jest.Mock;
        listHistory: jest.Mock;
        listHistoryPage: jest.Mock;
        listClientHistoryPage: jest.Mock;
        cancelJobByUser: jest.Mock;
        resendNeedsSetupJob: jest.Mock;
        rescheduleJobForDebug: jest.Mock;
        createRule: jest.Mock;
        getRule: jest.Mock;
        updateRule: jest.Mock;
        updateRuleBranchActivation: jest.Mock;
        deleteRule: jest.Mock;
        listTemplates: jest.Mock;
    };
    let smsRetryService: {
        retryById: jest.Mock;
    };
    let authRole = "admin";

    const branchId = "org-1";

    const createMockRule = (
        overrides: RuleOverrides = {},
    ) =>
        MessageTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            overrides.branchId ?? branchId,
            overrides.name ?? "고객 등록 즉시 발송",
            overrides.isActive ?? true,
            overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
            overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2025-01-02T00:00:00.000Z"),
        );

    const createMockUpcomingJob = (
        overrides: Partial<UpcomingMessageTriggerJobView> = {},
    ): UpcomingMessageTriggerJobView => ({
        id: overrides.id ?? "job-1",
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        recipientType: overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
        recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
        templateKey: overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
        status: overrides.status ?? "pending",
        scheduledFor: overrides.scheduledFor ?? new Date("2025-01-03T09:00:00.000Z"),
        sentAt: overrides.sentAt ?? null,
        canceledAt: overrides.canceledAt ?? null,
        cancelReason: overrides.cancelReason ?? null,
        clientId: overrides.clientId ?? 101,
        employeeScheduleId: overrides.employeeScheduleId ?? null,
        payload: overrides.payload ?? {
            memberId: "101",
            recipientName: "김고객",
            recipientPhone: "010-1234-5678",
            templateVariables: {
                clientName: "김고객",
            },
        },
        createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: overrides.updatedAt ?? new Date("2025-01-01T00:00:00.000Z"),
    });

    const createMockHistoryRecord = (
        overrides: Partial<MessageLogRecordView> = {},
    ): MessageLogRecordView => ({
        id: overrides.id ?? 1,
        provider: overrides.provider ?? "aligo_sms",
        templateKey: overrides.templateKey ?? MessageTriggerTemplateKey.SERVICE_INFO,
        triggerJobId: overrides.triggerJobId ?? "job-1",
        receiver: overrides.receiver ?? "010-1234-5678",
        clientId: overrides.clientId ?? 101,
        recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
        messageBody: overrides.messageBody ?? "고객 등록 안내 메시지",
        variables: overrides.variables ?? { clientName: "김고객" },
        status: overrides.status ?? "sent",
        resentByLogId: overrides.resentByLogId ?? null,
        retryBlockedByLogId: overrides.retryBlockedByLogId ?? null,
        aligoMid: overrides.aligoMid ?? "mid-1",
        errorMessage: overrides.errorMessage ?? null,
        attempts: overrides.attempts ?? 1,
        lastAttemptAt: overrides.lastAttemptAt ?? new Date("2025-01-03T09:01:00.000Z"),
        nextRetryAt: overrides.nextRetryAt ?? null,
        createdAt: overrides.createdAt ?? new Date("2025-01-03T09:00:00.000Z"),
        updatedAt: overrides.updatedAt ?? new Date("2025-01-03T09:01:00.000Z"),
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        scheduledFor: overrides.scheduledFor ?? new Date("2025-01-03T09:00:00.000Z"),
        recipientType: overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
        recipientName: overrides.recipientName ?? "김고객",
        clientName: overrides.clientName ?? "김고객",
        employeeName: overrides.employeeName ?? null,
    });

    const createMockTemplate = (
        overrides: Partial<MessageTriggerTemplateCatalogItem> = {},
    ): MessageTriggerTemplateCatalogItem => ({
        key: overrides.key ?? MessageTriggerTemplateKey.SERVICE_INFO,
        name: overrides.name ?? "서비스 안내",
        description: overrides.description ?? "서비스 시작 전 안내",
        allowedEventTypes: overrides.allowedEventTypes ?? [MessageTriggerEventType.SERVICE_START],
        allowedRecipientTypes: overrides.allowedRecipientTypes ?? [MessageTriggerRecipientType.CLIENT],
        requiredVariables: overrides.requiredVariables ?? [{ key: "clientName", label: "고객명" }],
        providers: overrides.providers ?? {
            sms: { templateKey: "SERVICE_INFO" },
        },
    });

    beforeEach(async () => {
        authRole = "admin";
        triggerService = {
            listRules: jest.fn(),
            listUpcomingJobs: jest.fn(),
            listClientUpcomingJobs: jest.fn(),
            listHistory: jest.fn(),
            listHistoryPage: jest.fn(),
            listClientHistoryPage: jest.fn(),
            cancelJobByUser: jest.fn(),
            resendNeedsSetupJob: jest.fn(),
            rescheduleJobForDebug: jest.fn(),
            createRule: jest.fn(),
            getRule: jest.fn(),
            updateRule: jest.fn(),
            updateRuleBranchActivation: jest.fn(),
            deleteRule: jest.fn(),
            listTemplates: jest.fn(),
        };
        smsRetryService = {
            retryById: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = {
                    userId: "user-1",
                    branchId,
                    role: authRole,
                    branchRole: authRole,
                };
                requestContext.tenant = {
                    userId: "user-1",
                    branchId,
                    globalRole: authRole,
                    branchRole: authRole,
                };
                return true;
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [MessageTriggerController],
            providers: [
                BranchManagerGuard,
                {
                    provide: MessageTriggerService,
                    useValue: triggerService,
                },
                {
                    provide: SmsRetryService,
                    useValue: smsRetryService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.listen(0, "127.0.0.1");
    });

    afterEach(async () => {
        await app.close();
    });

    it("requires branch-manager guard on every message-trigger mutation while leaving reads tenant-only", () => {
        const mutationHandlers = [
            "cancelJob",
            "resendJob",
            "retryHistory",
            "reconcileHistory",
            "createRule",
            "updateRule",
            "updateBranchActivation",
            "activateRuleWithParent",
            "deleteRule",
        ] as const;
        for (const methodName of mutationHandlers) {
            expect(Reflect.getMetadata(GUARDS_METADATA, MessageTriggerController.prototype[methodName]) ?? [])
                .toContain(BranchManagerGuard);
        }
        expect(Reflect.getMetadata(GUARDS_METADATA, MessageTriggerController.prototype.listRules) ?? [])
            .not.toContain(BranchManagerGuard);
    });

    describe("rule sendTime validation", () => {
        it.each(["24:00", "09:60", "9:00", "09:00:00", "", null])("rejects invalid update %s before persistence", async (sendTime) => {
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-1").send({ sendTime });
            expect(response.status).toBe(400);
            expect(triggerService.updateRule).not.toHaveBeenCalled();
        });
        it("passes minute-precision KST time to the owning tenant service", async () => {
            triggerService.updateRule.mockResolvedValue({ ...createMockRule(), sendTime: "23:59" });
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-1").send({ sendTime: "23:59" });
            expect(response.status).toBe(200);
            expect(response.body.sendTime).toBe("23:59");
            expect(triggerService.updateRule).toHaveBeenCalledWith(branchId, "rule-1", expect.objectContaining({ sendTime: "23:59" }));
        });
    });

    describe("rule target client status / retry-on-failure validation (규칙 메시지-04)", () => {
        it.each(["completed", "terminated", "ALL", "", null, 1])(
            "rejects targetClientStatus %p on update before persistence",
            async (targetClientStatus) => {
                const response = await request(app.getHttpServer())
                    .patch("/message-trigger-rules/rule-1").send({ targetClientStatus });
                expect(response.status).toBe(400);
                expect(triggerService.updateRule).not.toHaveBeenCalled();
            },
        );
        it.each(["yes", 1, null, "false"])("rejects retryOnFailure %p on update before persistence", async (retryOnFailure) => {
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-1").send({ retryOnFailure });
            expect(response.status).toBe(400);
            expect(triggerService.updateRule).not.toHaveBeenCalled();
        });
        it("rejects an unknown status on create before persistence", async () => {
            const response = await request(app.getHttpServer()).post("/message-trigger-rules").send({
                name: "신규", eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE, recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING, targetClientStatus: "completed",
            });
            expect(response.status).toBe(400);
            expect(triggerService.createRule).not.toHaveBeenCalled();
        });
        it.each(["all", "pre_booking", "waiting", "active"])("passes %s and retryOnFailure=false to the tenant service and returns both", async (targetClientStatus) => {
            const rule = createMockRule();
            rule.targetClientStatus = targetClientStatus as never;
            rule.retryOnFailure = false;
            triggerService.updateRule.mockResolvedValue(rule);
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-1").send({ targetClientStatus, retryOnFailure: false });
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ targetClientStatus, retryOnFailure: false });
            expect(triggerService.updateRule).toHaveBeenCalledWith(
                branchId, "rule-1", expect.objectContaining({ targetClientStatus, retryOnFailure: false }),
            );
        });
        it("returns the default 전체 / 켬 for a rule payload", async () => {
            triggerService.getRule.mockResolvedValue(createMockRule());
            const response = await request(app.getHttpServer()).get("/message-trigger-rules/rule-1");
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ targetClientStatus: "all", retryOnFailure: true });
        });
    });

    describe("GET /message-trigger-rules", () => {
        it("returns rules for the authenticated tenant", async () => {
            triggerService.listRules.mockResolvedValue([createMockRule()]);

            const response = await request(app.getHttpServer()).get("/message-trigger-rules");

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listRules).toHaveBeenCalledWith(branchId);
        });
    });

    describe("GET /message-trigger-jobs/upcoming", () => {
        it("uses the default limit when the query is omitted", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([createMockUpcomingJob()]);

            const response = await request(app.getHttpServer()).get("/message-trigger-jobs/upcoming");

            expect(response.status).toBe(200);
            expect(triggerService.listUpcomingJobs).toHaveBeenCalledWith(branchId, 200);
        });

        it("rejects limits above 500", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([]);

            const response = await request(app.getHttpServer())
                .get("/message-trigger-jobs/upcoming")
                .query({ limit: 999 });

            expect(response.status).toBe(400);
            expect(triggerService.listUpcomingJobs).not.toHaveBeenCalled();
        });
    });

    describe("GET /message-trigger-jobs/client/:clientId/upcoming", () => {
        it("passes the tenant, client, default limit, and cursor to the read service", async () => {
            triggerService.listClientUpcomingJobs.mockResolvedValue({ items: [], nextCursor: null });

            const response = await request(app.getHttpServer())
                .get("/message-trigger-jobs/client/42/upcoming")
                .query({ cursor: "opaque-cursor" });

            expect(response.status).toBe(200);
            expect(triggerService.listClientUpcomingJobs).toHaveBeenCalledWith(
                branchId,
                42,
                50,
                "opaque-cursor",
            );
        });

        it("rejects malformed client ids and limits before calling the service", async () => {
            const invalidClient = await request(app.getHttpServer())
                .get("/message-trigger-jobs/client/not-an-integer/upcoming");
            const invalidLimit = await request(app.getHttpServer())
                .get("/message-trigger-jobs/client/42/upcoming")
                .query({ limit: 101 });

            expect(invalidClient.status).toBe(400);
            expect(invalidLimit.status).toBe(400);
            expect(triggerService.listClientUpcomingJobs).not.toHaveBeenCalled();
        });
    });

    describe("POST /message-trigger-jobs/:id/cancel", () => {
        it("cancels a pending job for the authenticated tenant", async () => {
            triggerService.cancelJobByUser.mockResolvedValue({ id: "job-1", status: "canceled" });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/cancel");

            expect(response.status).toBe(201);
            expect(response.body).toEqual({ id: "job-1", status: "canceled" });
            expect(triggerService.cancelJobByUser).toHaveBeenCalledWith(branchId, "job-1");
        });

        it("surfaces a 409 conflict when the job can no longer be canceled", async () => {
            triggerService.cancelJobByUser.mockRejectedValue(
                new ConflictException("이미 발송되었거나 취소할 수 없는 상태입니다"),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/cancel");

            expect(response.status).toBe(409);
            expect(response.body.message).toBe("이미 발송되었거나 취소할 수 없는 상태입니다");
        });

        it("allows a branch manager and denies staff before service execution", async () => {
            triggerService.cancelJobByUser.mockResolvedValue({ id: "job-1", status: "canceled" });
            authRole = "manager";
            expect((await request(app.getHttpServer()).post("/message-trigger-jobs/job-1/cancel")).status).toBe(201);
            authRole = "user";
            expect((await request(app.getHttpServer()).post("/message-trigger-jobs/job-1/cancel")).status).toBe(403);
            expect(triggerService.cancelJobByUser).toHaveBeenCalledTimes(1);
        });
    });

    describe("POST /message-trigger-jobs/:id/reschedule (owner-only debug tool)", () => {
        const scheduledFor = "2099-01-01T00:05:00.000Z";

        it("lets the owner move a job and passes the new time, branch and actor to the service", async () => {
            authRole = "owner";
            triggerService.rescheduleJobForDebug.mockResolvedValue({ id: "job-1", status: "pending", scheduledFor });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ id: "job-1", status: "pending", scheduledFor });
            expect(triggerService.rescheduleJobForDebug).toHaveBeenCalledWith(
                branchId,
                "job-1",
                new Date(scheduledFor),
                "user-1",
            );
        });

        it.each(["admin", "manager", "user"])("denies %s with 403 before service execution", async (role) => {
            authRole = role;
            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor });

            expect(response.status).toBe(403);
            expect(triggerService.rescheduleJobForDebug).not.toHaveBeenCalled();
        });

        it.each([undefined, "", "not-a-date", "2099-01-01", 12345])("rejects an invalid scheduledFor %p with 400", async (value) => {
            authRole = "owner";
            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor: value });

            expect(response.status).toBe(400);
            expect(triggerService.rescheduleJobForDebug).not.toHaveBeenCalled();
        });

        it.each(["2099-01-01T00:05", "2099-01-01T00:05:00", "2099-01-01T00:05:00.000", "2099-01-01T00:05:00+0900"])(
            "rejects a scheduledFor with no usable time zone %p with 400",
            async (value) => {
                authRole = "owner";
                const response = await request(app.getHttpServer())
                    .post("/message-trigger-jobs/job-1/reschedule")
                    .send({ scheduledFor: value });

                expect(response.status).toBe(400);
                expect(triggerService.rescheduleJobForDebug).not.toHaveBeenCalled();
            },
        );

        it.each([
            ["2099-01-01T00:05:00Z", "2099-01-01T00:05:00.000Z"],
            ["2099-01-01T00:05:00.000Z", "2099-01-01T00:05:00.000Z"],
            ["2099-01-01T09:05:00+09:00", "2099-01-01T00:05:00.000Z"],
            ["2099-01-01T00:05:00-05:00", "2099-01-01T05:05:00.000Z"],
        ])("accepts a scheduledFor with an explicit zone %p", async (value, expectedIso) => {
            authRole = "owner";
            triggerService.rescheduleJobForDebug.mockResolvedValue({ id: "job-1", status: "pending", scheduledFor: expectedIso });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor: value });

            expect(response.status).toBe(200);
            expect(triggerService.rescheduleJobForDebug).toHaveBeenCalledWith(
                expect.anything(), "job-1", new Date(expectedIso), expect.anything(),
            );
        });

        it("surfaces the service's 400 for a time that is not in the future", async () => {
            authRole = "owner";
            triggerService.rescheduleJobForDebug.mockRejectedValue(new BadRequestException("past"));

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor: "2000-01-01T00:00:00.000Z" });

            expect(response.status).toBe(400);
        });

        it("surfaces the 409 problem body when the job is not pending", async () => {
            authRole = "owner";
            triggerService.rescheduleJobForDebug.mockRejectedValue(new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT")));

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/reschedule")
                .send({ scheduledFor });

            expect(response.status).toBe(409);
            expect(response.body).toMatchObject({ code: "REQUEST_CONFLICT" });
        });

        it("surfaces the 404 problem body for an unknown job", async () => {
            authRole = "owner";
            triggerService.rescheduleJobForDebug.mockRejectedValue(new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND")));

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/missing/reschedule")
                .send({ scheduledFor });

            expect(response.status).toBe(404);
            expect(response.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
        });
    });

    describe("POST /message-trigger-jobs/:id/resend", () => {
        it("resends one needs_setup job for the authenticated tenant and answers 200 with the outcome", async () => {
            triggerService.resendNeedsSetupJob.mockResolvedValue({ id: "job-1", status: "sent", reason: null });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/resend");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ id: "job-1", status: "sent", reason: null });
            expect(triggerService.resendNeedsSetupJob).toHaveBeenCalledWith(branchId, "job-1");
        });

        it("passes a still-broken outcome through as 200 with its reason", async () => {
            triggerService.resendNeedsSetupJob.mockResolvedValue({ id: "job-1", status: "needs_setup", reason: "필수 정보 누락 (name)" });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/resend");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ id: "job-1", status: "needs_setup", reason: "필수 정보 누락 (name)" });
        });

        it("surfaces the 404 problem body for an unknown job", async () => {
            triggerService.resendNeedsSetupJob.mockRejectedValue(new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND")));

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/missing/resend");

            expect(response.status).toBe(404);
            expect(response.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
        });

        it("surfaces the 409 problem body when the job cannot be resent", async () => {
            triggerService.resendNeedsSetupJob.mockRejectedValue(new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT")));

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/resend");

            expect(response.status).toBe(409);
            expect(response.body).toMatchObject({ code: "REQUEST_CONFLICT" });
        });

        it("allows a branch manager and denies staff before service execution", async () => {
            triggerService.resendNeedsSetupJob.mockResolvedValue({ id: "job-1", status: "sent", reason: null });
            authRole = "manager";
            expect((await request(app.getHttpServer()).post("/message-trigger-jobs/job-1/resend")).status).toBe(200);
            authRole = "user";
            expect((await request(app.getHttpServer()).post("/message-trigger-jobs/job-1/resend")).status).toBe(403);
            expect(triggerService.resendNeedsSetupJob).toHaveBeenCalledTimes(1);
        });

        it("has no bulk form", async () => {
            const response = await request(app.getHttpServer()).post("/message-trigger-jobs/resend");
            expect(response.status).toBe(404);
            expect(triggerService.resendNeedsSetupJob).not.toHaveBeenCalled();
        });
    });

    describe("GET /message-logs", () => {
        it("returns history for the authenticated tenant", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord({ status: "failed", resentByLogId: 20, retryBlockedByLogId: 20 })]);

            const response = await request(app.getHttpServer())
                .get("/message-logs")
                .query({ limit: 25 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0]).toMatchObject({ resentByLogId: 20, retryBlockedByLogId: 20 });
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 0);
        });

        it("passes validated skip to history lookup", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord()]);

            const response = await request(app.getHttpServer())
                .get("/message-logs")
                .query({ limit: 25, skip: 50 });

            expect(response.status).toBe(200);
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 50);
        });
    });

    describe("GET /message-logs/page", () => {
        it("uses the bounded default page size and forwards a cursor", async () => {
            triggerService.listHistoryPage.mockResolvedValue({
                items: [createMockHistoryRecord({ status: "failed", retryBlockedByLogId: 20 })],
                page: {
                    snapshotAt: "2026-09-17T00:00:00.000Z",
                    nextCursor: "cursor-v1",
                    hasMore: true,
                },
            });

            const response = await request(app.getHttpServer())
                .get("/message-logs/page")
                .query({ cursor: "cursor-v1" });

            expect(response.status).toBe(200);
            expect(response.body.page).toEqual(expect.objectContaining({ hasMore: true }));
            expect(response.body.items[0]).toMatchObject({ resentByLogId: null, retryBlockedByLogId: 20 });
            expect(triggerService.listHistoryPage).toHaveBeenCalledWith(branchId, 500, "cursor-v1");
        });

        it("rejects a page size above the bounded maximum", async () => {
            const response = await request(app.getHttpServer())
                .get("/message-logs/page")
                .query({ limit: 501 });

            expect(response.status).toBe(400);
            expect(triggerService.listHistoryPage).not.toHaveBeenCalled();
        });
    });

    describe("GET /message-logs/client/:clientId", () => {
        it("passes the caller's branch, the client, the default page size and the cursor to the read service", async () => {
            triggerService.listClientHistoryPage.mockResolvedValue({
                items: [createMockHistoryRecord()],
                page: { snapshotAt: "2026-09-17T00:00:00.000Z", nextCursor: null, hasMore: false },
            });

            const response = await request(app.getHttpServer())
                .get("/message-logs/client/42")
                .query({ cursor: "opaque-cursor" });

            expect(response.status).toBe(200);
            expect(response.body.items).toHaveLength(1);
            expect(response.body.items[0]).toMatchObject({ resentByLogId: null, retryBlockedByLogId: null });
            expect(triggerService.listClientHistoryPage).toHaveBeenCalledWith(branchId, 42, 50, "opaque-cursor");
        });

        it("is open to branch staff, like the client upcoming read", async () => {
            authRole = "staff";
            triggerService.listClientHistoryPage.mockResolvedValue({
                items: [],
                page: { snapshotAt: "2026-09-17T00:00:00.000Z", nextCursor: null, hasMore: false },
            });

            const response = await request(app.getHttpServer()).get("/message-logs/client/42");

            expect(response.status).toBe(200);
        });

        it("does not shadow the branch-wide page and list endpoints", async () => {
            triggerService.listHistoryPage.mockResolvedValue({
                items: [],
                page: { snapshotAt: "2026-09-17T00:00:00.000Z", nextCursor: null, hasMore: false },
            });
            triggerService.listHistory.mockResolvedValue([]);

            await request(app.getHttpServer()).get("/message-logs/page").expect(200);
            await request(app.getHttpServer()).get("/message-logs").expect(200);

            expect(triggerService.listHistoryPage).toHaveBeenCalledTimes(1);
            expect(triggerService.listHistory).toHaveBeenCalledTimes(1);
            expect(triggerService.listClientHistoryPage).not.toHaveBeenCalled();
        });

        it("rejects malformed client ids and page sizes before calling the service", async () => {
            const invalidClient = await request(app.getHttpServer()).get("/message-logs/client/not-an-integer");
            const invalidLimit = await request(app.getHttpServer())
                .get("/message-logs/client/42")
                .query({ limit: 101 });

            expect(invalidClient.status).toBe(400);
            expect(invalidLimit.status).toBe(400);
            expect(triggerService.listClientHistoryPage).not.toHaveBeenCalled();
        });

        it("surfaces the service's 404 for another branch's client", async () => {
            triggerService.listClientHistoryPage.mockRejectedValue(new NotFoundException());

            const response = await request(app.getHttpServer()).get("/message-logs/client/42");

            expect(response.status).toBe(404);
        });
    });

    describe("POST /message-logs/:id/retry", () => {
        it("schedules the branch-owned history log for retry", async () => {
            smsRetryService.retryById.mockResolvedValue({
                id: 77,
                status: "pending",
                templateKey: "service_record_link_sms",
            });

            const response = await request(app.getHttpServer())
                .post("/message-logs/77/retry");

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                id: 77,
                status: "pending",
                templateKey: "service_record_link_sms",
            });
            expect(smsRetryService.retryById).toHaveBeenCalledWith(branchId, 77);
        });

        it("rejects an invalid log id before retrying", async () => {
            const response = await request(app.getHttpServer())
                .post("/message-logs/not-a-number/retry");

            expect(response.status).toBe(400);
            expect(smsRetryService.retryById).not.toHaveBeenCalled();
        });

        it("allows a branch manager and denies staff before retry execution", async () => {
            smsRetryService.retryById.mockResolvedValue({ id: 77, status: "pending" });
            authRole = "manager";
            expect((await request(app.getHttpServer()).post("/message-logs/77/retry")).status).toBe(201);
            authRole = "user";
            expect((await request(app.getHttpServer()).post("/message-logs/77/retry")).status).toBe(403);
            expect(smsRetryService.retryById).toHaveBeenCalledTimes(1);
        });
    });

    describe("POST /message-trigger-rules", () => {
        it("creates a rule with a valid payload", async () => {
            const createDto = {
                name: "서비스 시작 리마인드",
                isActive: true,
                eventType: "SERVICE_START",
                offsetType: "BEFORE_DAYS",
                offsetDays: 2,
                recipientType: "CLIENT",
                templateKey: "SERVICE_START_REMINDER",
            };
            triggerService.createRule.mockResolvedValue(
                createMockRule({
                    id: "rule-2",
                    name: createDto.name,
                    eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                    offsetDays: 2,
                    templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send(createDto);

            expect(response.status).toBe(201);
            expect(triggerService.createRule).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    name: "서비스 시작 리마인드",
                    offsetDays: 2,
                    templateKey: "SERVICE_START_REMINDER",
                }),
            );
        });

        it("creates the service information rule for seven days before service start", async () => {
            const createDto = {
                name: "서비스 시작 7일 전 서비스 안내",
                isActive: true,
                eventType: "SERVICE_START",
                offsetType: "BEFORE_DAYS",
                offsetDays: 7,
                recipientType: "CLIENT",
                templateKey: "SERVICE_INFO",
            };
            triggerService.createRule.mockResolvedValue(
                createMockRule({
                    id: "rule-service-info",
                    name: createDto.name,
                    eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                    offsetDays: 7,
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send(createDto);

            expect(response.status).toBe(201);
            expect(triggerService.createRule).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    name: "서비스 시작 7일 전 서비스 안내",
                    eventType: "SERVICE_START",
                    offsetType: "BEFORE_DAYS",
                    offsetDays: 7,
                    recipientType: "CLIENT",
                    templateKey: "SERVICE_INFO",
                }),
            );
        });

        it("rejects invalid trigger enums", async () => {
            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send({
                    name: "잘못된 규칙",
                    isActive: true,
                    eventType: "INVALID_EVENT",
                    offsetType: "IMMEDIATE",
                    recipientType: "CLIENT",
                    templateKey: "CLIENT_WELCOME",
                });

            expect(response.status).toBe(400);
            expect(triggerService.createRule).not.toHaveBeenCalled();
        });
    });

    describe("GET /message-trigger-rules/:id", () => {
        it("fetches a single rule for the authenticated tenant", async () => {
            triggerService.getRule.mockResolvedValue(createMockRule({ id: "rule-42" }));

            const response = await request(app.getHttpServer()).get("/message-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.getRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("PATCH /message-trigger-rules/:id", () => {
        it("updates a rule with a valid partial payload", async () => {
            triggerService.updateRule.mockResolvedValue(
                createMockRule({
                    id: "rule-42",
                    isActive: false,
                    name: "비활성 규칙",
                }),
            );

            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-42")
                .send({
                    name: "비활성 규칙",
                    isActive: false,
                });

            expect(response.status).toBe(200);
            expect(triggerService.updateRule).toHaveBeenCalledWith(
                branchId,
                "rule-42",
                expect.objectContaining({
                    name: "비활성 규칙",
                    isActive: false,
                }),
            );
        });

        it("rejects invalid numeric updates", async () => {
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-42")
                .send({
                    offsetDays: -1,
                });

            expect(response.status).toBe(400);
            expect(triggerService.updateRule).not.toHaveBeenCalled();
        });
    });

    describe("PUT /message-trigger-rules/:id/branch-activation", () => {
        it("forwards the branch opt-out/opt-in to the service and returns the resulting rule", async () => {
            triggerService.updateRuleBranchActivation.mockResolvedValue(
                createMockRule({ id: "rule-global", branchId: null, isActive: false }),
            );

            const response = await request(app.getHttpServer())
                .put("/message-trigger-rules/rule-global/branch-activation")
                .send({ isActive: false });

            expect(response.status).toBe(200);
            expect(triggerService.updateRuleBranchActivation).toHaveBeenCalledWith(
                branchId,
                "rule-global",
                false,
            );
        });

        it("surfaces a 409 conflict when enabling a branch under a disabled global rule", async () => {
            triggerService.updateRuleBranchActivation.mockRejectedValue(
                new ConflictException("Global rule is disabled"),
            );

            const response = await request(app.getHttpServer())
                .put("/message-trigger-rules/rule-global/branch-activation")
                .send({ isActive: true });

            expect(response.status).toBe(409);
        });

        it("surfaces a 404 not-found for a branch-owned rule id", async () => {
            triggerService.updateRuleBranchActivation.mockRejectedValue(
                new NotFoundException("Trigger rule rule-1 not found"),
            );

            const response = await request(app.getHttpServer())
                .put("/message-trigger-rules/rule-1/branch-activation")
                .send({ isActive: false });

            expect(response.status).toBe(404);
        });

        it("rejects a non-boolean isActive payload", async () => {
            const response = await request(app.getHttpServer())
                .put("/message-trigger-rules/rule-global/branch-activation")
                .send({ isActive: "yes" });

            expect(response.status).toBe(400);
            expect(triggerService.updateRuleBranchActivation).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /message-trigger-rules/:id", () => {
        it("deletes a rule for the authenticated tenant", async () => {
            triggerService.deleteRule.mockResolvedValue(undefined);

            const response = await request(app.getHttpServer()).delete("/message-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.deleteRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("GET /message-trigger-templates", () => {
        it("passes SMS catalog filters through to the service", async () => {
            triggerService.listTemplates.mockResolvedValue([createMockTemplate()]);

            const response = await request(app.getHttpServer())
                .get("/message-trigger-templates")
                .query({
                    eventType: "SERVICE_START",
                    recipientType: "CLIENT",
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listTemplates).toHaveBeenCalledWith({
                eventType: "SERVICE_START",
                recipientType: "CLIENT",
            });
        });
    });
});

import { MessageTriggerRuleGroupController } from "interface/controllers/message-trigger-rule-group.controller";
import { MessageTriggerRuleGroupService } from "application/services/message-trigger-rule-group.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { createIntegrityPrisma, closeIntegrityPrisma, describeReal, type IntegrityPrisma } from "../integrity/helpers/real-db";
import { randomUUID } from "node:crypto";
import { mapHttpProblem } from "infrastructure/filters/problem-response";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

const clientGroupBody = (overrides: Record<string, unknown> = {}) => ({
    name: "합성 고객 안내", recipientMode: "CLIENT", eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3,
    sendTime: "10:30", isActive: false, targetClientStatus: "all", retryOnFailure: true,
    recipientTemplates: { CLIENT: "SERVICE_INFO" }, ...overrides,
});

/** Auth transport is synthetic; the production BranchManagerGuard is unchanged. */
const groupTenantGuard = {
    canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        req.tenant = { branchId: req.headers["x-test-branch"] ?? "branch-http", globalRole: "user", branchRole: req.headers["x-test-role"] ?? "manager" };
        return true;
    },
};

function installGroupProblemFilter(app: INestApplication) {
    app.useGlobalFilters({ catch(exception: unknown, host: import("@nestjs/common").ArgumentsHost) {
        const http = host.switchToHttp(); const response = http.getResponse();
        const problem = mapHttpProblem(exception, http.getRequest(), response);
        if (problem) response.status(problem.status).json(problem);
        else { const error = exception as import("@nestjs/common").HttpException; response.status(error.getStatus()).json(error.getResponse()); }
    } });
}

describe("MessageTriggerRuleGroupController tenant/DTO transport", () => {
    let app: INestApplication;
    const service = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    beforeAll(async () => {
        const module = await Test.createTestingModule({ controllers: [MessageTriggerRuleGroupController], providers: [BranchManagerGuard, { provide: MessageTriggerRuleGroupService, useValue: service }] })
            .overrideGuard(JwtGuard).useValue(groupTenantGuard).overrideGuard(TenantGuard).useValue(groupTenantGuard).compile();
        app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true })); installGroupProblemFilter(app); await app.init();
    });
    afterAll(async () => { if (app) await app.close(); });
    beforeEach(() => { jest.clearAllMocks(); service.list.mockResolvedValue({ groups: [], standaloneRules: [] }); service.get.mockResolvedValue({ id: "legacy-rule:opaque" }); });
    it("permits tenant reads for ordinary members and accepts opaque migrated group ids", async () => {
        expect((await request(app.getHttpServer()).get("/message-trigger-rule-groups").set("x-test-role", "member")).status).toBe(200);
        expect((await request(app.getHttpServer()).get("/message-trigger-rule-groups/legacy-rule:opaque")).status).toBe(200);
        expect(service.get).toHaveBeenCalledWith("branch-http", "legacy-rule:opaque");
    });
    it.each(["post", "put", "delete"] as const)("denies ordinary member %s before dispatching the writer", async (method) => {
        const url = method === "post" ? "/message-trigger-rule-groups" : "/message-trigger-rule-groups/group";
        const response = await request(app.getHttpServer())[method](url).set("x-test-role", "member").send({ ...clientGroupBody(), expectedVersion: 1 });
        expect(response.status).toBe(403); expect(service.create).not.toHaveBeenCalled(); expect(service.update).not.toHaveBeenCalled(); expect(service.delete).not.toHaveBeenCalled();
    });
    it("derives branch authority exclusively from tenant context", async () => {
        service.create.mockResolvedValue({ id: "group" });
        expect((await request(app.getHttpServer()).post("/message-trigger-rule-groups").set("x-test-branch", "branch-A").send(clientGroupBody({ branchId: "branch-B" }))).status).toBe(201);
        expect(service.create).toHaveBeenCalledWith("branch-A", expect.objectContaining({ branchId: "branch-B" }));
    });
    it.each([{ sendTime: "24:00" }, { offsetDays: -1 }, { recipientMode: "OTHER" }, { recipientTemplates: [] }, { name: " " }])("rejects invalid syntax %j before core invocation", async (invalid) => {
        expect((await request(app.getHttpServer()).post("/message-trigger-rule-groups").send(clientGroupBody(invalid))).status).toBe(400); expect(service.create).not.toHaveBeenCalled();
    });
    it.each([undefined, null, 0, -1, 1.5, "1"])("rejects invalid expectedVersion %j", async (expectedVersion) => {
        expect((await request(app.getHttpServer()).put("/message-trigger-rule-groups/group").send({ ...clientGroupBody(), expectedVersion })).status).toBe(400); expect(service.update).not.toHaveBeenCalled();
    });
    it("allows syntax for all four stored modes for the semantic service gate", async () => {
        service.create.mockResolvedValue({});
        for (const recipientMode of ["CLIENT", "PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "BOTH_EMPLOYEES"]) {
            expect((await request(app.getHttpServer()).post("/message-trigger-rule-groups").send(clientGroupBody({ recipientMode }))).status).toBe(201);
        }
        expect(service.create).toHaveBeenCalledTimes(4);
    });
});

// These cases run only through the EXISTING guarded throwaway runner. Local
// skips are intentional and never evidence of actual PostgreSQL success.
describeReal("Phase6 group core/controllers/repository (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let app: INestApplication;
    let core: MessageTriggerService;
    let repository: SbMessageTriggerRuleRepository;
    let jobs: SbMessageTriggerJobRepository;
    let branchId: string;
    let otherBranchId: string;
    const branches: string[] = [];
    const provider = jest.fn();
    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        repository = new SbMessageTriggerRuleRepository(handle.service); jobs = new SbMessageTriggerJobRepository(handle.service);
        const branchLock = new MessageAutomationBranchLockService(handle.service);
        const settings = { getMessageAutomationPolicyConfig: async () => ({ configuration: { ...defaultMessageAutomationPolicy(), defaultRuleSendTime: "11:45" } }), getMessageSettingsPolicyEnabled: async () => false };
        const approval = { ensureApproved: async () => undefined, isApproved: async () => true };
        const activation = { getTriggerDispatchEnabled: async () => true, assertTriggerDispatchEnabled: async () => undefined };
        core = new MessageTriggerService(handle.service, { send: provider } as never, approval as never, repository, jobs,
            new SbMessageLogRepository(handle.service), { getByKeyForBranch: async () => ({ customVariables: [] }) } as never,
            new MessageTemplateAutomationLockService(handle.service), settings as never,
            new SbMessageTriggerRuleBranchOverrideRepository(handle.service), activation as never, branchLock);
        const module = await Test.createTestingModule({ controllers: [MessageTriggerRuleGroupController, MessageTriggerController], providers: [BranchManagerGuard,
            MessageTriggerRuleGroupService, { provide: MessageTriggerService, useValue: core }, { provide: SmsRetryService, useValue: {} }] })
            .overrideGuard(JwtGuard).useValue(groupTenantGuard).overrideGuard(TenantGuard).useValue(groupTenantGuard).compile();
        app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true })); installGroupProblemFilter(app); await app.init();
    });
    beforeEach(async () => {
        branchId = randomUUID(); otherBranchId = randomUUID(); branches.push(branchId, otherBranchId);
        await handle.raw.branch.createMany({ data: [branchId, otherBranchId].map((id) => ({ id, name: "Phase6 합성 지점", slug: `phase6-${id}` })) });
        provider.mockClear();
    });
    afterAll(async () => {
        if (app) await app.close();
        if (handle) {
            await handle.raw.message_trigger_job.deleteMany({ where: { branchId: { in: branches } } });
            await handle.raw.message_trigger_rule.deleteMany({ where: { branchId: { in: branches } } });
            await handle.raw.message_trigger_rule_group.deleteMany({ where: { branchId: { in: branches } } });
            await handle.raw.branch.deleteMany({ where: { id: { in: branches } } });
            await closeIntegrityPrisma(handle);
        }
    });
    const post = (body = clientGroupBody()) => request(app.getHttpServer()).post("/message-trigger-rule-groups").set("x-test-branch", branchId).send(body);
    it("executes CLIENT HTTP CRUD with CAS, branch fencing and real child projection", async () => {
        const created = await post(); expect(created.status).toBe(201); const id = created.body.id as string;
        expect(created.body).toMatchObject({ branchId, version: 1, recipientMode: "CLIENT", sendTime: "10:30", rules: [{ groupId: id, recipientType: "CLIENT" }] });
        const updated = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${id}`).set("x-test-branch", branchId).send({ ...clientGroupBody({ sendTime: "12:20" }), expectedVersion: 1 });
        expect(updated.status).toBe(200); expect(updated.body).toMatchObject({ version: 2, sendTime: "12:20" });
        const stale = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${id}`).set("x-test-branch", branchId).send({ ...clientGroupBody(), expectedVersion: 1 });
        expect(stale.status).toBe(409); expect(stale.body).toMatchObject({ code: "REQUEST_CONFLICT", groupId: id, currentVersion: 2 });
        expect((await request(app.getHttpServer()).get(`/message-trigger-rule-groups/${id}`).set("x-test-branch", otherBranchId)).status).toBe(404);
        expect((await request(app.getHttpServer()).delete(`/message-trigger-rule-groups/${id}`).set("x-test-branch", otherBranchId)).status).toBe(404);
        expect((await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${id}`).set("x-test-branch", otherBranchId).send({ ...clientGroupBody(), expectedVersion: 2 })).status).toBe(404);
        expect((await request(app.getHttpServer()).delete(`/message-trigger-rule-groups/${id}`).set("x-test-branch", branchId)).status).toBe(200);
        expect(await handle.raw.message_trigger_rule_group.findUnique({ where: { id } })).toMatchObject({ deletedAt: expect.any(Date) });
        expect(await handle.raw.message_trigger_rule.findFirst({ where: { groupId: id } })).toMatchObject({ deletedAt: expect.any(Date), isActive: false }); expect(provider).not.toHaveBeenCalled();
    });
    it("concurrent equivalent HTTP creates yield exactly one201 and one duplicate409 with no orphan", async () => {
        const responses = await Promise.all([post(), post(clientGroupBody({ name: "별명", retryOnFailure: false }))]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(await handle.raw.message_trigger_rule_group.count({ where: { branchId } })).toBe(1); expect(await handle.raw.message_trigger_rule.count({ where: { branchId } })).toBe(1);
    });
    it("rolls back real parent/child inserts on a late repository failure, then permits one retry", async () => {
        const fail = jest.spyOn(repository, "markJobsStale").mockRejectedValueOnce(new Error("private simulated failure"));
        const response = await post(); expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain("private simulated failure"); fail.mockRestore();
        expect(await handle.raw.message_trigger_rule_group.count({ where: { branchId } })).toBe(0); expect(await handle.raw.message_trigger_rule.count({ where: { branchId } })).toBe(0);
        expect((await post()).status).toBe(201);
    });
    it("legacy POST/update/delete preserves atomic parent and soft deletion identity", async () => {
        const common: Record<string, unknown> = clientGroupBody();
        delete common["recipientMode"];
        delete common["recipientTemplates"];
        const created = await request(app.getHttpServer()).post("/message-trigger-rules").set("x-test-branch", branchId).send({ ...common, recipientType: "CLIENT", templateKey: "SERVICE_INFO" });
        expect(created.status).toBe(201); expect(typeof created.body.groupId).toBe("string");
        const updated = await request(app.getHttpServer()).patch(`/message-trigger-rules/${created.body.id}`).set("x-test-branch", branchId).send({ name: "legacy update" });
        expect(updated.status).toBe(200); expect(updated.body.groupId).toBe(created.body.groupId);
        expect(await handle.raw.message_trigger_rule_group.findUnique({ where: { id: created.body.groupId } })).toMatchObject({ version: 2, name: "legacy update" });
        expect((await request(app.getHttpServer()).delete(`/message-trigger-rules/${created.body.id}`).set("x-test-branch", branchId)).status).toBe(200);
    });
    it("refuses nonCLIENT new group modes before any SQL insert/provider attempt", async () => {
        for (const recipientMode of ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "BOTH_EMPLOYEES"]) expect((await post(clientGroupBody({ recipientMode }))).status).toBe(400);
        expect(await handle.raw.message_trigger_rule_group.count({ where: { branchId } })).toBe(0); expect(provider).not.toHaveBeenCalled();
    });
    it("serializes BOTH child refusal for all old HTTP writers with the real groupId", async () => {
        const created = await post(); const groupId = created.body.id as string; const ruleId = created.body.rules[0].id as string;
        await handle.raw.message_trigger_rule_group.update({ where: { id: groupId }, data: { recipientMode: "BOTH_EMPLOYEES" } });
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { recipientType: "PRIMARY_EMPLOYEE" } });
        await handle.raw.message_trigger_rule.create({ data: { branchId, groupId, name: "보조", isActive: false, eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, recipientType: "SECONDARY_EMPLOYEE", templateKey: "SERVICE_INFO" } });
        const responses = [
            await request(app.getHttpServer()).patch(`/message-trigger-rules/${ruleId}`).set("x-test-branch", branchId).send({ name: "split" }),
            await request(app.getHttpServer()).delete(`/message-trigger-rules/${ruleId}`).set("x-test-branch", branchId),
            await request(app.getHttpServer()).put(`/message-trigger-rules/${ruleId}/branch-activation`).set("x-test-branch", branchId).send({ isActive: false }),
            await request(app.getHttpServer()).put(`/message-trigger-rules/${ruleId}/activation-with-parent`).set("x-test-branch", branchId).send({ isActive: true, enableParent: true }),
        ];
        expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
        responses.forEach((response) => expect(response.body).toMatchObject({ code: "REQUEST_CONFLICT", groupId }));
        expect(await handle.raw.message_trigger_rule_group.findUnique({ where: { id: groupId } })).toMatchObject({ version: 1 }); expect(provider).not.toHaveBeenCalled();
    });
    it("fences pending work while retaining canceledByUser/sent dedupe rows through metadata update/delete", async () => {
        const created = await post(); const groupId = created.body.id as string; const ruleId = created.body.rules[0].id as string;
        const entities = ["pending", "canceled", "sent"].map((status) => MessageTriggerJobEntity.create({ branchId, ruleId, recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO, scheduledFor: new Date("2026-12-01T00:00:00Z"), dedupeKey: `phase6:${groupId}:${status}`, payload: { memberId: "synthetic", recipientName: "합성", recipientPhone: "01000000001", templateVariables: {}, ...(status === "canceled" ? { canceledByUser: true } : {}) } }));
        for (const entity of entities) { if (entity.dedupeKey.endsWith("canceled")) entity.cancel("사용자가 발송을 취소함"); if (entity.dedupeKey.endsWith("sent")) entity.markSent(); await jobs.create(entity); }
        const idsBefore = await handle.raw.message_trigger_job.findMany({ where: { branchId }, select: { id: true, status: true, dedupeKey: true, payload: true }, orderBy: { dedupeKey: "asc" } });
        expect((await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${groupId}`).set("x-test-branch", branchId).send({ ...clientGroupBody({ name: "metadata" }), expectedVersion: 1 })).status).toBe(200);
        await core.deleteRuleGroup(branchId, groupId);
        const after = await handle.raw.message_trigger_job.findMany({ where: { branchId }, select: { id: true, status: true, dedupeKey: true, payload: true }, orderBy: { dedupeKey: "asc" } });
        expect(after.map((job) => job.id)).toEqual(idsBefore.map((job) => job.id)); expect(after.map((job) => job.status)).toEqual(["canceled", "canceled", "sent"]); expect(after[0]!.payload).toEqual(idsBefore[0]!.payload); expect(provider).not.toHaveBeenCalled();
    });
    it("C1 refuses an omitted-status duplicate with no version, rule or job mutation", async () => {
        const first = await post(clientGroupBody({ sendTime: "09:00", targetClientStatus: "pre_booking" }));
        const target = await post(clientGroupBody({ sendTime: "10:00", targetClientStatus: "pre_booking" }));
        expect(first.status).toBe(201); expect(target.status).toBe(201);
        await jobs.create(MessageTriggerJobEntity.create({ branchId, ruleId: target.body.rules[0].id,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            scheduledFor: new Date("2026-12-01T00:00:00Z"), dedupeKey: `phase6-c1:${target.body.id}`,
            payload: { memberId: "synthetic", recipientName: "합성", recipientPhone: "01000000001", templateVariables: {} } }));
        const beforeGroups = await handle.raw.message_trigger_rule_group.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const beforeRules = await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const beforeJobs = await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const update: Record<string, unknown> = { ...clientGroupBody({ sendTime: "09:00" }), expectedVersion: 1 };
        delete update["targetClientStatus"];
        const response = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId).send(update);
        expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: "REQUEST_CONFLICT" });
        expect(await handle.raw.message_trigger_rule_group.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeGroups);
        expect(await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeRules);
        expect(await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeJobs);
        expect(provider).not.toHaveBeenCalled();
    });
    it("C1 allows the requested time for a distinct retained status without a false duplicate", async () => {
        const first = await post(clientGroupBody({ sendTime: "09:00", targetClientStatus: "all" }));
        const target = await post(clientGroupBody({ sendTime: "10:00", targetClientStatus: "pre_booking" }));
        expect(first.status).toBe(201); expect(target.status).toBe(201);
        const update: Record<string, unknown> = { ...clientGroupBody({ sendTime: "09:00" }), expectedVersion: 1 };
        delete update["targetClientStatus"];
        const response = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId).send(update);
        expect(response.status).toBe(200); expect(response.body).toMatchObject({ version: 2, sendTime: "09:00", targetClientStatus: "pre_booking" });
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: target.body.rules[0].id } })).toMatchObject({ sendTime: "09:00", targetClientStatus: "pre_booking" });
        expect(provider).not.toHaveBeenCalled();
    });
    it("C1 preserves omitted metadata options and applies explicit options on the next version", async () => {
        const target = await post(clientGroupBody({ offsetDays: 3, sendTime: "10:30", retryOnFailure: false, isActive: false, targetClientStatus: "pre_booking" }));
        expect(target.status).toBe(201);
        const update: Record<string, unknown> = { ...clientGroupBody({ name: "metadata only" }), expectedVersion: 1 };
        for (const key of ["offsetDays", "sendTime", "retryOnFailure", "isActive", "targetClientStatus"]) delete update[key];
        const response = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId).send(update);
        expect(response.status).toBe(200); expect(response.body).toMatchObject({ name: "metadata only", version: 2,
            offsetDays: 3, sendTime: "10:30", retryOnFailure: false, isActive: false, targetClientStatus: "pre_booking" });
        const explicit = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId)
            .send({ ...clientGroupBody({ offsetDays: 5, sendTime: "12:15", retryOnFailure: true, isActive: false, targetClientStatus: "active" }), expectedVersion: 2 });
        expect(explicit.status).toBe(200); expect(explicit.body).toMatchObject({ version: 3, offsetDays: 5, sendTime: "12:15", retryOnFailure: true, isActive: false, targetClientStatus: "active" });
        const invalid = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId)
            .send({ ...clientGroupBody({ eventType: "EMPLOYEE_ASSIGNED", offsetType: "IMMEDIATE" }), expectedVersion: 3 });
        expect(invalid.status).toBe(400); expect(invalid.body).toMatchObject({ code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
        expect(JSON.stringify(invalid.body)).not.toMatch(/cause|stack|Invalid recipient/);
        expect(await handle.raw.message_trigger_rule_group.findUnique({ where: { id: target.body.id } })).toMatchObject({ version: 3 });
        expect(provider).not.toHaveBeenCalled();
    });
    it.each(["NOT_A_TEMPLATE", 7, { toString: "x" }, "toString"])("C2 rejects malformed HTTP update template %j for all active states without mutations", async (template) => {
        const target = await post(); expect(target.status).toBe(201);
        const beforeGroup = await handle.raw.message_trigger_rule_group.findUnique({ where: { id: target.body.id } });
        const beforeRule = await handle.raw.message_trigger_rule.findUnique({ where: { id: target.body.rules[0].id } });
        const beforeJobs = await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        for (const isActive of [undefined, true, false]) {
            const update = { ...clientGroupBody({ recipientTemplates: { CLIENT: template }, isActive }), expectedVersion: 1 };
            const response = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId).send(update);
            expect(response.status).toBe(400); expect(response.body).toMatchObject({ code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
            expect(JSON.stringify(response.body)).not.toMatch(/TypeError|cause|stack|NOT_A_TEMPLATE/);
        }
        expect(await handle.raw.message_trigger_rule_group.findUnique({ where: { id: target.body.id } })).toEqual(beforeGroup);
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: target.body.rules[0].id } })).toEqual(beforeRule);
        expect(await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeJobs);
        expect(provider).not.toHaveBeenCalled();
    });
    it("C2 refuses malformed HTTP create values and permits a registered CLIENT template", async () => {
        for (const template of ["NOT_A_TEMPLATE", 7, { toString: "x" }, "toString"]) {
            const response = await post(clientGroupBody({ recipientTemplates: { CLIENT: template } }));
            expect(response.status).toBe(400); expect(response.body).toMatchObject({ code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
        }
        expect(await handle.raw.message_trigger_rule_group.count({ where: { branchId } })).toBe(0);
        expect(await handle.raw.message_trigger_rule.count({ where: { branchId } })).toBe(0);
        const target = await post(); expect(target.status).toBe(201);
        const update: Record<string, unknown> = { ...clientGroupBody({ name: "valid template" }), expectedVersion: 1 }; delete update["isActive"];
        const response = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId).send(update);
        expect(response.status).toBe(200); expect(response.body).toMatchObject({ version: 2, isActive: false, recipientTemplates: { CLIENT: "SERVICE_INFO" } });
        expect(provider).not.toHaveBeenCalled();
    });
    it("C3 refuses immediate create duplicates that differ only in stored HH:mm", async () => {
        const immediate = clientGroupBody({ eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: "CLIENT_GREETING" } });
        const first = await post(immediate); expect(first.status).toBe(201);
        const duplicate = await post({ ...immediate, sendTime: "10:00" });
        expect(duplicate.status).toBe(409); expect(duplicate.body).toMatchObject({ code: "REQUEST_CONFLICT", groupId: first.body.id });
        const legacy = await request(app.getHttpServer()).post("/message-trigger-rules").set("x-test-branch", branchId).send({
            name: "legacy immediate", eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, sendTime: "11:00", isActive: false, recipientType: "CLIENT", templateKey: "CLIENT_GREETING" });
        expect(legacy.status).toBe(409);
        expect(await handle.raw.message_trigger_rule_group.count({ where: { branchId } })).toBe(1);
        expect(await handle.raw.message_trigger_rule.count({ where: { branchId } })).toBe(1);
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: first.body.rules[0].id } })).toMatchObject({ sendTime: "09:00" });
        expect(provider).not.toHaveBeenCalled();
    });
    it("C3 refuses group and legacy conversion to duplicate immediate semantics without any mutation", async () => {
        const immediate = clientGroupBody({ eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: "CLIENT_GREETING" } });
        const first = await post(immediate); const target = await post(clientGroupBody({ sendTime: "10:00" }));
        expect(first.status).toBe(201); expect(target.status).toBe(201);
        await jobs.create(MessageTriggerJobEntity.create({ branchId, ruleId: target.body.rules[0].id,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            scheduledFor: new Date("2026-12-01T00:00:00Z"), dedupeKey: `phase6-c3:${target.body.id}`,
            payload: { memberId: "synthetic", recipientName: "합성", recipientPhone: "01000000001", templateVariables: {} } }));
        const beforeGroups = await handle.raw.message_trigger_rule_group.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const beforeRules = await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const beforeJobs = await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } });
        const duplicate = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${target.body.id}`).set("x-test-branch", branchId)
            .send({ ...immediate, sendTime: "10:00", expectedVersion: 1 });
        expect(duplicate.status).toBe(409); expect(duplicate.body).toMatchObject({ code: "REQUEST_CONFLICT", groupId: first.body.id });
        const legacy = await request(app.getHttpServer()).patch(`/message-trigger-rules/${target.body.rules[0].id}`).set("x-test-branch", branchId)
            .send({ eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, sendTime: "11:00", templateKey: "CLIENT_GREETING" });
        expect(legacy.status).toBe(409);
        expect(await handle.raw.message_trigger_rule_group.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeGroups);
        expect(await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeRules);
        expect(await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(beforeJobs);
        expect(provider).not.toHaveBeenCalled();
    });
    it("C3 retains distinct calendar times and permits same-group metadata/time updates", async () => {
        const first = await post(clientGroupBody({ sendTime: "09:00" })); const second = await post(clientGroupBody({ sendTime: "10:00" }));
        expect(first.status).toBe(201); expect(second.status).toBe(201);
        const updated = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${first.body.id}`).set("x-test-branch", branchId)
            .send({ ...clientGroupBody({ name: "calendar metadata", sendTime: "09:00" }), expectedVersion: 1 });
        expect(updated.status).toBe(200); expect(updated.body).toMatchObject({ version: 2, name: "calendar metadata", sendTime: "09:00" });
        const immediate = clientGroupBody({ eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: "CLIENT_GREETING" } });
        const own = await post(immediate); expect(own.status).toBe(201);
        const ownUpdate = await request(app.getHttpServer()).put(`/message-trigger-rule-groups/${own.body.id}`).set("x-test-branch", branchId)
            .send({ ...immediate, name: "immediate metadata", sendTime: "10:00", expectedVersion: 1 });
        expect(ownUpdate.status).toBe(200); expect(ownUpdate.body).toMatchObject({ version: 2, name: "immediate metadata", sendTime: "10:00" });
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: own.body.rules[0].id } })).toMatchObject({ sendTime: "10:00" });
        expect(provider).not.toHaveBeenCalled();
    });
    it("generic projection primitives retain removed role identity for later re-addition", async () => {
        const lock = new MessageAutomationBranchLockService(handle.service);
        let groupId = ""; let childId = "";
        await lock.runExclusive(branchId, async (transaction) => {
            const group = await repository.createGroup(branchId, "generic", MessageTriggerRecipientType.SECONDARY_EMPLOYEE, transaction); groupId = group.id;
            const rule = await repository.create(branchId, MessageTriggerRuleEntity.create({ branchId, groupId, name: "role", isActive: false, eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.SAME_DAY, recipientType: MessageTriggerRecipientType.SECONDARY_EMPLOYEE, templateKey: MessageTriggerTemplateKey.INFO }), transaction); childId = rule.id;
            await repository.delete(branchId, childId, transaction);
        });
        await lock.runExclusive(branchId, async (transaction) => {
            await repository.lockGroup(branchId, groupId, transaction); await repository.lockGroupRules(branchId, groupId, transaction);
            expect(await repository.findGroupRules(branchId, groupId, transaction)).toEqual([]);
            const deleted = await repository.findGroupRules(branchId, groupId, transaction, true); expect(deleted).toHaveLength(1);
            expect((await repository.restoreGroupRule(branchId, groupId, deleted[0]!, transaction))?.id).toBe(childId);
        });
        expect(await handle.raw.message_trigger_rule.count({ where: { groupId } })).toBe(1);
    });
});
