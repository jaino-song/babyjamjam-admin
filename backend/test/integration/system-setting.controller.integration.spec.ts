import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { SystemSettingService } from "application/services/system-setting.service";
import { EformsignAutomationStatusService } from "application/services/eformsign-automation-status.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { TenantGuard } from "infrastructure/tenant";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import {
    PAST_OCCURRENCE_GRACE_MS,
    SEND_HOUR_KST,
    SMS_DELIVERY_MAX_ATTEMPTS,
    SMS_DELIVERY_RETRY_DELAY_MS,
    TRIGGER_DISPATCH_CRON,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_PROCESSING_RECLAIM_MS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import {
    getServiceRecordLinkScheduledFor,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
} from "domain/constants/service-record-link-message";
import { STORED_MESSAGE_SETTINGS_POLICY_IDS } from "domain/constants/message-settings-policy";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const REFERENCE_SERVICE_DATE = new Date("2026-01-01T00:00:00.000Z");

describe("SystemSettingController (Integration)", () => {
    let app: INestApplication;
    let controller: SystemSettingController;
    let systemSettingService: jest.Mocked<SystemSettingService>;
    let messageSenderApprovalService: jest.Mocked<MessageSenderApprovalService>;

    beforeEach(async () => {
        const mockSystemSettingService = {
            getMessageAutomationPastTriggerConfig: jest.fn(),
            getMessageAutomationPolicyConfig: jest.fn(),
            setMessageAutomationPolicyConfig: jest.fn(),
            previewMessageAutomationPolicyConfig: jest.fn(),
            setMessageAutomationPastTriggerConfig: jest.fn(),
            getMessageSettingsPolicyActivations: jest.fn(),
            setMessageSettingsPolicyEnabled: jest.fn(),
        };
        const mockMessageSenderApprovalService = {
            requestApproval: jest.fn(),
            canRequest: jest.fn(),
            approvePendingRequest: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [SystemSettingController],
            providers: [
                {
                    provide: SystemSettingService,
                    useValue: mockSystemSettingService,
                },
                {
                    provide: MessageSenderApprovalService,
                    useValue: mockMessageSenderApprovalService,
                },
                {
                    provide: EformsignAutomationStatusService,
                    useValue: {
                        getStatus: jest.fn().mockReturnValue({
                            webhookConfigured: true,
                            sweepEnabled: true,
                            sweepRunnable: true,
                        }),
                    },
                },
                {
                    provide: EformsignWebhookEventWriter,
                    useValue: {
                        countSince: jest.fn().mockResolvedValue({ received: 12, dropped: 3 }),
                    },
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: {
                    switchToHttp: () => {
                        getRequest: () => { user?: { userId: string; role: string } };
                    };
                }) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = { userId: "owner-user-id", role: "owner" };
                    return true;
                },
            })
            .overrideGuard(TenantGuard)
            .useValue({ canActivate: (context: ExecutionContext) => {
                const req = context.switchToHttp().getRequest();
                req.tenant = { branchId: req.headers["x-test-branch"] ?? "branch-B", globalRole: "owner" };
                return true;
            } })
            .overrideGuard(BranchManagerGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.listen(0, "127.0.0.1");

        systemSettingService = moduleFixture.get(SystemSettingService);
        messageSenderApprovalService = moduleFixture.get(MessageSenderApprovalService);
        controller = moduleFixture.get(SystemSettingController);
        systemSettingService.getMessageAutomationPolicyConfig.mockResolvedValue({ version: null, configuration: defaultMessageAutomationPolicy(), warnings: [] });
        systemSettingService.getMessageAutomationPastTriggerConfig.mockResolvedValue({
            sendIntervalMinutes: 1,
            ruleOrder: [],
        });
        systemSettingService.getMessageSettingsPolicyActivations.mockResolvedValue(
            Object.fromEntries(
                STORED_MESSAGE_SETTINGS_POLICY_IDS.map((policyId) => [policyId, true]),
            ) as Record<(typeof STORED_MESSAGE_SETTINGS_POLICY_IDS)[number], boolean>,
        );
    });

    afterEach(async () => {
        await app?.close();
    });

    it.each([
        ["get", "/settings/message-automation-policies", "getMessageAutomationPolicyConfig"],
        ["get", "/settings/message-automation-policies/config", "getMessageAutomationPolicyConfig"],
        ["put", "/settings/message-automation-policies/config", "setMessageAutomationPolicyConfig"],
        ["post", "/settings/message-automation-policies/config/preview", "previewMessageAutomationPolicyConfig"],
        ["put", "/settings/message-policy-activations/trigger-dispatch", "setMessageSettingsPolicyEnabled"],
        ["put", "/settings/message-automation-policies/past-trigger", "setMessageAutomationPastTriggerConfig"],
    ] as const)("fences captured branch A before %s %s on authenticated branch B", async (method, path, serviceMethod) => {
        const configuration = defaultMessageAutomationPolicy();
        systemSettingService.setMessageAutomationPolicyConfig.mockResolvedValue({ version: "saved-version", configuration, warnings: [] });
        systemSettingService.previewMessageAutomationPolicyConfig.mockResolvedValue({} as Awaited<ReturnType<SystemSettingService["previewMessageAutomationPolicyConfig"]>>);
        systemSettingService.setMessageSettingsPolicyEnabled.mockResolvedValue(SystemSettingEntity.create("activation", "false"));
        systemSettingService.setMessageAutomationPastTriggerConfig.mockResolvedValue(SystemSettingEntity.create("policy", JSON.stringify(configuration)));
        const body = { expectedVersion: null, configuration, enabled: false, sendIntervalMinutes: 1, ruleOrder: [] };

        const stale = await request(app.getHttpServer())[method](path)
            .query({ expectedBranchId: "branch-A" }).set("x-test-branch", "branch-B").send(body).expect(409);
        expect(stale.body.code).toBe("BRANCH_CONTEXT_CHANGED");
        for (const mock of Object.values(systemSettingService)) expect(mock).not.toHaveBeenCalled();

        await request(app.getHttpServer())[method](path)
            .query({ expectedBranchId: "branch-B" }).set("x-test-branch", "branch-B").send(body).expect(200);
        expect(systemSettingService[serviceMethod]).toHaveBeenCalledTimes(1);
        expect(systemSettingService[serviceMethod].mock.calls[0]?.[0]).toBe("branch-B");
    });

    describe("GET /settings/client-registration-policy", () => {
        it("should expose a GET route", () => {
            const method = SystemSettingController.prototype.getClientRegistrationPolicy;

            expect(Reflect.getMetadata(PATH_METADATA, method)).toBe("client-registration-policy");
            expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
        });

        it("should return the policy together with the automation trigger status", async () => {
            systemSettingService.getClientAutoRegistrationEnabled = jest.fn().mockResolvedValue(true);
            systemSettingService.getGreetingOnAutoRegistrationEnabled = jest.fn().mockResolvedValue(false);

            const response = await controller.getClientRegistrationPolicy();

            expect(response.clientAutoRegistration).toBe(true);
            expect(response.greetingOnAutoRegistration).toBe(false);
            // "configured" only says the endpoint could be called; the two
            // counts say whether anything actually arrived and landed.
            expect(response.automation).toEqual({
                webhookConfigured: true,
                sweepEnabled: true,
                sweepRunnable: true,
                webhookReceived24h: 12,
                webhookDropped24h: 3,
            });
        });
    });

    describe("GET /settings/message-automation-policies", () => {
        it("should expose a GET route", () => {
            const method = SystemSettingController.prototype.getMessageAutomationPolicies;

            expect(Reflect.getMetadata(PATH_METADATA, method)).toBe("message-automation-policies");
            expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
        });

        it("should use the tenant guard", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.getMessageAutomationPolicies,
            ) ?? [];

            expect(guards).toContain(TenantGuard);
        });

        it("should expose a manager-scoped PUT route for past trigger config", () => {
            const method = SystemSettingController.prototype.updateMessageAutomationPastTriggerConfig;

            expect(Reflect.getMetadata(PATH_METADATA, method)).toBe("message-automation-policies/past-trigger");
            expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.PUT);
            expect(Reflect.getMetadata(GUARDS_METADATA, method) ?? []).toContain(BranchManagerGuard);
        });

        it("should expose a manager-scoped PUT route for policy activation", () => {
            const method = SystemSettingController.prototype.updateMessageSettingsPolicyActivation;

            expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
                "message-policy-activations/:policyId",
            );
            expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.PUT);
            expect(Reflect.getMetadata(GUARDS_METADATA, method) ?? []).toContain(BranchManagerGuard);
        });

        it("should return policies with values computed from runtime constants", async () => {
            systemSettingService.getMessageSettingsPolicyActivations.mockResolvedValue({
                ...Object.fromEntries(
                    STORED_MESSAGE_SETTINGS_POLICY_IDS.map((policyId) => [policyId, true]),
                ),
                "sms-retry": false,
            } as Record<(typeof STORED_MESSAGE_SETTINGS_POLICY_IDS)[number], boolean>);
            const response = await controller.getMessageAutomationPolicies();

            expect(response.policies.map((policy: { id: string }) => policy.id)).toEqual([
                "trigger-dispatch",
                "trigger-job-retry",
                "sms-retry",
                "past-trigger",
                "service-feedback-link",
            ]);

            expect(getPolicy(response, "trigger-dispatch")).toMatchObject({
                active: true,
                requiresApproval: true,
            });
            expect(getPolicy(response, "trigger-job-retry")).toMatchObject({
                active: true,
                requiresApproval: true,
            });
            expect(getPolicy(response, "sms-retry")).toMatchObject({
                active: false,
                requiresApproval: false,
            });
            expect(response.policyActivations["duplicate-send-confirmation"]).toBe(true);
            expect(getPolicy(response, "past-trigger")).toMatchObject({
                active: true,
                requiresApproval: true,
                description: "기존 발송 예정의 만료와 늦게 등록한 고객의 보충 발송을 구분합니다.",
            });
            expect(getPolicy(response, "service-feedback-link")).toMatchObject({
                active: true,
                requiresApproval: true,
            });
            expect(response.pastTriggerConfig).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });

            expect(getRowValue(response, "trigger-dispatch", "dispatch-interval"))
                .toBe(`${formatCronIntervalMinutes(TRIGGER_DISPATCH_CRON)}마다`);
            expect(getRowValue(response, "trigger-dispatch", "send-time"))
                .toBe(`규칙별 설정 (기본 ${formatKstHour(SEND_HOUR_KST)} KST)`);
            expect(getRowValue(response, "trigger-job-retry", "retry-delay"))
                .toBe(`${formatMinutes(TRIGGER_JOB_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "trigger-job-retry", "max-attempts"))
                .toBe(`최대 ${TRIGGER_JOB_MAX_ATTEMPTS}회`);
            expect(getPolicy(response, "trigger-job-retry").rows.some((row) => row.id === "config-retry-delay"))
                .toBe(false);
            expect(getRowValue(response, "trigger-job-retry", "processing-reclaim"))
                .toBe(`${formatMinutes(TRIGGER_JOB_PROCESSING_RECLAIM_MS)} 후`);
            expect(getRowValue(response, "sms-retry", "max-attempts"))
                .toBe(`최대 ${SMS_DELIVERY_MAX_ATTEMPTS}회`);
            expect(getRowValue(response, "sms-retry", "retry-delay"))
                .toBe(`${formatMinutes(SMS_DELIVERY_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "past-trigger", "grace-window"))
                .toBe(`예정 시각 후 ${formatHours(PAST_OCCURRENCE_GRACE_MS)}`);
            expect(getRowValue(response, "past-trigger", "late-registration"))
                .toBe("서비스 시작 전 순차 발송");
            expect(getRowValue(response, "past-trigger", "post-start-registration"))
                .toBe("시작 전 안내 제외");
            expect(getRowValue(response, "service-feedback-link", "message-title"))
                .toBe(SERVICE_RECORD_LINK_SMS_TITLE);
            expect(getRowValue(response, "service-feedback-link", "trigger-type"))
                .toBe(SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE);
            expect(getRowValue(response, "service-feedback-link", "scheduled-for"))
                .toBe(`서비스 시작 1일 전 ${formatKstDateHour(getServiceRecordLinkScheduledFor(REFERENCE_SERVICE_DATE))} KST (늦게 등록되면 즉시 발송)`);
            expect(getRowValue(response, "service-feedback-link", "token-expires-at"))
                .toBe("서비스 종료일 8일 후 00:00 KST");
            expect(getRowValue(response, "service-feedback-link", "rule-id"))
                .toBe(SERVICE_RECORD_LINK_RULE_ID);
            expect(getRowValue(response, "service-feedback-link", "automation-key"))
                .toBe(SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY);
            expect(getRowValue(response, "service-feedback-link", "template-key"))
                .toBe(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
        });

        it("should project activation management from the resolved tenant roles", async () => {
            const owner = await controller.getMessageAutomationPolicies({
                branchId: "branch-1",
                globalRole: "owner",
                branchRole: "user",
            });
            const admin = await controller.getMessageAutomationPolicies({
                branchId: "branch-1",
                globalRole: "user",
                branchRole: "admin",
            });
            const member = await controller.getMessageAutomationPolicies({
                branchId: "branch-1",
                globalRole: "user",
                branchRole: "user",
            });
            const manager = await controller.getMessageAutomationPolicies({
                branchId: "branch-1",
                globalRole: "user",
                branchRole: "manager",
            });

            expect(owner.canManageActivation).toBe(true);
            expect(admin.canManageActivation).toBe(true);
            expect(manager.canManageActivation).toBe(true);
            expect(member.canManageActivation).toBe(false);
        });

        it("should update a branch-scoped policy activation", async () => {
            systemSettingService.setMessageSettingsPolicyEnabled.mockResolvedValue(
                new SystemSettingEntity(
                    "branch:branch-1:message_policy:trigger-dispatch:enabled",
                    "false",
                    new Date("2026-09-15T00:00:00.000Z"),
                ),
            );

            const response = await controller.updateMessageSettingsPolicyActivation(
                { branchId: "branch-1" },
                { policyId: "trigger-dispatch" },
                { enabled: false },
            );

            expect(systemSettingService.setMessageSettingsPolicyEnabled).toHaveBeenCalledWith(
                "branch-1",
                "trigger-dispatch",
                false,
            );
            expect(response).toEqual({
                policyId: "trigger-dispatch",
                enabled: false,
            });
        });

        it("should update the branch-scoped past trigger config", async () => {
            systemSettingService.setMessageAutomationPastTriggerConfig.mockResolvedValue(
                new SystemSettingEntity(
                    "branch:branch-1:message_automation:policy",
                    JSON.stringify({
                        ...defaultMessageAutomationPolicy(),
                        pastSendIntervalMinutes: 3,
                        pastRuleOrder: ["rule-2", "rule-1"],
                    }),
                    new Date("2026-07-09T00:00:00.000Z"),
                ),
            );

            const response = await controller.updateMessageAutomationPastTriggerConfig(
                { branchId: "branch-1" },
                {
                    sendIntervalMinutes: 3,
                    ruleOrder: ["rule-2", "rule-1"],
                },
            );

            expect(systemSettingService.setMessageAutomationPastTriggerConfig).toHaveBeenCalledWith(
                "branch-1",
                {
                    sendIntervalMinutes: 3,
                    ruleOrder: ["rule-2", "rule-1"],
                },
            );
            expect(response).toEqual({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1"],
            });
        });
    });

    describe("POST /settings/message-sender-approval/:branchId/approve", () => {
        it("should approve a pending message sender request as owner", async () => {
            const approvedAt = new Date("2026-06-05T00:00:00.000Z");
            messageSenderApprovalService.approvePendingRequest.mockResolvedValue({
                approvalStatus: "approved",
                requestedAt: new Date("2026-06-04T09:00:00.000Z"),
                approvedAt,
            });

            const response = await request(app.getHttpServer())
                .post("/settings/message-sender-approval/branch-1/approve");

            expect(response.status).toBe(201);
            expect(messageSenderApprovalService.approvePendingRequest).toHaveBeenCalledWith({
                branchId: "branch-1",
                userId: expect.any(String),
            });
            expect(response.body).toMatchObject({
                approvalStatus: "approved",
                isApproved: true,
                approvedAt: approvedAt.toISOString(),
            });
        });

        it("should require owner privileges", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.approveMessageSenderApproval,
            ) ?? [];

            expect(guards).toContain(OwnerGuard);
        });
    });

    describe("POST /settings/message-sender-approval/request", () => {
        it("uses tenant membership for the request route", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.requestMessageSenderApproval,
            ) ?? [];

            expect(guards).toContain(TenantGuard);
        });

        it.each(["owner", "admin", "manager", "user"] as const)(
            "allows %s to request sender approval",
            async (branchRole) => {
                const requestedAt = new Date("2026-06-05T00:00:00.000Z");
                messageSenderApprovalService.requestApproval.mockResolvedValue({
                    approvalStatus: "pending",
                    requestedAt,
                    approvedAt: null,
                });
                messageSenderApprovalService.canRequest.mockReturnValue(true);

                const response = await controller.requestMessageSenderApproval(
                    {
                        userId: `${branchRole}-user`,
                        branchId: "branch-1",
                        globalRole: branchRole === "owner" ? "owner" : "user",
                        branchRole,
                    },
                    { user: { userId: `${branchRole}-user` } },
                );

                expect(response).toMatchObject({
                    approvalStatus: "pending",
                    canRequest: true,
                });
                expect(messageSenderApprovalService.requestApproval).toHaveBeenCalledWith({
                    branchId: "branch-1",
                    branchRole,
                    userId: `${branchRole}-user`,
                });
            },
        );
    });
});

