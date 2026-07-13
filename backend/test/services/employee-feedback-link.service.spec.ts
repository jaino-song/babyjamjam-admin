import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmployeeFeedbackLinkService } from "application/services/employee-feedback-link.service";
import {
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_FEEDBACK_LINK_SMS_TITLE,
} from "domain/constants/service-feedback-link-message";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("EmployeeFeedbackLinkService", () => {
    const createPrisma = () => ({
        employee_schedule: {
            findUnique: jest.fn(),
        },
        message_trigger_rule: {
            upsert: jest.fn().mockResolvedValue(undefined),
        },
    });
    const createTokenService = () => ({
        issueLink: jest.fn().mockResolvedValue({ linkToken: "efl_token" }),
        prepareLink: jest.fn().mockResolvedValue({ linkToken: "efl_prepared" }),
        activatePreparedLink: jest.fn().mockResolvedValue(true),
        revokeForSchedule: jest.fn().mockResolvedValue(undefined),
        extendExpiryForSchedule: jest.fn().mockResolvedValue(undefined),
    });
    const createConfigService = () => ({
        get: jest.fn((key: string, fallback?: string) => (
            key === "MOBILE_FEEDBACK_BASE_URL" ? "https://mobile.test/" : fallback
        )),
    });
    const createJobRepository = () => ({
        findPendingByRuleIdsAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        upsertPending: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => job),
    });
    const createLogRepository = () => ({
        save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        update: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        findRetryableServiceFeedbackSmsByScheduleId: jest.fn().mockResolvedValue([]),
    });
    const createSchedule = (overrides: Record<string, unknown> = {}) => ({
        id: 10,
        branchId: "branch-1",
        clientId: 20,
        startDate: new Date("2026-07-03T00:00:00.000Z"),
        endDate: new Date("2026-07-12T00:00:00.000Z"),
        primaryEmployee: {
            id: 30,
            name: "홍제공",
            phone: "010-1111-2222",
            birthday: "900101",
        },
        client: {
            id: 20,
            name: "김산모",
        },
        ...overrides,
    });

    it("issues a token that expires at end-date 20:00 KST and schedules SMS for start-date 15:00 KST", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.scheduleForServiceStart(10);

        expect(tokenService.issueLink).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
            expiresAt: new Date("2026-07-12T20:00:00+09:00"),
        });
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.ruleId).toBe(SERVICE_FEEDBACK_LINK_RULE_ID);
        expect(job.templateKey).toBe(MessageTriggerTemplateKey.SERVICE_FEEDBACK_LINK);
        expect(job.recipientType).toBe(MessageTriggerRecipientType.PRIMARY_EMPLOYEE);
        expect(job.scheduledFor).toEqual(new Date("2026-07-03T15:00:00+09:00"));
        expect(job.payload.messageBody).toContain("https://mobile.test/feedback/efl_token");
        expect(job.payload.messageBody).toContain("휴대폰 번호로 본인확인");
        expect(job.payload.templateVariables).toEqual(expect.objectContaining({
            clientName: "김산모",
            employeeName: "홍제공",
            feedbackUrl: "https://mobile.test/feedback/efl_token",
        }));
    });

    it("sendNow grants a 24-hour late token and upserts an immediate pending job", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const before = Date.now();
        const result = await service.sendNow(10);
        const after = Date.now();

        expect(tokenService.issueLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        const issuedExpiry = tokenService.issueLink.mock.calls[0]?.[0].expiresAt as Date;
        expect(issuedExpiry.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
        expect(issuedExpiry.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.scheduledFor.getTime()).toBeGreaterThanOrEqual(before);
        expect(job.scheduledFor.getTime()).toBeLessThanOrEqual(after);
        expect(result.scheduledFor).toBe(job.scheduledFor);
        expect(job.dedupeKey).toBe(`${SERVICE_FEEDBACK_LINK_RULE_ID}:schedule:10:primary`);
        expect(job.payload.buttonUrl).toBe("https://mobile.test/feedback/efl_token");
    });

    it("prepares an inactive exact URL without enqueueing or canceling any SMS job", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const result = await service.prepareLink(10);

        expect(tokenService.prepareLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(result).toEqual({
            feedbackUrl: "https://mobile.test/feedback/efl_prepared",
            preparedLinkToken: "efl_prepared",
            expiresAt: expect.any(Date),
        });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceFeedbackSmsByScheduleId).not.toHaveBeenCalled();
    });

    it("sendNow reuses the exact prepared URL instead of minting a different link", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10, "efl_prepared");

        expect(tokenService.activatePreparedLink).toHaveBeenCalledWith(expect.objectContaining({
            linkToken: "efl_prepared",
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.payload.buttonUrl).toBe("https://mobile.test/feedback/efl_prepared");
        expect(job.payload.messageBody).toContain("https://mobile.test/feedback/efl_prepared");
    });

    it("rejects an expired or mismatched prepared link instead of silently minting another URL", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.activatePreparedLink.mockResolvedValue(false);
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10, "efl_invalid")).rejects.toBeInstanceOf(BadRequestException);
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceFeedbackSmsByScheduleId).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it("provisions the fixed system rule before issuing a feedback token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith({
            where: { id: SERVICE_FEEDBACK_LINK_RULE_ID },
            create: {
                id: SERVICE_FEEDBACK_LINK_RULE_ID,
                branchId: null,
                name: SERVICE_FEEDBACK_LINK_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_FEEDBACK_LINK,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
        expect(prisma.message_trigger_rule.upsert.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
    });

    it("supersedes retryable stale SMS logs before issuing a replacement token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const logRepository = createLogRepository();
        const staleLog = MessageLogEntity.reconstitute(
            77,
            "branch-1",
            "aligo_sms",
            SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
            "job-1",
            "01011112222",
            20,
            "old link",
            {},
            "failed",
            null,
            "temporary failure",
            1,
            new Date("2026-07-03T06:00:00.000Z"),
            new Date("2026-07-03T06:05:00.000Z"),
            new Date("2026-07-03T06:00:00.000Z"),
            new Date("2026-07-03T06:00:00.000Z"),
        );
        logRepository.findRetryableServiceFeedbackSmsByScheduleId.mockResolvedValue([staleLog]);
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(logRepository.findRetryableServiceFeedbackSmsByScheduleId).toHaveBeenCalledWith(10);
        expect(staleLog.nextRetryAt).toBeNull();
        expect(staleLog.errorMessage).toBe("Feedback link rescheduled");
        expect(logRepository.update).toHaveBeenCalledWith(staleLog);
        expect(logRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
    });

    it("records a failed history row when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({
            primaryEmployee: {
                id: 30,
                name: "홍제공",
                phone: "",
                birthday: "900101",
            },
        }));

        await service.scheduleForServiceStart(10);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.templateKey).toBe(SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY);
        expect(savedLog.status).toBe("failed");
        expect(savedLog.nextRetryAt).toBeNull();
        expect(savedLog.errorMessage).toBe("제공인력 전화번호 누락");
    });

    it("sendNow throws and does not write a permanent failure log when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({
            primaryEmployee: {
                id: 30,
                name: "홍제공",
                phone: "",
                birthday: "900101",
            },
        }));

        await expect(service.sendNow(10)).rejects.toBeInstanceOf(BadRequestException);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("scheduleForServiceStart still swallows scheduling errors", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBeUndefined();
    });

    it("extends an existing token to end-date 20:00 KST", async () => {
        const tokenService = createTokenService();
        const service = new EmployeeFeedbackLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );

        await service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z"));

        expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
            10,
            new Date("2026-07-12T20:00:00+09:00"),
        );
    });
});
