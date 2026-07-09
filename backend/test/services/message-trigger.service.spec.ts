import { MessageTriggerService } from "application/services/message-trigger.service";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { TRIGGER_JOB_MAX_ATTEMPTS } from "domain/constants/message-automation-policy";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";

jest.mock("infrastructure/database/schema-capabilities", () => ({
    hasColumn: jest.fn().mockResolvedValue(true),
    hasTable: jest.fn().mockResolvedValue(true),
}));

describe("MessageTriggerService", () => {
    const branchId = "branch-1";
    type ServiceInternals = {
        hasTriggerSchema: () => Promise<boolean>;
        rebuildJobsForRule: (
            branchId: string,
            rule: MessageTriggerRuleEntity,
            includePast: boolean,
        ) => Promise<void>;
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
    };

    const createRule = (overrides: Partial<{
        id: string;
        name: string;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
    }> = {}) =>
        MessageTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            branchId,
            overrides.name ?? "기존 규칙",
            true,
            overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
        );

    const createJob = (overrides: Partial<{
        id: string;
        status: "pending" | "processing" | "sent" | "failed" | "canceled";
        attempts: number;
        nextAttemptAt: Date | null;
    }> = {}) =>
        MessageTriggerJobEntity.reconstitute(
            overrides.id ?? "job-1",
            branchId,
            "rule-1",
            overrides.status ?? "pending",
            new Date("2026-06-15T00:00:00.000Z"),
            null,
            null,
            null,
            1,
            null,
            MessageTriggerRecipientType.CLIENT,
            "010-1234-5678",
            MessageTriggerTemplateKey.CLIENT_GREETING,
            `dedupe-${overrides.id ?? "job-1"}`,
            {
                memberId: "member-1",
                recipientName: "김산모",
                recipientPhone: "010-1234-5678",
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
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            {} as never,
            messageLogRepository as never,
        );

        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        return { service, internals, ruleRepository, messageSenderApprovalService };
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
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,
            deliveryService as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        jest.spyOn(service as unknown as ServiceInternals, "hasTriggerSchema").mockResolvedValue(true);

        return {
            service,
            deliveryService,
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

    it("drops the IMMEDIATE greeting on re-sync (includePast=false) but fires it on create (includePast=true)", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        // Re-sync path (client update / due-date scheduler): greeting must be dropped.
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