function getPolicy(
    body: { policies: Array<{ id: string; rows: Array<{ id: string; value: string }> }> },
    policyId: string,
): { id: string; rows: Array<{ id: string; value: string }> } {
    const policy = body.policies.find((item) => item.id === policyId);
    expect(policy).toBeDefined();
    return policy!;
}

function getRowValue(
    body: { policies: Array<{ id: string; rows: Array<{ id: string; value: string }> }> },
    policyId: string,
    rowId: string,
): string {
    const row = getPolicy(body, policyId).rows.find((item) => item.id === rowId);
    expect(row).toBeDefined();
    return row!.value;
}

function formatMinutes(ms: number): string {
    return `${ms / MS_PER_MINUTE}분`;
}

function formatHours(ms: number): string {
    return `${ms / MS_PER_HOUR}시간`;
}

function formatCronIntervalMinutes(cron: string): string {
    const minuteExpression = cron.split(" ")[0] ?? "";
    const interval = Number(minuteExpression.replace("*/", ""));
    return `${interval}분`;
}

function formatKstHour(hour: number): string {
    return `${String(hour).padStart(2, "0")}:00`;
}

function formatKstDateHour(date: Date): string {
    const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hourCycle: "h23",
    }).format(date);

    return `${hour}:00`;
}

// Real controller + service + use cases + tenant/manager guards. Persistence is
// an isolated in-memory repository; no database or provider is reachable here.
describe("POL-1 policy config HTTP boundary", () => {
    const config = () => ({
        schemaVersion: 1, dispatchCheckIntervalMinutes: 1, defaultRuleSendTime: "09:00",
        triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5,
        pastExpiryHours: 24, pastSendIntervalMinutes: 1, pastRuleOrder: [], duplicateWindowHours: 72,
        quietHours: { enabled: false, start: "22:00", end: "08:00", recipientGroups: ["CLIENT", "CAREGIVER", "STAFF"], action: "DEFER", timezone: "Asia/Seoul" },
    });
    let app: INestApplication;
    let membershipRole: string;
    let rows: Map<string, string>;
    let repository: { findByKey: jest.Mock; compareAndSet: jest.Mock };
    let logs: { countFutureProviderReservations: jest.Mock; findPolicyPreviewCandidates: jest.Mock; resolvePolicyRecipientGroups: jest.Mock };
    const path = "/settings/message-automation-policies/config";
    const key = "branch:A:message_automation:policy";
    beforeEach(async () => {
        rows = new Map();
        membershipRole = "manager";
        repository = {
            findByKey: jest.fn(async key => rows.has(key) ? SystemSettingEntity.create(key, rows.get(key)!) : null),
            compareAndSet: jest.fn(async (key, expected, entity, versionOf) => {
                if (versionOf(rows.get(key) ?? null) !== expected) return null;
                rows.set(key, entity.value);
                return entity;
            }),
        };
        logs = { countFutureProviderReservations: jest.fn().mockResolvedValue(0), findPolicyPreviewCandidates: jest.fn().mockResolvedValue([]),
            resolvePolicyRecipientGroups: jest.fn(async (_branch, candidates) => candidates) };
        const service = new SystemSettingService(new GetSettingUsecase(repository as any), new UpdateSettingUsecase(repository as any), { append: jest.fn() } as any, undefined,
            { findAll: jest.fn().mockResolvedValue([]) } as any, { findPolicyPreviewCandidates: jest.fn().mockResolvedValue([]) } as any, logs as any,
            { runExclusive: async (_branch: string, work: (tx: unknown) => Promise<unknown>) => work({ marker: "same TX" }) } as any);
        const prisma = { user_branch: { findFirst: jest.fn(async ({ where }) => where.branchId === "A" ? { role: membershipRole, branch: { isActive: true } } : null) },
            branch: { findUnique: jest.fn().mockResolvedValue({ id: "A", isActive: true }) } };
        const fixture = await Test.createTestingModule({ controllers: [SystemSettingController], providers: [
            { provide: SystemSettingService, useValue: service }, { provide: MessageSenderApprovalService, useValue: {} },
            { provide: EformsignAutomationStatusService, useValue: {} },
        ] }).overrideGuard(JwtGuard).useValue({ canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "fixture-user", role: req.headers["x-test-role"] ?? "user", branchId: req.headers["x-test-branch"] ?? "A" };
            return true;
        } }).overrideGuard(TenantGuard).useValue(new TenantGuard(prisma as any, new TenantContext()))
            .overrideGuard(BranchManagerGuard).useValue(new BranchManagerGuard()).compile();
        app = fixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
    });
    afterEach(async () => { await app?.close(); });
    it("GET defaults and PUT/reload return stable values; stale requests change nothing", async () => {
        const initial = await request(app.getHttpServer()).get(path).expect(200);
        expect(initial.body).toEqual({ version: null, configuration: config(), permissions: { canRead: true, canWrite: true }, warnings: [] });
        const changed = { ...config(), dispatchCheckIntervalMinutes: 7, defaultRuleSendTime: "10:45" };
        const saved = await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration: changed, branchId: "B" }).expect(200);
        expect(saved.body.configuration).toEqual(changed);
        expect(saved.body.version).toMatch(/^[a-f0-9]{64}$/);
        const reload = await request(app.getHttpServer()).get(path).expect(200);
        expect(reload.body).toEqual(saved.body);
        const before = rows.get(key);
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration: config() }).expect(409);
        expect(rows.get(key)).toBe(before);
        expect(rows.has("branch:B:message_automation:policy")).toBe(false);
        expect(repository.compareAndSet).toHaveBeenCalledTimes(1);
    });
    it("legacy explanation rows use resolved branch policy values", async () => {
        rows.set(key, JSON.stringify({ ...config(), dispatchCheckIntervalMinutes: 7, defaultRuleSendTime: "11:30", triggerRetryIntervalMinutes: 8,
            processingReclaimMinutes: 20, smsRetryIntervalMinutes: 12, pastExpiryHours: 48, pastSendIntervalMinutes: 3, duplicateWindowHours: 96 }));
        // The activation reader is separate from canonical configuration storage.
        const response = await request(app.getHttpServer()).get("/settings/message-automation-policies").expect(200);
        const row = (policy: string, id: string) => response.body.policies.find((item: { id: string }) => item.id === policy).rows.find((item: { id: string }) => item.id === id).value;
        expect(row("trigger-dispatch", "dispatch-interval")).toBe("7분마다");
        expect(row("trigger-dispatch", "send-time")).toBe("규칙별 설정 (기본 11:30 KST)");
        expect(row("trigger-dispatch", "duplicate-window")).toBe("96시간");
        expect(row("trigger-job-retry", "retry-delay")).toBe("8분 후");
        expect(row("trigger-job-retry", "processing-reclaim")).toBe("20분 후");
        expect(row("sms-retry", "retry-delay")).toBe("12분 후");
        expect(row("past-trigger", "grace-window")).toBe("예정 시각 후 48시간");
        expect(row("past-trigger", "catch-up-interval")).toBe("3분");
    });
    it("denies branch B read/write through the actual tenant guard", async () => {
        await request(app.getHttpServer()).get(path).set("x-test-branch", "B").expect(403);
        await request(app.getHttpServer()).put(path).set("x-test-branch", "B").send({ expectedVersion: null, configuration: config() }).expect(403);
        expect(repository.findByKey).not.toHaveBeenCalled();
        expect(repository.compareAndSet).not.toHaveBeenCalled();
    });
    it("allows owner/admin/manager writes and projects read-only member permissions", async () => {
        for (const role of ["admin", "manager"]) {
            membershipRole = role;
            const current = await request(app.getHttpServer()).get(path).expect(200);
            expect(current.body.permissions).toEqual({ canRead: true, canWrite: true });
            await request(app.getHttpServer()).put(path).send({ expectedVersion: current.body.version, configuration: config() }).expect(200);
        }
        membershipRole = "user";
        const member = await request(app.getHttpServer()).get(path).expect(200);
        expect(member.body.permissions).toEqual({ canRead: true, canWrite: false });
        await request(app.getHttpServer()).put(path).send({ expectedVersion: member.body.version, configuration: config() }).expect(403);
        await request(app.getHttpServer()).post(`${path}/preview`).send({ expectedVersion: member.body.version, configuration: config() }).expect(200);
        await request(app.getHttpServer()).put(path).set("x-test-role", "owner").send({ expectedVersion: member.body.version, configuration: config() }).expect(200);
    });

    it.each([
        ["dispatchCheckIntervalMinutes", 0], ["defaultRuleSendTime", "8:00"], ["triggerRetryIntervalMinutes", 0],
        ["processingReclaimMinutes", 9], ["smsRetryIntervalMinutes", 1441], ["pastExpiryHours", 0],
        ["pastSendIntervalMinutes", 1.2], ["duplicateWindowHours", 721],
    ])("returns 400 for invalid %s", async (field, value) => {
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration: { ...config(), [field]: value } }).expect(400);
        expect(repository.compareAndSet).not.toHaveBeenCalled();
    });
    it("requires an explicit version and rejects malformed quiet settings", async () => {
        await request(app.getHttpServer()).put(path).send({ configuration: config() }).expect(400);
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration: { ...config(), quietHours: { ...config().quietHours, enabled: true, recipientGroups: [] } } }).expect(400);
        expect(repository.compareAndSet).not.toHaveBeenCalled();
    });
    it("returns reservation409/zero200 and preview reports the gate without writes", async () => {
        const configuration = { ...config(), quietHours: { ...config().quietHours, enabled: true } };
        logs.countFutureProviderReservations.mockResolvedValue(1);
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration }).expect(409);
        const preview = await request(app.getHttpServer()).post(`${path}/preview`).send({ expectedVersion: null, configuration }).expect(200);
        expect(preview.body).toMatchObject({ futureProviderReservations: 1, canEnableQuietHours: false, deferredCount: 0, canceledCount: 0 });
        expect(repository.compareAndSet).not.toHaveBeenCalled();
        logs.countFutureProviderReservations.mockResolvedValue(0);
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration }).expect(200);
    });
    it("returns503 for corrupt storage with zero mutations or provider collaborators", async () => {
        rows.set(key, "{");
        await request(app.getHttpServer()).get(path).expect(503);
        await request(app.getHttpServer()).put(path).send({ expectedVersion: null, configuration: config() }).expect(503);
        await request(app.getHttpServer()).post(`${path}/preview`).send({ expectedVersion: null, configuration: config() }).expect(503);
        expect(rows.get(key)).toBe("{");
        expect(repository.compareAndSet).not.toHaveBeenCalled();
        expect(logs.countFutureProviderReservations).not.toHaveBeenCalled();
    });
});
