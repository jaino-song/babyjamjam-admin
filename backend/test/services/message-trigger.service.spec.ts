import { Prisma } from "@prisma/client";
import { MessageTriggerService } from "application/services/message-trigger.service";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    PAST_OCCURRENCE_GRACE_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
} from "domain/constants/message-automation-policy";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";

jest.mock("infrastructure/database/schema-capabilities", () => ({
    hasColumn: jest.fn().mockResolvedValue(true),
    hasTable: jest.fn().mockResolvedValue(true),
}));

describe("MessageTriggerService", () => {
    const branchId = "branch-1";
    type EmployeeAssignmentScheduleSource = {
        id: number;
        clientId: number;
        startDate: Date;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        client: { id: number; name: string };
        primaryEmployee: { id: number; name: string; phone: string } | null;
        secondaryEmployee: { id: number; name: string; phone: string } | null;
    };

    type ServiceInternals = {
        hasTriggerSchema: () => Promise<boolean>;
        rebuildJobsForRule: (
            branchId: string | null,
            rule: MessageTriggerRuleEntity,
            includePast: boolean,
        ) => Promise<void>;
        recoverApprovedBranches: () => Promise<void>;
        processStaleRuleRebuilds: () => Promise<void>;
        buildClientTemplateVariables: (
            rule: MessageTriggerRuleEntity,
            client: {
                name: string;
                phone: string | null;
                type?: string | null;
                startDate?: Date | null;
                endDate?: Date | null;
                createdAt?: Date | null;
                duration?: number | null;
                fullPrice?: string | null;
                grant?: string | null;
                actualPrice?: string | null;
                area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
            },
        ) => Record<string, string>;
        buildEmployeeAssignmentJob: (
            rule: MessageTriggerRuleEntity,
            schedule: EmployeeAssignmentScheduleSource,
        ) => MessageTriggerJobEntity | null;
    };

    const createRule = (overrides: Partial<{
        id: string;
        name: string;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        isActive: boolean;
        branchId: string | null;
        isDefault: boolean;
        jobsStale: boolean;
        createdAt: Date;
        updatedAt: Date;
    }> = {}) =>
        MessageTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            overrides.branchId ?? branchId,
            overrides.name ?? "기존 규칙",
            overrides.isActive ?? true,
            overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
            overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.isDefault ?? false,
            overrides.jobsStale ?? false,
        );

    const createJob = (overrides: Partial<{
        id: string;
        ruleId: string;
        status: "pending" | "processing" | "sent" | "failed" | "canceled";
        scheduledFor: Date;
        clientId: number | null;
        employeeScheduleId: number | null;
        recipientType: MessageTriggerRecipientType;
        recipientPhone: string | null;
        templateKey: MessageTriggerTemplateKey;
        dedupeKey: string;
        payload: MessageTriggerJobEntity["payload"];
        attempts: number;
        nextAttemptAt: Date | null;
    }> = {}) =>
        MessageTriggerJobEntity.reconstitute(
            overrides.id ?? "job-1",
            branchId,
            overrides.ruleId ?? "rule-1",
            overrides.status ?? "pending",
            overrides.scheduledFor ?? new Date("2026-06-15T00:00:00.000Z"),
            null,
            null,
            null,
            overrides.clientId ?? 1,
            overrides.employeeScheduleId ?? null,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.recipientPhone ?? "010-1234-5678",
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_GREETING,
            overrides.dedupeKey ?? `dedupe-${overrides.id ?? "job-1"}`,
            overrides.payload ?? {
                memberId: "member-1",
                recipientName: "김산모",
                recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
                templateVariables: {},
            },
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
            overrides.attempts ?? 0,
            overrides.nextAttemptAt ?? null,
        );

    const createMessageLogRepository = () => ({
        findSentTriggerJobIds: jest.fn<Promise<Set<string>>, [string[]]>().mockResolvedValue(
            new Set<string>(),
        ),
        findRecentByBranch: jest.fn(),
    });

    const createMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
        isApproved: jest.fn().mockResolvedValue(true),
        getApprovedBranchIds: jest
            .fn<Promise<Set<string>>, [string[]]>()
            .mockImplementation(async (branchIds) => new Set(branchIds)),
    });

    const createService = () => {
        const ruleRepository = {
            findAll: jest.fn(),
            findById: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const jobRepository = {
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        return { service, internals, ruleRepository, jobRepository, messageSenderApprovalService };
    };

    const createDispatchService = () => {
        const deliveryService = {
            sendJob: jest.fn().mockResolvedValue(true),
        };
        const jobRepository = {
            findDuePending: jest.fn().mockResolvedValue([]),
            findStaleProcessing: jest.fn().mockResolvedValue([]),
            claimPending: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockResolvedValue(undefined),
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
        };
        const ruleRepository = {
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,
            deliveryService as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        jest.spyOn(service as unknown as ServiceInternals, "hasTriggerSchema").mockResolvedValue(true);

        return {
            service,
            deliveryService,
            ruleRepository,
            jobRepository,
            messageLogRepository,
            messageSenderApprovalService,
        };
    };

    it("ensures the default service information trigger on rule listing", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const createdServiceInfo = createRule({
            id: "rule-service-info",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // CLIENT_GREETING already exists; only SERVICE_INFO will be created
        ruleRepository.findAll.mockResolvedValue([existingGreeting]);
        ruleRepository.create.mockResolvedValue(createdServiceInfo);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "서비스 시작 7일 전 서비스 안내",
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            }),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(branchId, createdServiceInfo, false);
        expect(rules).toContainEqual(createdServiceInfo);
        expect(rules).toContainEqual(existingGreeting);
    });

    it("ensures the default CLIENT_GREETING trigger on rule listing", async () => {
        const { service, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const createdGreeting = createRule({
            id: "rule-greeting",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        // SERVICE_INFO already exists; only CLIENT_GREETING will be created
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo]);
        ruleRepository.create.mockResolvedValue(createdGreeting);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "신규 고객 인사 메시지",
                isActive: true,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            }),
        );
        expect(rules).toContainEqual(createdGreeting);
        expect(rules).toContainEqual(existingServiceInfo);
    });

    it("does not duplicate existing default triggers when both already exist", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreeting]);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([existingServiceInfo, existingGreeting]);
    });

    it("does not provision default rules for an unapproved branch", async () => {
        const { service, internals, ruleRepository, messageSenderApprovalService } = createService();
        const existingRule = createRule({
            id: "rule-existing",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        ruleRepository.findAll.mockResolvedValue([existingRule]);
        messageSenderApprovalService.isApproved.mockResolvedValue(false);

        const rules = await service.listRules(branchId);

        expect(messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([existingRule]);
    });

    it("createRule returns without rebuilding jobs and marks the rule stale", async () => {
        const { service, internals, ruleRepository, jobRepository } = createService();
        const createdRule = createRule({
            id: "rule-created",
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.create.mockResolvedValue(createdRule);

        const result = await service.createRule(branchId, {
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        expect(result).toBe(createdRule);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(createdRule.id);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalled();
    });

    it("updateRule batch-cancels pending jobs and marks stale without rebuilding in-request", async () => {
        const { service, internals, ruleRepository, jobRepository } = createService();
        const existingRule = createRule({
            id: "rule-updated",
            name: "기존 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const updatedRule = createRule({
            id: existingRule.id,
            name: "수정된 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findById.mockResolvedValue(existingRule);
        ruleRepository.update.mockResolvedValue(updatedRule);

        const result = await service.updateRule(branchId, existingRule.id, {
            name: "수정된 규칙",
        });

        expect(result).toBe(updatedRule);
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(
            existingRule.id,
            "Rule updated",
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(existingRule.id);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("reactivates cleanup-deactivated default rules once their branch is approved and marks them stale", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const inactiveDefault = createRule({
            id: "rule-default-approved",
            isActive: false,
            isDefault: true,
            branchId,
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
        ruleRepository.update.mockResolvedValue(inactiveDefault);

        await internals.recoverApprovedBranches();

        expect(ruleRepository.findInactiveDefaultRules).toHaveBeenCalledWith(50);
        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(inactiveDefault.isActive).toBe(true);
        expect(ruleRepository.update).toHaveBeenCalledWith(branchId, inactiveDefault);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(inactiveDefault.id);
    });

    it("leaves inactive default rules of unapproved branches untouched", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const inactiveDefault = createRule({
            id: "rule-default-unapproved",
            isActive: false,
            isDefault: true,
            branchId,
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set());

        await internals.recoverApprovedBranches();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        expect(inactiveDefault.isActive).toBe(false);
    });

    it("does not enqueue jobs for existing clients when an IMMEDIATE CLIENT_GREETING rule is created", async () => {
        // Do NOT spy on rebuildJobsForRule — let the real guard run.
        const jobRepository = { upsertPending: jest.fn() };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,  // prisma — should not be reached past the IMMEDIATE guard
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        const greetingRule = createRule({
            id: "rule-greeting-new",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        // Call the private method directly — IMMEDIATE guard must return before touching DB
        await (service as unknown as ServiceInternals).rebuildJobsForRule(branchId, greetingRule, false);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("skips a job whose claim was lost to another instance", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        jobRepository.claimPending.mockResolvedValue(false);

        await service.dispatchDueJobs();

        expect(jobRepository.claimPending).toHaveBeenCalledWith(job.id);
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it("marks a job sent without calling the provider when a sent message_log exists", async () => {
        const { service, deliveryService, jobRepository, messageLogRepository } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageLogRepository.findSentTriggerJobIds.mockResolvedValue(new Set([job.id]));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch cancels a claimed job whose branch is unapproved without calling the provider", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set());

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(jobRepository.claimPending).toHaveBeenCalledWith(job.id);
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("메시지 발송 승인 필요");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch sends normally for approved branches", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("defers with kind config without incrementing attempts", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 2 });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(
            new TriggerJobDeferredError("config", "Missing sender approval"),
        );

        await service.dispatchDueJobs();

        expect(job.status).toBe("pending");
        expect(job.attempts).toBe(2);
        expect(job.nextAttemptAt).toBeInstanceOf(Date);
    });

    it("terminal-fails after TRIGGER_JOB_MAX_ATTEMPTS transient defers", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: TRIGGER_JOB_MAX_ATTEMPTS - 1 });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(
            new TriggerJobDeferredError("transient", "Provider timeout"),
        );

        await service.dispatchDueJobs();

        expect(job.status).toBe("failed");
        expect(job.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(job.cancelReason).toBe("Provider timeout");
    });

    it("defers transiently when the delivery path throws a transient Prisma connectivity error", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 0 });
        const prismaError = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
            code: "P1001",
            clientVersion: "test",
        });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(prismaError);

        await service.dispatchDueJobs();

        expect(job.status).toBe("pending");
        expect(job.attempts).toBe(1);
        expect(job.nextAttemptAt).toBeInstanceOf(Date);
        expect(job.cancelReason).toBeNull();
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("reclaim marks stale processing job sent when a sent log exists; re-queues pending otherwise", async () => {
        const { service, jobRepository, messageLogRepository } = createDispatchService();
        const deliveredJob = createJob({ id: "job-delivered", status: "processing" });
        const unsentJob = createJob({ id: "job-unsent", status: "processing" });
        jobRepository.findStaleProcessing.mockResolvedValue([deliveredJob, unsentJob]);
        messageLogRepository.findSentTriggerJobIds.mockResolvedValue(new Set([deliveredJob.id]));

        await service.dispatchDueJobs();

        expect(deliveredJob.status).toBe("sent");
        expect(unsentJob.status).toBe("pending");
        expect(unsentJob.attempts).toBe(1);
        expect(unsentJob.nextAttemptAt).toBeInstanceOf(Date);
        expect(jobRepository.update).toHaveBeenCalledTimes(2);
    });

    it("an externally approved branch recovers via the scheduler tick without any page load", async () => {
        const { service, ruleRepository, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const inactiveDefault = createRule({
            id: "rule-default-approved-by-admin",
            isActive: false,
            isDefault: true,
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-07-08T00:00:00.000Z"),
        });
        const order: string[] = [];
        jobRepository.findStaleProcessing.mockImplementation(async () => {
            order.push("reclaim");
            return [];
        });
        jobRepository.findDuePending.mockImplementation(async () => {
            order.push("due");
            return [];
        });
        ruleRepository.findInactiveDefaultRules.mockImplementation(async () => {
            order.push("recover");
            return [inactiveDefault];
        });
        ruleRepository.findStaleRules.mockImplementation(async () => {
            order.push("stale");
            return [inactiveDefault];
        });
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
        ruleRepository.update.mockResolvedValue(inactiveDefault);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await service.dispatchDueJobs();

        expect(order).toEqual(["reclaim", "due", "recover", "stale"]);
        expect(ruleRepository.update).toHaveBeenCalledWith(branchId, inactiveDefault);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(inactiveDefault.id);
        expect(rebuildSpy).toHaveBeenCalledWith(inactiveDefault.branchId, inactiveDefault, false);
    });

    it("a failing per-job status write does not abort the rest of the batch", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const firstJob = createJob({ id: "job-first" });
        const secondJob = createJob({ id: "job-second" });
        const logger = (service as unknown as {
            logger: { error: (message: string, stack?: string) => void };
        }).logger;
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
        jobRepository.findDuePending.mockResolvedValue([firstJob, secondJob]);
        jobRepository.update.mockRejectedValueOnce(new Error("write failed"));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).toHaveBeenCalledTimes(2);
        expect(firstJob.status).toBe("sent");
        expect(secondJob.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledTimes(2);
    });

    it("processStaleRuleRebuilds rebuilds an active stale rule and clears the flag when unchanged", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-active",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(ruleRepository.findStaleRules).toHaveBeenCalledWith(10);
        expect(rebuildSpy).toHaveBeenCalledWith(staleRule.branchId, staleRule, false);
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
        );
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalled();
    });

    it("post-rebuild cancel drops pending jobs scheduled more than 24h in the past", async () => {
        const now = new Date("2026-07-09T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        try {
            const { service, ruleRepository, jobRepository } = createDispatchService();
            const staleRule = createRule({
                id: "rule-stale-past-cleanup",
                jobsStale: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                updatedAt: new Date("2026-07-08T00:00:00.000Z"),
            });
            ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
            const internals = service as unknown as ServiceInternals;
            jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

            await internals.processStaleRuleRebuilds();

            expect(jobRepository.cancelPendingOlderThan).toHaveBeenCalledWith(
                staleRule.id,
                new Date(now.getTime() - PAST_OCCURRENCE_GRACE_MS),
                "승인 전 예정 시각 경과",
            );
            expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
                staleRule.id,
                staleRule.updatedAt,
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("processStaleRuleRebuilds leaves the flag set when the rule changed mid-rebuild", async () => {
        const { service, ruleRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-changed",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-03T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
        ruleRepository.clearJobsStaleIfUnchanged.mockResolvedValue(false);
        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
        );
    });

    it("processStaleRuleRebuilds re-cancels pending jobs for a deactivated stale rule", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const inactiveRule = createRule({
            id: "rule-stale-inactive",
            isActive: false,
            jobsStale: true,
            updatedAt: new Date("2026-06-04T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([inactiveRule]);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(
            inactiveRule.id,
            "Rule deactivated",
        );
        expect(rebuildSpy).not.toHaveBeenCalled();
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            inactiveRule.id,
            inactiveRule.updatedAt,
        );
    });

    it("a throwing rebuild for one stale rule does not block the others", async () => {
        const { service, ruleRepository } = createDispatchService();
        const firstRule = createRule({
            id: "rule-stale-first",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-05T00:00:00.000Z"),
        });
        const secondRule = createRule({
            id: "rule-stale-second",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-06T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([firstRule, secondRule]);
        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "rebuildJobsForRule")
            .mockRejectedValueOnce(new Error("rebuild failed"))
            .mockResolvedValueOnce(undefined);
        const logger = (service as unknown as {
            logger: { error: (message: string, stack?: string) => void };
        }).logger;
        jest.spyOn(logger, "error").mockImplementation(() => undefined);

        await internals.processStaleRuleRebuilds();

        expect(internals.rebuildJobsForRule).toHaveBeenCalledTimes(2);
        expect(ruleRepository.clearJobsStaleIfUnchanged).not.toHaveBeenCalledWith(
            firstRule.id,
            firstRule.updatedAt,
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            secondRule.id,
            secondRule.updatedAt,
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(firstRule.id),
            expect.any(String),
        );
    });

    it("maps the service information name variable from the client name", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김지니",
            phone: "010-1234-5678",
            type: "A가1형",
            startDate: new Date("2026-06-12T00:00:00.000Z"),
            endDate: null,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김지니",
            clientName: "김지니",
            phone: "010-1234-5678",
        });
    });

    it("maps CLIENT_GREETING template variables from the client", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김산모",
            phone: "010-9999-0000",
            type: null,
            startDate: null,
            endDate: null,
            createdAt: new Date("2026-06-27T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김산모",
            clientName: "김산모",
            phone: "010-9999-0000",
        });
    });

    it("maps PRICE_INFO template variables including price/bank fields (data-minimization scoping)", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.PRICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "이고객",
            phone: "010-5555-6666",
            type: "B형",
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: null,
            createdAt: null,
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            area: { bankAccountInfo: { bankName: "신한은행", accNum: "110-123-456789" } },
        });

        expect(variables).toEqual({
            name: "이고객",
            clientName: "이고객",
            phone: "010-5555-6666",
            weeks: "0",
            duration: "",
            type: "B형",
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            bankName: "신한은행",
            accNum: "110-123-456789",
        });
    });

    const createSyncService = (clientOverrides: Partial<{
        id: number;
        name: string;
        phone: string | null;
        type: string | null;
        startDate: Date | null;
        endDate: Date | null;
        createdAt: Date | null;
    }> = {}) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            findPendingByRuleIdsAndClientId: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            client: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 1,
                    name: "김산모",
                    phone: "010-1234-5678",
                    type: null,
                    startDate: null,
                    endDate: null,
                    createdAt: new Date("2026-06-27T00:00:00.000Z"),
                    ...clientOverrides,
                }),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
        };
    };

    const createEmployeeSchedule = (
        overrides: Partial<EmployeeAssignmentScheduleSource> = {},
    ): EmployeeAssignmentScheduleSource => ({
        id: 77,
        clientId: 1,
        startDate: new Date("2026-07-15T00:00:00.000Z"),
        primaryEmployeeId: 30,
        secondaryEmployeeId: null,
        client: { id: 1, name: "김산모" },
        primaryEmployee: { id: 30, name: "홍제공", phone: "010-1111-2222" },
        secondaryEmployee: null,
        ...overrides,
    });

    const createEmployeeSyncService = (
        scheduleOverrides: Partial<EmployeeAssignmentScheduleSource> = {},
    ) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            findPendingByRuleIdsAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            findSentByRuleIdAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(createEmployeeSchedule(scheduleOverrides)),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
        };
    };

    it("syncClientRulesForClient is a no-op for an unapproved branch", async () => {
        const sync = createSyncService();
        sync.messageSenderApprovalService.isApproved.mockResolvedValue(false);

        await sync.service.syncClientRulesForClient(branchId, 1, true);

        expect(sync.messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(sync.prisma.client.findFirst).not.toHaveBeenCalled();
        expect(sync.ruleRepository.findActiveByEventTypes).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("rebuildJobsForRule is a no-op for an unapproved branch", async () => {
        const prisma = {
            client: {
                findMany: jest.fn(),
            },
        };
        const jobRepository = { upsertPending: jest.fn() };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        messageSenderApprovalService.isApproved.mockResolvedValue(false);
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            createMessageLogRepository() as never,
        );
        const serviceInfoRule = createRule({
            id: "rule-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });

        await (service as unknown as ServiceInternals).rebuildJobsForRule(
            branchId,
            serviceInfoRule,
            false,
        );

        expect(messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(prisma.client.findMany).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("does not enqueue a new IMMEDIATE greeting on re-sync (includePast=false) but fires it on create (includePast=true)", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        // Re-sync path (client update / due-date scheduler): no new greeting job is created.
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await reSync.service.syncClientRulesForClient(branchId, 1, false);
        expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();

        // Create path: greeting must fire exactly once.
        const create = createSyncService();
        create.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await create.service.syncClientRulesForClient(branchId, 1, true);
        expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
    });

    it("keeps the still-pending IMMEDIATE greeting alive on an includePast=false resync", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
        });
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([pendingGreeting]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenCalledWith(
            [greetingRule.id],
            1,
        );
        expect(pendingGreeting.status).toBe("pending");
        expect(pendingGreeting.canceledAt).toBeNull();
        expect(pendingGreeting.cancelReason).toBeNull();
        expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("refreshes the pending IMMEDIATE job's recipient phone and payload from the edited client", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const scheduledFor = new Date("2026-06-27T00:00:00.000Z");
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
            scheduledFor,
            recipientPhone: "010-0000-0000",
            payload: {
                memberId: "1",
                recipientName: "김산모",
                recipientPhone: "010-0000-0000",
                templateVariables: {
                    name: "김산모",
                    clientName: "김산모",
                    phone: "010-0000-0000",
                },
            },
        });
        const reSync = createSyncService({
            name: "김수정",
            phone: "010-9999-0000",
        });
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([pendingGreeting]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.update).toHaveBeenCalledWith(pendingGreeting);
        expect(pendingGreeting.recipientPhone).toBe("010-9999-0000");
        expect(pendingGreeting.payload).toMatchObject({
            clientId: 1,
            clientName: "김수정",
            memberId: "1",
            recipientName: "김수정",
            recipientPhone: "010-9999-0000",
            templateVariables: {
                name: "김수정",
                clientName: "김수정",
                phone: "010-9999-0000",
            },
        });
        expect(pendingGreeting.status).toBe("pending");
        expect(pendingGreeting.scheduledFor).toBe(scheduledFor);
        expect(pendingGreeting.dedupeKey).toBe("dedupe-job-greeting-pending");
        expect(pendingGreeting.attempts).toBe(0);
    });

    it("still cancels and rebuilds non-IMMEDIATE jobs on the same resync", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const serviceInfoRule = createRule({
            id: "rule-service-info-active",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
        });
        const pendingServiceInfo = createJob({
            id: "job-service-info-pending",
            ruleId: serviceInfoRule.id,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const reSync = createSyncService({
            startDate: new Date("2026-07-15T00:00:00.000Z"),
        });
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([
            greetingRule,
            serviceInfoRule,
        ]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockImplementation(
            async (ruleIds: string[]) => {
                if (ruleIds.includes(serviceInfoRule.id)) return [pendingServiceInfo];
                if (ruleIds.includes(greetingRule.id)) return [pendingGreeting];
                return [];
            },
        );

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenNthCalledWith(
            1,
            [serviceInfoRule.id],
            1,
        );
        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenNthCalledWith(
            2,
            [greetingRule.id],
            1,
        );
        expect(pendingServiceInfo.status).toBe("canceled");
        expect(pendingServiceInfo.cancelReason).toBe("Client data changed");
        expect(pendingGreeting.status).toBe("pending");
        expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
        expect(reSync.jobRepository.upsertPending.mock.calls[0][0]).toMatchObject({
            ruleId: serviceInfoRule.id,
            status: "pending",
            clientId: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
    });

    it("persists overdue non-immediate client jobs on re-sync so missed automations can run", async () => {
        const serviceInfoRule = createRule({
            id: "rule-service-info-active",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const reSync = createSyncService({
            startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        });
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
        const persistedJob = reSync.jobRepository.upsertPending.mock.calls[0][0];
        expect(persistedJob.scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("re-approving a schedule change for the same employee does not create a second assignment job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-assigned",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sentOldFormatJob = createJob({
            id: "job-sent-old-format",
            ruleId: employeeRule.id,
            status: "sent",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            dedupeKey: "rule-employee-assigned:schedule:77:PRIMARY_EMPLOYEE:2026-07-09T00:00:00.000Z",
            payload: {
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {},
            },
        });
        const sync = createEmployeeSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId.mockResolvedValue([sentOldFormatJob]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId).toHaveBeenCalledWith(
            employeeRule.id,
            77,
        );
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("re-assignment to a new employee creates a new assignment job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-assigned",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sentOldEmployeeJob = createJob({
            id: "job-sent-old-employee",
            ruleId: employeeRule.id,
            status: "sent",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            dedupeKey: "rule-employee-assigned:schedule:77:PRIMARY_EMPLOYEE:2026-07-09T00:00:00.000Z",
            payload: {
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {},
            },
        });
        const sync = createEmployeeSyncService({
            primaryEmployeeId: 31,
            primaryEmployee: { id: 31, name: "박신규", phone: "010-2222-3333" },
        });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId.mockResolvedValue([sentOldEmployeeJob]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(sync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
        const persistedJob = sync.jobRepository.upsertPending.mock.calls[0][0];
        expect(persistedJob.dedupeKey).toBe(
            "rule-employee-assigned:schedule:77:employee:31:PRIMARY_EMPLOYEE",
        );
        expect(persistedJob.payload.employeeId).toBe(31);
        expect(persistedJob.recipientPhone).toBe("010-2222-3333");
    });

    it("assignment dedupe key is deterministic for the same rule/schedule/employee/recipient", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const { internals } = createService();
            const employeeRule = createRule({
                id: "rule-employee-assigned",
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            });
            const schedule = createEmployeeSchedule();

            const firstJob = internals.buildEmployeeAssignmentJob(employeeRule, schedule);
            jest.setSystemTime(new Date("2026-07-09T00:05:00.000Z"));
            const secondJob = internals.buildEmployeeAssignmentJob(employeeRule, schedule);

            expect(firstJob?.dedupeKey).toBe(secondJob?.dedupeKey);
            expect(firstJob?.dedupeKey).toBe(
                "rule-employee-assigned:schedule:77:employee:30:PRIMARY_EMPLOYEE",
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not re-create the CLIENT_GREETING default when a non-default (AFTER_DAYS) greeting rule already exists", async () => {
        const { service, ruleRepository, internals } = createService();

        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // Admin-created greeting rule with a NON-default offset (AFTER_DAYS, not IMMEDIATE).
        const existingGreetingAfterDays = createRule({
            id: "rule-greeting-after-days",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.AFTER_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreetingAfterDays]);

        await service.listRules(branchId);

        // The IMMEDIATE greeting default must NOT be auto-created — that would yield two
        // active greeting rules and double-greet every new client.
        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("does not re-create the SERVICE_INFO default after the default rule was edited", async () => {
        const { service, ruleRepository, internals } = createService();

        const editedServiceInfo = createRule({
            id: "rule-service-info-edited",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([editedServiceInfo, existingGreeting]);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([editedServiceInfo, existingGreeting]);
    });

    it("provisioning race: P2002 on create resolves to the existing default instead of throwing", async () => {
        const { service, ruleRepository, internals } = createService();
        const existingServiceInfo = createRule({
            id: "rule-service-info-winner",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
        });
        ruleRepository.findAll
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([existingServiceInfo, existingGreeting]);
        ruleRepository.create.mockRejectedValueOnce(p2002);

        await expect(service.listRules(branchId)).resolves.toEqual([
            existingServiceInfo,
            existingGreeting,
        ]);
        expect(ruleRepository.create).toHaveBeenCalledTimes(1);
        expect(ruleRepository.findAll).toHaveBeenCalledTimes(2);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("provisioned defaults are created with isDefault true", async () => {
        const { service, ruleRepository } = createService();
        const createdServiceInfo = createRule({
            id: "rule-service-info-new",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const createdGreeting = createRule({
            id: "rule-greeting-new",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([]);
        ruleRepository.create
            .mockResolvedValueOnce(createdServiceInfo)
            .mockResolvedValueOnce(createdGreeting);

        await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenNthCalledWith(
            1,
            branchId,
            expect.objectContaining({
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                isDefault: true,
            }),
        );
        expect(ruleRepository.create).toHaveBeenNthCalledWith(
            2,
            branchId,
            expect.objectContaining({
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: true,
            }),
        );
    });

    it("ensureDefaultRulesForBranch creates missing default rules (same logic as listRules)", async () => {
        const { service, internals, ruleRepository } = createService();
        const createdGreeting = createRule({
            id: "rule-greeting-new",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const createdServiceInfo = createRule({
            id: "rule-service-info-new",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // No rules exist yet — both defaults must be created
        ruleRepository.findAll.mockResolvedValue([]);
        ruleRepository.create
            .mockResolvedValueOnce(createdServiceInfo)
            .mockResolvedValueOnce(createdGreeting);

        await service.ensureDefaultRulesForBranch(branchId);

        expect(ruleRepository.findAll).toHaveBeenCalledWith(branchId);
        expect(ruleRepository.create).toHaveBeenCalledTimes(2);
        expect(internals.rebuildJobsForRule).toHaveBeenCalledTimes(2);
    });
});
