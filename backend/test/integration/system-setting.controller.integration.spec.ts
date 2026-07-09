import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import {
    ALIMTALK_DELIVERY_MAX_ATTEMPTS,
    ALIMTALK_DELIVERY_RETRY_DELAY_MS,
    PAST_OCCURRENCE_GRACE_MS,
    SEND_HOUR_KST,
    SMS_DELIVERY_MAX_ATTEMPTS,
    SMS_DELIVERY_RETRY_DELAY_MS,
    TRIGGER_DISPATCH_CRON,
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_PROCESSING_RECLAIM_MS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import {
    getServiceFeedbackLinkScheduledFor,
    getServiceFeedbackTokenExpiresAt,
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_FEEDBACK_LINK_SMS_TITLE,
    SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE,
} from "domain/constants/service-feedback-link-message";

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
            getAlimtalkProvider: jest.fn(),
            getAlimtalkProviderSetting: jest.fn(),
            setAlimtalkProvider: jest.fn(),
            isAlimtalkEnabled: jest.fn(),
        };
        const mockMessageSenderApprovalService = {
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
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        systemSettingService = moduleFixture.get(SystemSettingService);
        messageSenderApprovalService = moduleFixture.get(MessageSenderApprovalService);
        controller = moduleFixture.get(SystemSettingController);
    });

    afterEach(async () => {
        await app?.close();
    });

    describe("GET /settings/alimtalk-provider", () => {
        it("should return current provider setting", async () => {
            const updatedAt = new Date("2026-05-28T12:00:00.000Z");
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(
                new SystemSettingEntity("alimtalk_provider", "aligo_alimtalk", updatedAt)
            );

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo_alimtalk",
                enabled: true,
                updatedAt: updatedAt.toISOString(),
            });
        });

        it("should return disabled state when provider is none", async () => {
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(
                new SystemSettingEntity(
                    "alimtalk_provider",
                    "none",
                    new Date("2026-05-28T12:00:00.000Z")
                )
            );

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "none",
                enabled: false,
                updatedAt: "2026-05-28T12:00:00.000Z",
            });
        });

        it("should return default provider without updatedAt when setting is not stored", async () => {
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(null);
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo_alimtalk");

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo_alimtalk",
                enabled: true,
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

        it("should return policies with values computed from runtime constants", async () => {
            const response = await controller.getMessageAutomationPolicies();

            expect(response.policies.map((policy: { id: string }) => policy.id)).toEqual([
                "trigger-dispatch",
                "trigger-job-retry",
                "sms-retry",
                "alimtalk-retry",
                "past-trigger",
                "approval-gate",
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
                active: true,
                requiresApproval: false,
            });
            expect(getPolicy(response, "alimtalk-retry")).toMatchObject({
                active: true,
                requiresApproval: false,
            });
            expect(getPolicy(response, "past-trigger")).toMatchObject({
                active: true,
                requiresApproval: true,
            });
            expect(getPolicy(response, "approval-gate")).toMatchObject({
                active: true,
                requiresApproval: false,
            });
            expect(getPolicy(response, "service-feedback-link")).toMatchObject({
                active: true,
                requiresApproval: true,
            });

            expect(getRowValue(response, "trigger-dispatch", "dispatch-interval"))
                .toBe(`${formatCronIntervalMinutes(TRIGGER_DISPATCH_CRON)}마다`);
            expect(getRowValue(response, "trigger-dispatch", "send-time"))
                .toBe(`${formatKstHour(SEND_HOUR_KST)} KST`);
            expect(getRowValue(response, "trigger-job-retry", "retry-delay"))
                .toBe(`${formatMinutes(TRIGGER_JOB_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "trigger-job-retry", "max-attempts"))
                .toBe(`최대 ${TRIGGER_JOB_MAX_ATTEMPTS}회`);
            expect(getRowValue(response, "trigger-job-retry", "config-retry-delay"))
                .toBe(`${formatMinutes(TRIGGER_JOB_CONFIG_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "trigger-job-retry", "processing-reclaim"))
                .toBe(`${formatMinutes(TRIGGER_JOB_PROCESSING_RECLAIM_MS)} 후`);
            expect(getRowValue(response, "sms-retry", "max-attempts"))
                .toBe(`최대 ${SMS_DELIVERY_MAX_ATTEMPTS}회`);
            expect(getRowValue(response, "sms-retry", "retry-delay"))
                .toBe(`${formatMinutes(SMS_DELIVERY_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "alimtalk-retry", "max-attempts"))
                .toBe(`최대 ${ALIMTALK_DELIVERY_MAX_ATTEMPTS}회`);
            expect(getRowValue(response, "alimtalk-retry", "retry-delay"))
                .toBe(`${formatMinutes(ALIMTALK_DELIVERY_RETRY_DELAY_MS)} 후`);
            expect(getRowValue(response, "past-trigger", "grace-window"))
                .toBe(`${formatHours(PAST_OCCURRENCE_GRACE_MS)} 이상`);
            expect(getRowValue(response, "service-feedback-link", "message-title"))
                .toBe(SERVICE_FEEDBACK_LINK_SMS_TITLE);
            expect(getRowValue(response, "service-feedback-link", "trigger-type"))
                .toBe(SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE);
            expect(getRowValue(response, "service-feedback-link", "scheduled-for"))
                .toBe(`서비스 시작일 ${formatKstDateHour(getServiceFeedbackLinkScheduledFor(REFERENCE_SERVICE_DATE))} KST`);
            expect(getRowValue(response, "service-feedback-link", "token-expires-at"))
                .toBe(`서비스 종료일 ${formatKstDateHour(getServiceFeedbackTokenExpiresAt(REFERENCE_SERVICE_DATE))} KST`);
            expect(getRowValue(response, "service-feedback-link", "rule-id"))
                .toBe(SERVICE_FEEDBACK_LINK_RULE_ID);
            expect(getRowValue(response, "service-feedback-link", "automation-key"))
                .toBe(SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY);
            expect(getRowValue(response, "service-feedback-link", "template-key"))
                .toBe(SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY);
        });
    });

    describe("PUT /settings/alimtalk-provider", () => {
        it("should require owner/admin privileges", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.updateAlimtalkProvider,
            ) ?? [];

            expect(guards).toContain(OwnerOrAdminGuard);
        });

        it("should update provider to aligo_alimtalk", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date()
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "aligo_alimtalk" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("aligo_alimtalk");
            expect(response.body.enabled).toBe(true);
        });

        it("should update provider to none (disabled)", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "none",
                new Date()
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "none" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("none");
            expect(response.body.enabled).toBe(false);
        });

        it("should return 400 for invalid provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "invalid_provider" });

            expect(response.status).toBe(400);
        });

        it("should return 400 for missing provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({});

            expect(response.status).toBe(400);
        });

        it("should return 400 for empty provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "" });

            expect(response.status).toBe(400);
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
