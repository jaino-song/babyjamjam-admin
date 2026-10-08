import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
} from "domain/constants/service-record-link-message";
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
import { IMessageTriggerRuleBranchOverrideRepository } from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { createAgentAutomationTaskCommitReference } from "application/agent/agent-automation-storage.schema";

describe("ServiceRecordLinkService", () => {
    /** Stand-in for the interactive transaction the repository hands its in-transaction hook. */
    const REPLACEMENT_TRANSACTION = { name: "replacement-transaction" };
    const createPrisma = () => {
        const prisma = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "claim-1",
                claim_version: "2026-07-09 00:00:00.123456+00",
            }]),
            $transaction: jest.fn(),
            employee_schedule: {
                findUnique: jest.fn(),
            },
            message_trigger_job: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
                findUnique: jest.fn().mockResolvedValue({ branchId: null, isActive: true }),
            },
            message_trigger_rule_branch_override: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            system_template: {
                findUnique: jest.fn().mockResolvedValue({ customVariables: [] }),
            },
        };
        prisma.$transaction.mockImplementation(async (work: (transaction: typeof prisma) => unknown) => (
            work(prisma)
        ));
        return prisma;
    };
    const createAutomationActivationService = () => ({
        getTriggerDispatchEnabled: jest.fn().mockResolvedValue(true),
    });
    const createBranchLock = (prisma: unknown) => ({
        runExclusive: jest.fn().mockImplementation(async (
            _branchId: string,
            work: (transaction: unknown) => Promise<unknown>,
        ) => work(prisma)),
    });
    const createTokenService = () => ({
        issueLink: jest.fn().mockResolvedValue({ linkToken: "efl_token" }),
        reuseActiveLink: jest.fn().mockResolvedValue(null),
        prepareLink: jest.fn().mockResolvedValue({ linkToken: "efl_prepared" }),
        activatePreparedLink: jest.fn().mockResolvedValue(true),
        revokeForSchedule: jest.fn().mockResolvedValue(undefined),
        extendExpiryForSchedule: jest.fn().mockResolvedValue(undefined),
    });
    const createConfigService = () => ({
        get: jest.fn((key: string, fallback?: string) => (
            key === "MOBILE_SERVICE_RECORD_BASE_URL" ? "https://mobile.test/" : fallback
        )),
    });
    const createJobRepository = () => ({
        cancelPendingByRuleAndEmployeeSchedule: jest.fn().mockResolvedValue({ canceledJobIds: [], inFlightJobIds: [] }),
        update: jest.fn(),
        promoteAutomaticSchedulingClaim: jest.fn().mockImplementation(async (
            _markerId: string,
            _expectedClaimVersion: string,
            job: MessageTriggerJobEntity,
        ) => {
            Object.defineProperty(job, "id", { value: "job-1" });
            return job;
        }),
        upsertPending: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
            Object.defineProperty(job, "id", { value: "job-1" });
            return job;
        }),
        replacePendingJobsUnlessInFlight: jest.fn().mockImplementation(async (
            job: MessageTriggerJobEntity,
            _reason: string,
            afterReplace?: (transaction: unknown) => Promise<void>,
        ) => {
            Object.defineProperty(job, "id", { value: "job-1" });
            await afterReplace?.(REPLACEMENT_TRANSACTION);
            return { kind: "replaced", job, canceledJobIds: [] };
        }),
    });
    const createLogRepository = () => ({
        save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        update: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        findRetryableServiceRecordSmsByScheduleId: jest.fn().mockResolvedValue([]),
    });
    /** Default: no branch override present, matching pre-feature behaviour (global rule always governs). */
    const createOverrideRepository = () => ({
        findOne: jest.fn().mockResolvedValue(null),
        findAllByBranch: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(async (branchId: string, ruleId: string, isActive: boolean) => (
            { branchId, ruleId, isActive }
        )),
        cancelJobsForBranchRule: jest.fn().mockResolvedValue(undefined),
    });
    const createSchedule = (overrides: Record<string, unknown> = {}) => ({
        id: 10,
        branchId: "branch-1",
        clientId: 20,
        startDate: new Date("2026-07-03T00:00:00.000Z"),
        endDate: new Date("2026-07-12T00:00:00.000Z"),
        replaced: false,
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

    it("issues a token that expires 7 days after end-date at 20:00 KST and schedules SMS for start-date 15:00 KST", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.scheduleForServiceStart(10);

        expect(tokenService.issueLink).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
            expiresAt: new Date("2026-07-19T11:00:00.000Z"),
        });
        const job = jobRepository.promoteAutomaticSchedulingClaim.mock.calls[0]?.[2] as MessageTriggerJobEntity;
        expect(job.ruleId).toBe(SERVICE_RECORD_LINK_RULE_ID);
        expect(job.dedupeKey).toBe(`${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary`);
        expect(job.templateKey).toBe(MessageTriggerTemplateKey.SERVICE_RECORD_LINK);
        expect(job.recipientType).toBe(MessageTriggerRecipientType.PRIMARY_EMPLOYEE);
        expect(job.scheduledFor).toEqual(new Date("2026-07-03T15:00:00+09:00"));
        expect(job.payload.messageBody).toContain("https://mobile.test/service-record/efl_token");
        expect(job.payload.messageBody).toContain("휴대폰 번호로 본인확인");
        expect(job.payload.templateVariables).toEqual(expect.objectContaining({
            clientName: "김산모",
            employeeName: "홍제공",
            serviceRecordUrl: "https://mobile.test/service-record/efl_token",
        }));
    });

    it("preserves the task commit reference on an automatic service-record link job", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
        const taskAutomationReference = createAgentAutomationTaskCommitReference({
            actionId: "70000000-0000-4000-8000-000000000024",
            taskId: "70000000-0000-4000-8000-000000000025",
            taskRevision: 6,
            authorities: [{
                id: "70000000-0000-4000-8000-000000000021",
                recordDigest: "c".repeat(64),
                scopeDigest: "d".repeat(64),
            }],
            coverages: [],
        });

        await service.scheduleForServiceStart(10, { taskAutomationReference });

        const job = jobRepository.promoteAutomaticSchedulingClaim.mock.calls[0]?.[2] as MessageTriggerJobEntity;
        expect(job.payload.taskAutomationReference).toEqual(taskAutomationReference);
    });

    it("sendNow grants a 24-hour late token and atomically replaces pending jobs with an immediate one", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const before = Date.now();
        const result = await service.sendNow(10);
        const after = Date.now();

        expect(tokenService.reuseActiveLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        const issuedExpiry = tokenService.issueLink.mock.calls[0]?.[0].expiresAt as Date;
        expect(issuedExpiry.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
        expect(issuedExpiry.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
        const job = jobRepository.replacePendingJobsUnlessInFlight.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.scheduledFor.getTime()).toBeGreaterThanOrEqual(before);
        expect(job.scheduledFor.getTime()).toBeLessThanOrEqual(after);
        expect(result.scheduledFor).toBe(job.scheduledFor);
        expect(result.jobId).toBe("job-1");
        expect(job.dedupeKey).toMatch(
            new RegExp(`^${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary:manual:[0-9a-f-]{36}$`),
        );
        expect(job.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_token");
    });

    it("sendNow reuses the active URL while creating a unique UUID dedupe key for each message", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.reuseActiveLink.mockResolvedValue({ linkToken: "efl_existing" });
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);
        await service.sendNow(10);

        const firstJob = jobRepository.replacePendingJobsUnlessInFlight.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        const secondJob = jobRepository.replacePendingJobsUnlessInFlight.mock.calls[1]?.[0] as MessageTriggerJobEntity;
        expect(firstJob.dedupeKey).not.toBe(secondJob.dedupeKey);
        expect(firstJob.dedupeKey).toMatch(
            new RegExp(`^${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary:manual:[0-9a-f-]{36}$`),
        );
        expect(firstJob.dedupeKey).not.toContain("efl_existing");
        expect(secondJob.dedupeKey).not.toContain("efl_existing");
        expect(firstJob.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_existing");
        expect(secondJob.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_existing");
        expect(tokenService.issueLink).not.toHaveBeenCalled();
    });

    it("keeps authentication tied to the provider when the delivery phone is overridden", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const result = await service.prepareLink(10, "010-6621-1878");

        expect(tokenService.reuseActiveLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }), { includeLocked: false });
        expect(tokenService.prepareLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(result).toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
            preparedLinkToken: "efl_prepared",
            expiresAt: expect.any(Date),
        });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
    });

    it("prepareLink returns the current active URL instead of preparing a replacement token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.reuseActiveLink.mockResolvedValue({ linkToken: "efl_existing" });
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.prepareLink(10)).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_existing",
            preparedLinkToken: "efl_existing",
            expiresAt: expect.any(Date),
        });
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
    });

    it("resetLink issues a fresh active URL without enqueueing an SMS", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.resetLink(10)).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_token",
            expiresAt: expect.any(Date),
        });

        expect(tokenService.issueLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
        expect(tokenService.activatePreparedLink).not.toHaveBeenCalled();
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).toHaveBeenCalledWith(
            SERVICE_RECORD_LINK_RULE_ID,
            10,
            "Service record link reset without resend",
        );
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).toHaveBeenCalledWith(10, undefined);
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("sendNow overrides SMS delivery while retaining the current provider verification phone", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10, "efl_prepared", "01066211878");

        expect(tokenService.activatePreparedLink).toHaveBeenCalledWith(expect.objectContaining({
            linkToken: "efl_prepared",
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        const job = jobRepository.replacePendingJobsUnlessInFlight.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.recipientPhone).toBe("01066211878");
        expect(job.payload.recipientPhone).toBe("01066211878");
        expect(job.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_prepared");
        expect(job.payload.messageBody).toContain("https://mobile.test/service-record/efl_prepared");
    });

    it("rejects an expired or mismatched prepared link instead of silently minting another URL", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.activatePreparedLink.mockResolvedValue(false);
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10, "efl_invalid")).rejects.toBeInstanceOf(BadRequestException);
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it("provisions the fixed system rule before issuing a service-record token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(prisma.system_template.findUnique).toHaveBeenCalledWith({
            where: { templateKey: "SERVICE_RECORD_LINK" },
            select: { customVariables: true },
        });
        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: {
                id: SERVICE_RECORD_LINK_RULE_ID,
                branchId: null,
                name: SERVICE_RECORD_LINK_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
        expect(prisma.message_trigger_rule.upsert.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
    });

    it("refuses to activate the fixed rule when a required template variable has no automatic source", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        prisma.system_template.findUnique.mockResolvedValue({
            customVariables: [
                { key: "reservationCode", label: "예약번호", required: true },
            ],
        });
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10)).rejects.toMatchObject({
            response: {
                unsupportedVariables: ["reservationCode"],
            },
        });

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("claims the durable automatic retry marker before issuing a token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
        const sql = prisma.$queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
        expect(sql.strings.join("?")).toContain('ON CONFLICT ("dedupe_key") DO UPDATE');
        expect(sql.strings.join("?")).toContain("WHERE NOT EXISTS");
        expect(sql.strings.join("?")).toContain("RETURNING id, updated_at::text AS claim_version");
        expect(sql.strings.join("?")).toContain("blocker.\"status\" IN ('pending', 'processing', 'dispatching', 'sent')");
        expect(sql.strings.join("?")).toContain('"canceled_by_user" = false');
    });

    it("promotes the owned automatic marker instead of generic failed-row upsert", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);

        expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledWith(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            expect.objectContaining({
                status: "pending",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                employeeScheduleId: 10,
            }),
            expect.any(Object),
        );
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("fails closed when the automatic marker is lost before promotion", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        jobRepository.promoteAutomaticSchedulingClaim.mockResolvedValue(null);
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

        expect(tokenService.issueLink).toHaveBeenCalled();
        expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledTimes(1);
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
    });

    it("does not issue another token when another instance owns the automatic claim", async () => {
        const prisma = createPrisma();
        prisma.$queryRaw.mockResolvedValue([]);
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
    });

    it("backs off the retry marker when automatic token issuance fails", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");

        expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
        const releaseSql = prisma.$executeRaw.mock.calls
            .map((call: unknown[]) => call[0] as { strings?: readonly string[] })
            .find((sql) => sql.strings?.join("?").includes("next_attempt_at"));
        expect(releaseSql).toBeDefined();
        expect(releaseSql?.strings?.join("?")).toContain('UPDATE "message_trigger_job"');
        expect(releaseSql?.strings?.join("?")).toContain("next_attempt_at");
        expect(releaseSql?.strings?.join("?")).toContain("interval '1 millisecond'");
        expect(releaseSql?.strings?.join("?")).toContain("updated_at = ?::timestamptz");
        expect(releaseSql?.strings?.join("?")).toContain("canceled_by_user = false");
    });

    describe("cancel fence: a job the dispatcher already moved to dispatching", () => {
        const IN_FLIGHT = { canceledJobIds: [], inFlightJobIds: ["dispatching-job"] };
        const build = (jobRepository: ReturnType<typeof createJobRepository>, withBranchLock = false) => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
                ...(withBranchLock
                    ? [undefined, undefined, createBranchLock(prisma) as never, createAutomationActivationService() as never] as const
                    : []),
            );
            return { service, prisma, tokenService };
        };

        it("revoke kills the token first, keeps the dispatching job and does not throw", async () => {
            const jobRepository = createJobRepository();
            jobRepository.cancelPendingByRuleAndEmployeeSchedule.mockResolvedValue(IN_FLIGHT);
            const { service, tokenService } = build(jobRepository);

            await expect(service.revoke(10)).resolves.toBeUndefined();

            expect(tokenService.revokeForSchedule.mock.invocationCallOrder[0]).toBeLessThan(
                jobRepository.cancelPendingByRuleAndEmployeeSchedule.mock.invocationCallOrder[0]!,
            );
            expect(jobRepository.update).not.toHaveBeenCalled();
        });

        it("resetLink still issues the fresh link, keeps the dispatching job and does not throw", async () => {
            const jobRepository = createJobRepository();
            jobRepository.cancelPendingByRuleAndEmployeeSchedule.mockResolvedValue(IN_FLIGHT);
            const { service, tokenService } = build(jobRepository);

            await expect(service.resetLink(10)).resolves.toEqual({
                serviceRecordUrl: "https://mobile.test/service-record/efl_token",
                expiresAt: expect.any(Date),
            });

            expect(tokenService.issueLink).toHaveBeenCalledTimes(1);
            expect(jobRepository.update).not.toHaveBeenCalled();
        });

        it("the automatic path never cancels or supersedes anything before its fenced promotion", async () => {
            const jobRepository = createJobRepository();
            const logRepository = createLogRepository();
            const prisma = createPrisma();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                createTokenService() as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                logRepository as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
                undefined,
                undefined,
                createBranchLock(prisma) as never,
                createAutomationActivationService() as never,
            );

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);

            // A pending/processing job seen here appeared after the claim, so it is
            // a newer (manual) send: cancelling it would lose it (F2).
            expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).not.toHaveBeenCalled();
            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
            expect(logRepository.update).not.toHaveBeenCalled();
            expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledTimes(1);
        });

        it("the automatic path promotes nothing and releases its claim when the fenced promotion refuses behind a newer send", async () => {
            const jobRepository = createJobRepository();
            jobRepository.promoteAutomaticSchedulingClaim.mockResolvedValue(null);
            const { service, prisma } = build(jobRepository, true);

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

            expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).not.toHaveBeenCalled();
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(jobRepository.update).not.toHaveBeenCalled();
            const releaseSql = prisma.$executeRaw.mock.calls
                .map((call: unknown[]) => call[0] as { strings?: readonly string[] })
                .find((sql) => sql.strings?.join("?").includes("next_attempt_at"));
            expect(releaseSql).toBeDefined();
        });

        it("a manual send whose replacement hit the lock timeout answers the same 409 as an in-flight job", async () => {
            const jobRepository = createJobRepository();
            jobRepository.replacePendingJobsUnlessInFlight.mockResolvedValue({ kind: "lock_timeout" });
            const logRepository = createLogRepository();
            const prisma = createPrisma();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                createTokenService() as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                logRepository as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );

            await expect(service.sendNow(10)).rejects.toBeInstanceOf(ConflictException);
            await expect(service.sendNow(10)).rejects.toMatchObject({
                response: expect.objectContaining({ code: "REQUEST_CONFLICT" }),
            });
            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
        });
    });

    it("supersedes retryable stale SMS logs once the replacement job is enqueued", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const logRepository = createLogRepository();
        const staleLog = MessageLogEntity.reconstitute(
            77,
            "branch-1",
            "aligo_sms",
            SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
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
        logRepository.findRetryableServiceRecordSmsByScheduleId.mockResolvedValue([staleLog]);
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).toHaveBeenCalledWith(10, REPLACEMENT_TRANSACTION);
        expect(staleLog.nextRetryAt).toBeNull();
        expect(staleLog.errorMessage).toBe("Service record link rescheduled");
        expect(logRepository.update).toHaveBeenCalledWith(staleLog, REPLACEMENT_TRANSACTION);
        // Superseding happens inside the replacement's transaction, after the job
        // is inserted, so a refused (in-flight) manual send leaves retryable logs
        // untouched and a failed supersession rolls the replacement back.
        expect(logRepository.update.mock.invocationCallOrder[0]).toBeGreaterThan(
            jobRepository.replacePendingJobsUnlessInFlight.mock.invocationCallOrder[0]!,
        );
    });

    describe("manual send: retry-log supersession shares the replacement transaction (F3)", () => {
        const buildSend = (jobRepository: ReturnType<typeof createJobRepository>, logRepository: ReturnType<typeof createLogRepository>) => {
            const prisma = createPrisma();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            return new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                createTokenService() as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                logRepository as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
        };
        const staleLog = () => ({ markRetrySuperseded: jest.fn() });

        it("looks up and supersedes the logs through the transaction the replacement runs in", async () => {
            const jobRepository = createJobRepository();
            const logRepository = createLogRepository();
            const log = staleLog();
            logRepository.findRetryableServiceRecordSmsByScheduleId.mockResolvedValue([log]);

            await buildSend(jobRepository, logRepository).sendNow(10);

            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).toHaveBeenCalledWith(10, REPLACEMENT_TRANSACTION);
            expect(log.markRetrySuperseded).toHaveBeenCalledWith("Service record link rescheduled");
            expect(logRepository.update).toHaveBeenCalledWith(log, REPLACEMENT_TRANSACTION);
        });

        it("a supersession failure fails the whole send inside the replacement, never after it", async () => {
            const jobRepository = createJobRepository();
            const logRepository = createLogRepository();
            logRepository.findRetryableServiceRecordSmsByScheduleId.mockResolvedValue([staleLog()]);
            logRepository.update.mockRejectedValue(new Error("log update failed"));
            // A repository that really runs the hook inside its transaction: the
            // hook's failure rolls the replacement back, so no job is committed.
            let committed = false;
            jobRepository.replacePendingJobsUnlessInFlight.mockImplementation(async (
                job: MessageTriggerJobEntity,
                _reason: string,
                afterReplace?: (transaction: unknown) => Promise<void>,
            ) => {
                await afterReplace?.(REPLACEMENT_TRANSACTION);
                committed = true;
                return { kind: "replaced", job, canceledJobIds: [] };
            });

            await expect(buildSend(jobRepository, logRepository).sendNow(10)).rejects.toThrow("log update failed");

            expect(committed).toBe(false);
            expect(jobRepository.replacePendingJobsUnlessInFlight).toHaveBeenCalledTimes(1);
            expect(logRepository.update).toHaveBeenCalledTimes(1);
        });

        it("makes no log write of its own after the replacement returns", async () => {
            const jobRepository = createJobRepository();
            const logRepository = createLogRepository();
            logRepository.findRetryableServiceRecordSmsByScheduleId.mockResolvedValue([staleLog()]);
            // Replacement that does not run the hook (e.g. nothing to supersede is
            // the repository's concern); the service must not repeat the work outside.
            jobRepository.replacePendingJobsUnlessInFlight.mockImplementation(async (job: MessageTriggerJobEntity) => {
                Object.defineProperty(job, "id", { value: "job-1" });
                return { kind: "replaced", job, canceledJobIds: [] };
            });

            await expect(buildSend(jobRepository, logRepository).sendNow(10)).resolves.toMatchObject({ jobId: "job-1" });

            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
            expect(logRepository.update).not.toHaveBeenCalled();
        });
    });

    describe("manual send in-flight fence", () => {
        const buildService = (jobRepository: ReturnType<typeof createJobRepository>, logRepository = createLogRepository()) => {
            const prisma = createPrisma();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                createTokenService() as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                logRepository as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            return { service, prisma };
        };

        it("refuses with a 409 and enqueues nothing when the dispatcher already claimed a job", async () => {
            const jobRepository = createJobRepository();
            jobRepository.replacePendingJobsUnlessInFlight.mockResolvedValue({
                kind: "in_flight",
                inFlightJobIds: ["automatic-job"],
            });
            const logRepository = createLogRepository();
            const { service } = buildService(jobRepository, logRepository);

            await expect(service.sendNow(10)).rejects.toBeInstanceOf(ConflictException);
            await expect(service.sendNow(10)).rejects.toMatchObject({
                response: expect.objectContaining({ code: "REQUEST_CONFLICT" }),
            });
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            // No unconditional pre-cancel outside the atomic repository call.
            expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).not.toHaveBeenCalled();
            expect(jobRepository.update).not.toHaveBeenCalled();
            // A refused send must not supersede retryable logs either.
            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
        });

        /**
         * Real service + real repository over a database boundary that evaluates
         * the repository's real SQL: bound values and operators decide which rows
         * a statement sees, so a selector that picks the wrong schedule or rule
         * changes the outcome (a fixed fixture would hide that).
         */
        type FakeJob = { id: string; status: string; ruleId: string; scheduleId: number };
        const OTHER_RULE_ID = "system:another_rule";
        const buildWithRealRepository = (initialRows: FakeJob[]) => {
            const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
            const statements: string[] = [];
            const lockedRules: string[] = [];
            const prisma = createPrisma();
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            const rawJobRow = (row: FakeJob) => ({
                id: row.id, branch_id: "branch-1", rule_id: row.ruleId, status: row.status,
                scheduled_for: new Date(), attempts: 0, next_attempt_at: null, sent_at: null,
                canceled_at: null, cancel_reason: null, client_id: 20, employee_schedule_id: row.scheduleId,
                recipient_type: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, recipient_phone: "01011112222",
                template_key: MessageTriggerTemplateKey.SERVICE_RECORD_LINK, dedupe_key: `manual-${row.id}`,
                payload: {}, created_at: new Date(), updated_at: new Date(), claim_token: null,
            });
            const render = (query: { text: string; values: unknown[] }) => {
                const text = query.text.replace(/\s+/g, " ");
                statements.push(text);
                return { text, values: query.values };
            };
            const comparisons = (text: string, values: unknown[]) => (
                [...text.matchAll(/\b(rule_id|employee_schedule_id|id)\s*(=|<>)\s*\$(\d+)/g)]
                    .map((match) => ({ column: match[1]!, equal: match[2] === "=", value: values[Number(match[3]) - 1] }))
            );
            const transaction = {
                $executeRaw: jest.fn().mockImplementation(async (query) => { render(query); return 1; }),
                $queryRaw: jest.fn().mockImplementation(async (query) => {
                    const { text, values } = render(query);
                    if (text.includes('FROM "message_trigger_rule"') && text.includes("FOR UPDATE")) {
                        const ruleId = comparisons(text, values).find((entry) => entry.column === "id" && entry.equal)?.value as string;
                        lockedRules.push(ruleId);
                        return ruleId === SERVICE_RECORD_LINK_RULE_ID ? [{ id: ruleId }] : [];
                    }
                    if (text.includes("FOR UPDATE")) {
                        const predicates = comparisons(text, values);
                        const statuses = /status IN \(([^)]*)\)/.exec(text)![1]!.split(",").map((status) => status.trim().replace(/'/g, ""));
                        return [...rows.values()]
                            .filter((row) => statuses.includes(row.status) && predicates.every((predicate) => (
                                ((predicate.column === "rule_id" ? row.ruleId : row.scheduleId) === predicate.value) === predicate.equal
                            )))
                            .map(({ id, status }) => ({ id, status }));
                    }
                    if (text.includes("SET status = 'canceled'")) {
                        const canceled: Array<{ id: string }> = [];
                        for (const value of values) {
                            const row = typeof value === "string" ? rows.get(value) : undefined;
                            if (row && row.status === "pending") {
                                row.status = "canceled";
                                canceled.push({ id: row.id });
                            }
                        }
                        return canceled;
                    }
                    const inserted: FakeJob = { id: "new-manual", status: "pending", ruleId: values[1] as string, scheduleId: values[4] as number };
                    rows.set(inserted.id, inserted);
                    return [rawJobRow(inserted)];
                }),
            };
            const databaseBoundary = {
                $transaction: jest.fn().mockImplementation(async (work: (tx: unknown) => unknown) => work(transaction)),
                message_trigger_job: { update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            };
            const repository = new SbMessageTriggerJobRepository(databaseBoundary as unknown as PrismaService);
            const logRepository = createLogRepository();
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                createTokenService() as never,
                createConfigService() as unknown as ConfigService,
                repository,
                logRepository as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            return { service, statements, lockedRules, rows, databaseBoundary, logRepository };
        };
        const ownJob = (id: string, status: string): FakeJob => ({ id, status, ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 10 });

        it("real repository: a job the scheduler advanced to dispatching blocks the manual send before any write", async () => {
            const { service, statements, lockedRules, rows, databaseBoundary, logRepository } = buildWithRealRepository([
                ownJob("automatic-in-flight", "dispatching"),
            ]);

            await expect(service.sendNow(10)).rejects.toBeInstanceOf(ConflictException);

            // lock_timeout, advisory lock, rule lock, job lock + read only: no cancel, no insert, no unconditional by-id update
            expect(statements).toHaveLength(4);
            expect(statements[0]).toContain("SET LOCAL lock_timeout");
            expect(statements[1]).toContain("pg_advisory_xact_lock");
            expect(statements[2]).toContain('FROM "message_trigger_rule"');
            expect(statements[3]).toContain('FROM "message_trigger_job"');
            expect(lockedRules).toEqual([SERVICE_RECORD_LINK_RULE_ID]);
            expect([...rows.keys()]).toEqual(["automatic-in-flight"]);
            expect(rows.get("automatic-in-flight")!.status).toBe("dispatching");
            expect(databaseBoundary.message_trigger_job.update).not.toHaveBeenCalled();
            expect(databaseBoundary.message_trigger_job.updateMany).not.toHaveBeenCalled();
            expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
        });

        it("real repository: only pending jobs -> cancelled and exactly one new job inserted", async () => {
            const { service, statements, rows } = buildWithRealRepository([ownJob("old-pending", "pending")]);

            const result = await service.sendNow(10);

            expect(result.jobId).toBe("new-manual");
            expect(statements.filter((text) => text.includes("INSERT INTO"))).toHaveLength(1);
            expect(statements.filter((text) => text.includes("SET status = 'canceled'"))).toHaveLength(1);
            expect(statements.findIndex((text) => text.includes("SET status = 'canceled'")))
                .toBeLessThan(statements.findIndex((text) => text.includes("INSERT INTO")));
            expect(rows.get("old-pending")!.status).toBe("canceled");
            expect([...rows.values()].filter((row) => row.status === "pending").map((row) => row.id)).toEqual(["new-manual"]);
        });

        it("real repository: another schedule's in-flight job and another rule's pending job neither block nor get cancelled", async () => {
            const { service, rows } = buildWithRealRepository([
                { id: "other-schedule-in-flight", status: "dispatching", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 11 },
                { id: "other-rule-pending", status: "pending", ruleId: OTHER_RULE_ID, scheduleId: 10 },
                ownJob("own-pending", "pending"),
            ]);

            const result = await service.sendNow(10);

            expect(result.jobId).toBe("new-manual");
            expect(rows.get("own-pending")!.status).toBe("canceled");
            expect(rows.get("other-schedule-in-flight")!.status).toBe("dispatching");
            expect(rows.get("other-rule-pending")!.status).toBe("pending");
        });

        it("real repository: this schedule's in-flight job still blocks when unrelated pending jobs exist", async () => {
            const { service, rows } = buildWithRealRepository([
                ownJob("own-in-flight", "processing"),
                { id: "other-schedule-pending", status: "pending", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 11 },
            ]);

            await expect(service.sendNow(10)).rejects.toBeInstanceOf(ConflictException);

            expect(rows.get("other-schedule-pending")!.status).toBe("pending");
            expect(rows.size).toBe(2);
        });

        it("hands the repository the whole replacement so cancel and enqueue are one atomic step", async () => {
            const jobRepository = createJobRepository();
            const { service } = buildService(jobRepository);

            const result = await service.sendNow(10);

            expect(result.jobId).toBe("job-1");
            expect(jobRepository.replacePendingJobsUnlessInFlight).toHaveBeenCalledTimes(1);
            const [job, reason] = jobRepository.replacePendingJobsUnlessInFlight.mock.calls[0] as [MessageTriggerJobEntity, string];
            expect(job.employeeScheduleId).toBe(10);
            expect(job.ruleId).toBe(SERVICE_RECORD_LINK_RULE_ID);
            expect(job.status).toBe("pending");
            expect(reason).toBe(SERVICE_RECORD_LINK_RESCHEDULED_REASON);
            expect(jobRepository.update).not.toHaveBeenCalled();
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        });
    });

    it("records a failed history row when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
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
        expect(savedLog.templateKey).toBe(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
        expect(savedLog.status).toBe("failed");
        expect(savedLog.nextRetryAt).toBeNull();
        expect(savedLog.errorMessage).toBe("제공인력 전화번호 누락");
    });

    it("sendNow throws and does not write a permanent failure log when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
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

    it("reports missing registered authentication phone even when delivery is overridden", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService, tokenService as never, createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({ primaryEmployee: { id: 30, name: "홍제공", phone: "", birthday: "900101" } }));
        await expect(service.prepareLink(10, "01066211878")).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.prepareLink(10, "01066211878")).rejects.toMatchObject({ response: { code: "INVALID_PROVIDER_PHONE" } });
        await expect(service.sendNow(10, undefined, "01066211878")).rejects.toBeInstanceOf(BadRequestException);
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
    });

    it("rejects an invalid manual recipient phone instead of falling back to the stored phone", async () => {
        const prisma = createPrisma();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10, undefined, "010-12")).rejects.toBeInstanceOf(
            BadRequestException,
        );

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("rejects resend for a replaced provider assignment", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({ replaced: true }));

        await expect(service.sendNow(10)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.prepareLink(10)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.prepareLink(10)).rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("surfaces scheduling errors so the caller can arrange a retry", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
            undefined,
            undefined,
            createBranchLock(prisma) as never,
            createAutomationActivationService() as never,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");
    });

    it("extends an existing token to 7 days after end-date at 20:00 KST", async () => {
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z"));

        expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
            10,
            new Date("2026-07-19T11:00:00.000Z"),
        );
    });

    it("revokes an existing token and pending jobs", async () => {
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await service.revoke(10);

        expect(tokenService.revokeForSchedule).toHaveBeenCalledWith(10);
        expect(jobRepository.cancelPendingByRuleAndEmployeeSchedule).toHaveBeenCalledWith(
            SERVICE_RECORD_LINK_RULE_ID,
            10,
            "Service record access revoked",
        );
    });

    it("rethrows token revocation failures", async () => {
        const tokenService = createTokenService();
        const error = new Error("token revoke failed");
        tokenService.revokeForSchedule.mockRejectedValue(error);
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await expect(service.revoke(10)).rejects.toBe(error);
    });

    it("rethrows token expiry extension failures", async () => {
        const tokenService = createTokenService();
        const error = new Error("token extension failed");
        tokenService.extendExpiryForSchedule.mockRejectedValue(error);
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await expect(
            service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z")),
        ).rejects.toBe(error);
    });

    describe("branch activation override gate", () => {
        it("blocks the automatic scheduling path the repair sweep calls (service-record-link-reconciliation.service.ts:196) when the branch has opted out", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
                undefined,
                undefined,
                createBranchLock(prisma) as never,
                createAutomationActivationService() as never,
            );
            prisma.message_trigger_rule_branch_override.findUnique.mockImplementation(() => overrideRepository.findOne("branch-1", SERVICE_RECORD_LINK_RULE_ID));
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

            expect(prisma.$queryRaw).not.toHaveBeenCalled();
            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(tokenService.issueLink).not.toHaveBeenCalled();
        });

        it("opting back in after an opt-out lets a later automatic trigger enqueue a job again, and keeps the disabled-branch cancel reason registered in both raw-SQL allow-lists that guard against a permanent blocker", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
                undefined,
                undefined,
                createBranchLock(prisma) as never,
                createAutomationActivationService() as never,
            );
            prisma.message_trigger_rule_branch_override.findUnique.mockImplementation(() => overrideRepository.findOne("branch-1", SERVICE_RECORD_LINK_RULE_ID));
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            // 1. Opted out: no job enqueued.
            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);
            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();

            // 2. Opt back in.
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: true,
            });

            // 3. A legitimate later trigger must be able to enqueue again.
            await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);
            expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledTimes(1);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

            // claimAutomaticScheduling's raw SQL hardcodes the branch-disabled reason in two
            // allow-lists: the `WHERE NOT EXISTS ... blocker` clause and the
            // `ON CONFLICT ... DO UPDATE ... WHERE` reclaim clause. If a future edit drops the
            // reason from either, a branch-disabled cancellation becomes a permanent blocker —
            // that schedule/rule pair could never be scheduled again, silently. Guard both.
            const sql = prisma.$queryRaw.mock.calls[0]?.[0] as { values: readonly unknown[] };
            const occurrences = sql.values.filter(
                (value) => value === SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
            );
            expect(occurrences).toHaveLength(2);
        });

        it("still allows a manual send for an opted-out branch (manual sends bypass the automatic-scheduling gate entirely)", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            const result = await service.sendNow(10);

            expect(result.jobId).toBe("job-1");
            expect(jobRepository.replacePendingJobsUnlessInFlight).toHaveBeenCalledTimes(1);
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(overrideRepository.findOne).not.toHaveBeenCalled();
        });

        it("a global kill switch (rule.isActive: false) still blocks automatic scheduling even when the branch override is isActive: true", async () => {
            const prisma = createPrisma();
            // No admin endpoint can produce this state directly on the fixed system rule; seed it
            // at the prisma/repository level, as only an operator touching the DB directly could.
            prisma.message_trigger_rule.findUnique.mockResolvedValue({ isActive: false });
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: true,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
                undefined,
                undefined,
                createBranchLock(prisma) as never,
                createAutomationActivationService() as never,
            );
            prisma.message_trigger_rule_branch_override.findUnique.mockImplementation(() => overrideRepository.findOne("branch-1", SERVICE_RECORD_LINK_RULE_ID));
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it("fails closed when an automatic claim has a branch lock but no activation fence", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const branchLock = {
                runExclusive: jest.fn(async (
                    _branchId: string,
                    work: (transaction: typeof prisma) => Promise<unknown>,
                ) => work(prisma)),
            };
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
                undefined,
                undefined,
                branchLock as never,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            await expect(service.scheduleForServiceStart(10)).rejects.toBeInstanceOf(ServiceUnavailableException);

            expect(prisma.$queryRaw).not.toHaveBeenCalled();
            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(tokenService.issueLink).not.toHaveBeenCalled();
        });
    });
});
