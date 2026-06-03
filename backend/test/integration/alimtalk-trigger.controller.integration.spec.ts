import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AlimtalkTriggerController } from "interface/controllers/alimtalk-trigger.controller";
import {
    AlimtalkTriggerService,
    type AlimtalkHistoryRecordView,
    type UpcomingAlimtalkTriggerJobView,
} from "application/services/alimtalk-trigger.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
    type AlimtalkTriggerTemplateCatalogItem,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";

describe("AlimtalkTriggerController (Integration)", () => {
    type RuleOverrides = Partial<{
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: AlimtalkTriggerEventType;
        offsetType: AlimtalkTriggerOffsetType;
        offsetDays: number;
        recipientType: AlimtalkTriggerRecipientType;
        templateKey: AlimtalkTriggerTemplateKey;
        createdAt: Date;
        updatedAt: Date;
    }>;

    let app: INestApplication;
    let triggerService: {
        listRules: jest.Mock;
        listUpcomingJobs: jest.Mock;
        listHistory: jest.Mock;
        createRule: jest.Mock;
        getRule: jest.Mock;
        updateRule: jest.Mock;
        deleteRule: jest.Mock;
        listTemplates: jest.Mock;
    };

    const branchId = "org-1";

    const createMockRule = (
        overrides: RuleOverrides = {},
    ) =>
        AlimtalkTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            overrides.branchId ?? branchId,
            overrides.name ?? "고객 등록 즉시 발송",
            overrides.isActive ?? true,
            overrides.eventType ?? AlimtalkTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? AlimtalkTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? AlimtalkTriggerRecipientType.CLIENT,
            overrides.templateKey ?? AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
            overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2025-01-02T00:00:00.000Z"),
        );

    const createMockUpcomingJob = (
        overrides: Partial<UpcomingAlimtalkTriggerJobView> = {},
    ): UpcomingAlimtalkTriggerJobView => ({
        id: overrides.id ?? "job-1",
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? AlimtalkTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? AlimtalkTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        recipientType: overrides.recipientType ?? AlimtalkTriggerRecipientType.CLIENT,
        recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
        templateKey: overrides.templateKey ?? AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
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
        overrides: Partial<AlimtalkHistoryRecordView> = {},
    ): AlimtalkHistoryRecordView => ({
        id: overrides.id ?? 1,
        provider: overrides.provider ?? "aligo",
        templateKey: overrides.templateKey ?? AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
        triggerJobId: overrides.triggerJobId ?? "job-1",
        receiver: overrides.receiver ?? "010-1234-5678",
        clientId: overrides.clientId ?? 101,
        messageBody: overrides.messageBody ?? "고객 등록 안내 메시지",
        variables: overrides.variables ?? { clientName: "김고객" },
        status: overrides.status ?? "sent",
        aligoMid: overrides.aligoMid ?? "mid-1",
        errorMessage: overrides.errorMessage ?? null,
        attempts: overrides.attempts ?? 1,
        lastAttemptAt: overrides.lastAttemptAt ?? new Date("2025-01-03T09:01:00.000Z"),
        nextRetryAt: overrides.nextRetryAt ?? null,
        createdAt: overrides.createdAt ?? new Date("2025-01-03T09:00:00.000Z"),
        updatedAt: overrides.updatedAt ?? new Date("2025-01-03T09:01:00.000Z"),
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? AlimtalkTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? AlimtalkTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        scheduledFor: overrides.scheduledFor ?? new Date("2025-01-03T09:00:00.000Z"),
        recipientType: overrides.recipientType ?? AlimtalkTriggerRecipientType.CLIENT,
        recipientName: overrides.recipientName ?? "김고객",
        clientName: overrides.clientName ?? "김고객",
        employeeName: overrides.employeeName ?? null,
    });

    const createMockTemplate = (
        overrides: Partial<AlimtalkTriggerTemplateCatalogItem> = {},
    ): AlimtalkTriggerTemplateCatalogItem => ({
        key: overrides.key ?? AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
        name: overrides.name ?? "고객 등록 안내",
        description: overrides.description ?? "고객 등록 직후 발송",
        allowedEventTypes: overrides.allowedEventTypes ?? [AlimtalkTriggerEventType.CLIENT_CREATED],
        allowedRecipientTypes: overrides.allowedRecipientTypes ?? [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: overrides.requiredVariables ?? [{ key: "clientName", label: "고객명" }],
        providers: overrides.providers ?? {
            aligo: { templateKey: "CLIENT_CREATED" },
        },
    });

    beforeEach(async () => {
        triggerService = {
            listRules: jest.fn(),
            listUpcomingJobs: jest.fn(),
            listHistory: jest.fn(),
            createRule: jest.fn(),
            getRule: jest.fn(),
            updateRule: jest.fn(),
            deleteRule: jest.fn(),
            listTemplates: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = {
                    userId: "user-1",
                    branchId,
                    role: "admin",
                    branchRole: "admin",
                };
                return true;
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [AlimtalkTriggerController],
            providers: [
                {
                    provide: AlimtalkTriggerService,
                    useValue: triggerService,
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
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    describe("GET /alimtalk-trigger-rules", () => {
        it("returns rules for the authenticated tenant", async () => {
            triggerService.listRules.mockResolvedValue([createMockRule()]);

            const response = await request(app.getHttpServer()).get("/alimtalk-trigger-rules");

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listRules).toHaveBeenCalledWith(branchId);
        });
    });

    describe("GET /alimtalk-trigger-jobs/upcoming", () => {
        it("uses the default limit when the query is omitted", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([createMockUpcomingJob()]);

            const response = await request(app.getHttpServer()).get("/alimtalk-trigger-jobs/upcoming");

            expect(response.status).toBe(200);
            expect(triggerService.listUpcomingJobs).toHaveBeenCalledWith(branchId, 200);
        });

        it("rejects limits above 500", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([]);

            const response = await request(app.getHttpServer())
                .get("/alimtalk-trigger-jobs/upcoming")
                .query({ limit: 999 });

            expect(response.status).toBe(400);
            expect(triggerService.listUpcomingJobs).not.toHaveBeenCalled();
        });
    });

    describe("GET /alimtalk-logs", () => {
        it("returns history for the authenticated tenant", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord()]);

            const response = await request(app.getHttpServer())
                .get("/alimtalk-logs")
                .query({ limit: 25 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 0);
        });

        it("passes validated skip to history lookup", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord()]);

            const response = await request(app.getHttpServer())
                .get("/alimtalk-logs")
                .query({ limit: 25, skip: 50 });

            expect(response.status).toBe(200);
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 50);
        });
    });

    describe("POST /alimtalk-trigger-rules", () => {
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
                    eventType: AlimtalkTriggerEventType.SERVICE_START,
                    offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
                    offsetDays: 2,
                    templateKey: AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER,
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/alimtalk-trigger-rules")
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

        it("rejects invalid trigger enums", async () => {
            const response = await request(app.getHttpServer())
                .post("/alimtalk-trigger-rules")
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

    describe("GET /alimtalk-trigger-rules/:id", () => {
        it("fetches a single rule for the authenticated tenant", async () => {
            triggerService.getRule.mockResolvedValue(createMockRule({ id: "rule-42" }));

            const response = await request(app.getHttpServer()).get("/alimtalk-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.getRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("PATCH /alimtalk-trigger-rules/:id", () => {
        it("updates a rule with a valid partial payload", async () => {
            triggerService.updateRule.mockResolvedValue(
                createMockRule({
                    id: "rule-42",
                    isActive: false,
                    name: "비활성 규칙",
                }),
            );

            const response = await request(app.getHttpServer())
                .patch("/alimtalk-trigger-rules/rule-42")
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
                .patch("/alimtalk-trigger-rules/rule-42")
                .send({
                    offsetDays: -1,
                });

            expect(response.status).toBe(400);
            expect(triggerService.updateRule).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /alimtalk-trigger-rules/:id", () => {
        it("deletes a rule for the authenticated tenant", async () => {
            triggerService.deleteRule.mockResolvedValue(undefined);

            const response = await request(app.getHttpServer()).delete("/alimtalk-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.deleteRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("GET /alimtalk-trigger-templates", () => {
        it("passes provider and filters through to the service", async () => {
            triggerService.listTemplates.mockResolvedValue([createMockTemplate()]);

            const response = await request(app.getHttpServer())
                .get("/alimtalk-trigger-templates")
                .query({
                    provider: "aligo",
                    eventType: "CLIENT_CREATED",
                    recipientType: "CLIENT",
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listTemplates).toHaveBeenCalledWith({
                provider: "aligo",
                eventType: "CLIENT_CREATED",
                recipientType: "CLIENT",
            });
        });
    });
});
