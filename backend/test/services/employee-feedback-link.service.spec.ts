import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmployeeFeedbackLinkService } from "application/services/employee-feedback-link.service";
import {
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-feedback-link-message";
import {
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { IAlimtalkTriggerJobRepository } from "domain/repositories/alimtalk-trigger-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("EmployeeFeedbackLinkService", () => {
    const createPrisma = () => ({
        employee_schedule: {
            findUnique: jest.fn(),
        },
    });
    const createTokenService = () => ({
        issueLink: jest.fn().mockResolvedValue({ linkToken: "efl_token" }),
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
        upsertPending: jest.fn().mockImplementation(async (job: AlimtalkTriggerJobEntity) => job),
    });
    const createLogRepository = () => ({
        save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log),
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
            jobRepository as unknown as IAlimtalkTriggerJobRepository,
            createLogRepository() as unknown as IAlimtalkLogRepository,
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
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as AlimtalkTriggerJobEntity;
        expect(job.ruleId).toBe(SERVICE_FEEDBACK_LINK_RULE_ID);
        expect(job.templateKey).toBe(AlimtalkTriggerTemplateKey.SERVICE_FEEDBACK_LINK);
        expect(job.recipientType).toBe(AlimtalkTriggerRecipientType.PRIMARY_EMPLOYEE);
        expect(job.scheduledFor).toEqual(new Date("2026-07-03T15:00:00+09:00"));
        expect(job.payload.messageBody).toContain("https://mobile.test/feedback/efl_token");
        expect(job.payload.messageBody).toContain("휴대폰 번호로 본인확인");
        expect(job.payload.templateVariables).toEqual(expect.objectContaining({
            clientName: "김산모",
            employeeName: "홍제공",
            feedbackUrl: "https://mobile.test/feedback/efl_token",
        }));
    });

    it("sendNow issues a fresh token and upserts an immediate pending job", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IAlimtalkTriggerJobRepository,
            createLogRepository() as unknown as IAlimtalkLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const before = Date.now();
        const result = await service.sendNow(10);
        const after = Date.now();

        expect(tokenService.issueLink).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
            expiresAt: new Date("2026-07-12T20:00:00+09:00"),
        });
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as AlimtalkTriggerJobEntity;
        expect(job.scheduledFor.getTime()).toBeGreaterThanOrEqual(before);
        expect(job.scheduledFor.getTime()).toBeLessThanOrEqual(after);
        expect(result.scheduledFor).toBe(job.scheduledFor);
        expect(job.dedupeKey).toBe(`${SERVICE_FEEDBACK_LINK_RULE_ID}:schedule:10:primary`);
        expect(job.payload.buttonUrl).toBe("https://mobile.test/feedback/efl_token");
    });

    it("records a failed history row when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new EmployeeFeedbackLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IAlimtalkTriggerJobRepository,
            logRepository as unknown as IAlimtalkLogRepository,
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
        const savedLog = logRepository.save.mock.calls[0]?.[0] as AlimtalkLogEntity;
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
            jobRepository as unknown as IAlimtalkTriggerJobRepository,
            logRepository as unknown as IAlimtalkLogRepository,
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
            createJobRepository() as unknown as IAlimtalkTriggerJobRepository,
            createLogRepository() as unknown as IAlimtalkLogRepository,
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
            createJobRepository() as unknown as IAlimtalkTriggerJobRepository,
            createLogRepository() as unknown as IAlimtalkLogRepository,
        );

        await service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z"));

        expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
            10,
            new Date("2026-07-12T20:00:00+09:00"),
        );
    });
});
