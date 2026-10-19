import { AgentAutomationDispatchUncertainError } from "../../domain/errors/agent-automation-dispatch-uncertain.error";
import { createLegacyAutomationDeliveryGate } from "../fixtures/legacy-automation-delivery-gate";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, buildClientTemplateVariables, buildMessageRecipeDedupeKey } from "../../application/services/message-trigger-recipes";
import { BadRequestException, ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
    MessageTriggerService,
    validateMessageTriggerRule,
} from "application/services/message-trigger.service";
import {
    CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
    EVENT_OFFSET_OPTIONS,
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTargetClientStatus,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import {
    SEND_HOUR_KST,
    PAST_OCCURRENCE_GRACE_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
} from "domain/constants/message-automation-policy";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobStatus,
} from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { MessageTriggerJobCancellationScope } from "domain/repositories/message-trigger-job.repository.interface";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_ENDED_REASON,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "application/services/sms-trigger-delivery.service";
import { createAgentAutomationTaskCommitReference } from "application/agent/agent-automation-storage.schema";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";

jest.mock("infrastructure/database/schema-capabilities", () => ({
    hasColumn: jest.fn().mockResolvedValue(true),
    hasTable: jest.fn().mockResolvedValue(true),
}));

describe("MessageTriggerService", () => {
    const branchId = "branch-1";
    type EmployeeAssignmentScheduleSource = {
        id: number;
        branchId: string | null;
        clientId: number;
        workAddress: string;
        startDate: Date;
        endDate: Date;
        replaced: boolean;
        terminatedAt: Date | null;
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
        applyRetroactiveSendConfig: (
            branchId: string,
            candidates: Array<{ rule: MessageTriggerRuleEntity; job: MessageTriggerJobEntity }>,
            stableBatchAt?: Date,
        ) => Promise<Array<{ rule: MessageTriggerRuleEntity; job: MessageTriggerJobEntity }>>;
        recoverApprovedBranches: () => Promise<void>;
        processStaleRuleRebuilds: () => Promise<void>;
        buildEmployeeAssignmentJob: (
            rule: MessageTriggerRuleEntity,
            schedule: EmployeeAssignmentScheduleSource,
        ) => MessageTriggerJobEntity | null;
        fenceServiceRecordRevisionBeforeProviderSend: (
            job: MessageTriggerJobEntity,
            transaction: Prisma.TransactionClient,
        ) => Promise<{ kind: "allow" | "stale" | "lost"; reason?: string }>;
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
        targetClientStatus: MessageTriggerTargetClientStatus;
        retryOnFailure: boolean;
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
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_GREETING,
            overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.isDefault ?? false,
            overrides.jobsStale ?? false,
            "09:00",
            overrides.targetClientStatus ?? "all",
            overrides.retryOnFailure ?? true,
        );

    const createJob = (overrides: Partial<{
        id: string;
        ruleId: string;
        status: MessageTriggerJobStatus;
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
        canceledAt: Date | null;
        cancelReason: string | null;
        createdAt: Date;
    }> = {}) =>
        MessageTriggerJobEntity.reconstitute(
            overrides.id ?? "job-1",
            branchId,
            overrides.ruleId ?? "rule-1",
            overrides.status ?? "pending",
            overrides.scheduledFor ?? new Date(),
            null,
            overrides.canceledAt ?? null,
            overrides.cancelReason ?? null,
            overrides.clientId === undefined ? 1 : overrides.clientId,
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
            overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
            overrides.attempts ?? 0,
            overrides.nextAttemptAt ?? null,
        );

    const createLog = (overrides: Partial<{
        id: number;
        triggerJobId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }> = {}) => MessageLogEntity.reconstitute(
        overrides.id ?? 1,
        branchId,
        "aligo_sms",
        "CLIENT_GREETING",
        overrides.triggerJobId ?? null,
        "010-1234-5678",
        1,
        "안녕하세요",
        {},
        "sent",
        null,
        null,
        1,
        overrides.updatedAt ?? new Date("2026-06-01T00:00:00.000Z"),
        null,
        overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
        overrides.updatedAt ?? new Date("2026-06-01T00:00:00.000Z"),
        "고객",
        "010-1234-5678",
    );

    const createMessageLogRepository = () => ({
        findSentTriggerJobIdsSystemScope: jest.fn<Promise<Set<string>>, [string[]]>().mockResolvedValue(
            new Set<string>(),
        ),
        // Present by default so reclaim tests exercise the production branch
        // that fences jobs whose provider attempt is started/uncertain.
        findUncertainTriggerJobIdsSystemScope: jest.fn<Promise<Set<string>>, [string[]]>().mockResolvedValue(
            new Set<string>(),
        ),
        findRecentByBranch: jest.fn().mockResolvedValue([]),
        findHistoryPageByBranch: jest.fn().mockResolvedValue([]),
        findClientHistoryPageByBranch: jest.fn().mockResolvedValue([]),
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

    const createMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
        isApproved: jest.fn().mockResolvedValue(true),
        getApprovedBranchIds: jest
            .fn<Promise<Set<string>>, [string[]]>()
            .mockImplementation(async (branchIds) => new Set(branchIds)),
        getApprovedBranches: jest
            .fn<Promise<Map<string, Date | null>>, [string[]]>()
            .mockImplementation(async (branchIds) =>
                new Map(branchIds.map((id) => [id, new Date("2026-06-05T00:00:00.000Z")]))
        ),
    });

    const createAutomationActivationService = () => ({
        getTriggerDispatchEnabled: jest.fn().mockResolvedValue(true),
        assertTriggerDispatchEnabled: jest.fn().mockResolvedValue(undefined),
        setTriggerDispatchEnabled: jest.fn().mockResolvedValue(undefined),
        setGlobalRuleBranchActivation: jest.fn().mockResolvedValue(undefined),
        activateRuleWithParent: jest.fn(),
    });

    const createSystemTemplateService = () => {
        const getTemplate = async (templateKey: string) => ({
            id: `template-${templateKey}`,
            templateKey,
            customVariables: [],
        });

        return {
            getByKey: jest.fn().mockImplementation(getTemplate),
            getByKeyForBranch: jest.fn().mockImplementation(
                async (_branchId: string, templateKey: string) => getTemplate(templateKey),
            ),
        };
    };

    const createTemplateAutomationLock = (prisma?: unknown) => ({
        runExclusive: jest.fn().mockImplementation(async (
            _templateKey: string,
            work: (transaction: unknown) => Promise<unknown>,
            transaction?: unknown,
        ) => {
            if (transaction) return work(transaction);
            const runTransaction = (prisma as {
                $transaction?: (operation: (transaction: unknown) => Promise<unknown>) => Promise<unknown>;
            } | undefined)?.$transaction;
            if (runTransaction) return runTransaction(work);
            return work({});
        }),
    });

    const createBranchLock = (prisma?: unknown) => ({
        runExclusive: jest.fn().mockImplementation(async (
            _branchId: string,
            work: (transaction: unknown) => Promise<unknown>,
            transaction?: unknown,
        ) => {
            if (transaction) return work(transaction);
            const runTransaction = (prisma as {
                $transaction?: (operation: (transaction: unknown) => Promise<unknown>) => Promise<unknown>;
            } | undefined)?.$transaction;
            if (runTransaction) return runTransaction(work);
            return work(prisma ?? {});
        }),
    });

    const createService = (systemSettingService?: {
        getMessageSettingsPolicyEnabled: jest.Mock;
    }) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findById: jest.fn(),
            findByIdIncludingGlobal: jest.fn().mockResolvedValue(null),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateIfTargetMatches: jest.fn(),
            updateIfTargetMatchesAndFenceJobs: jest.fn(),
            delete: jest.fn(),
            deleteIfTargetMatches: jest.fn(),
            deleteIfTargetMatchesAndFenceJobs: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const jobRepository = {
            cancelOrphanedPending: jest.fn().mockResolvedValue(0),
            findRecoverableOrphanedClientJobs: jest.fn().mockResolvedValue([]),
            markOrphanedJobsReconciled: jest.fn().mockResolvedValue(0),
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
            ) => {
                await jobRepository.cancelPendingByRuleId(ruleId, reason);
                return 0;
            }),
            findUpcomingPendingByBranch: jest.fn().mockResolvedValue([]),
            findTerminalByBranch: jest.fn().mockResolvedValue([]),
            findHistoryPageByBranch: jest.fn().mockResolvedValue([]),
            findClientHistoryPageByBranch: jest.fn().mockResolvedValue([]),
            hasActiveJobsBefore: jest.fn().mockResolvedValue(false),
            upsertPending: jest.fn().mockResolvedValue(undefined),
            cancelPendingByUser: jest.fn().mockResolvedValue(true),
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
        };
        const writeTransaction = { message_trigger_rule: {} };
        const prisma = {
            client: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            message_log: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            message_trigger_job: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            // updateRuleBranchActivation reads the fixed global rule directly (not through
            // ruleRepository), to check whether a global kill switch blocks re-enabling.
            message_trigger_rule: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn().mockImplementation(
                async (operation: (transaction: typeof writeTransaction) => Promise<unknown>) =>
                    operation(writeTransaction),
            ),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const systemTemplateService = createSystemTemplateService();
        const templateAutomationLock = createTemplateAutomationLock(prisma);
        const overrideRepository = createOverrideRepository();
        const messageAutomationActivationService = createAutomationActivationService();
        const messageAutomationBranchLockService = createBranchLock(prisma);
        messageAutomationActivationService.setGlobalRuleBranchActivation.mockImplementation(
            async (targetBranchId: string, ruleId: string, isActive: boolean) => {
                const global = await prisma.message_trigger_rule.findUnique({ where: { id: ruleId } });
                if (!global || global.branchId !== null) throw new NotFoundException(`Trigger rule ${ruleId} not found`);
                if (isActive && global.isActive === false) throw new ConflictException("Global rule is disabled");
                await overrideRepository.upsert(targetBranchId, ruleId, isActive);
                if (!isActive) {
                    await overrideRepository.cancelJobsForBranchRule(
                        targetBranchId,
                        ruleId,
                        SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
                        SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                    );
                }
                return createRule({
                    id: ruleId,
                    branchId: null,
                    isActive: global.isActive === true && isActive,
                });
            },
        );
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            systemTemplateService as never,
            templateAutomationLock as never,
            systemSettingService as never,
            overrideRepository as never,
            messageAutomationActivationService as never,
            messageAutomationBranchLockService as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, messageAutomationBranchLockService as never));

        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        return {
            service,
            internals,
            prisma,
            ruleRepository,
            jobRepository,
            messageLogRepository,
            messageSenderApprovalService,
            systemTemplateService,
            overrideRepository,
            templateAutomationLock,
            messageAutomationActivationService,
            messageAutomationBranchLockService,
        };
    };

    const createDispatchService = (systemSettingService?: {
        getMessageSettingsPolicyEnabled: jest.Mock;
    }) => {
        const sendJob = jest.fn().mockResolvedValue(true);
        const deliveryService: { sendJob: jest.Mock; prepareJob: jest.Mock; sendPreparedJob: jest.Mock } = {
            sendJob,
            prepareJob: jest.fn(async (job: MessageTriggerJobEntity) => {
                job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = "synthetic-trigger-prepared";
                return { serializedSnapshot: "synthetic-trigger-prepared", snapshot: { snapshotHash: "synthetic" } };
            }),
            sendPreparedJob: jest.fn(async (job: MessageTriggerJobEntity) => sendJob(job)),
        };
        const jobRepository = {
            cancelOrphanedPending: jest.fn().mockResolvedValue(0),
            findDuePendingSystemScope: jest.fn().mockResolvedValue([]),
            findByIdInBranch: jest.fn().mockResolvedValue(null),
            findStaleProcessingSystemScope: jest.fn().mockResolvedValue([]),
            claimPendingWithRuleFence: jest.fn().mockResolvedValue("claim-a"),
            claimNeedsSetupWithRuleFence: jest.fn().mockResolvedValue("claim-a"),
            findForClientAutomationReview: jest.fn().mockResolvedValue([]),
            hasNewerClientRuleSibling: jest.fn().mockResolvedValue(false),
            update: jest.fn().mockResolvedValue(undefined),
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
            ) => {
                await jobRepository.cancelPendingByRuleId(ruleId, reason);
                return 0;
            }),
        };
        const ruleRepository = {
            findByIdIncludingGlobal: jest.fn().mockResolvedValue(null),
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const employeeScheduleFindFirst = jest.fn().mockResolvedValue(null);
        // Backs the raw prisma re-read `dispatchClaimedJob` does inside its transaction
        // (message-trigger.service.ts:2109, `transaction.message_trigger_job.findUnique`).
        // That re-read bypasses the repository interface entirely, so this is a plain
        // standalone mock rather than a jobRepository method.
        const claimedJobRead = jest.fn().mockResolvedValue(null);
        type DispatchTransaction = {
            $queryRaw: jest.Mock;
            message_trigger_job: { findUnique: jest.Mock };
            employee_schedule: { findFirst: jest.Mock };
        };
        const transaction: DispatchTransaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }]),
            message_trigger_job: {
                findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
                    claimedJobRead(where.id)),
            },
            employee_schedule: {
                findFirst: employeeScheduleFindFirst,
            },
        };
        const messageAutomationActivationService = createAutomationActivationService();
        const prisma = {
            message_trigger_job: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            employee_schedule: {
                findFirst: employeeScheduleFindFirst,
            },
            client: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn().mockImplementation(
                async (operation: (transaction: DispatchTransaction) => Promise<unknown>) => operation(transaction),
            ),
        };
        const messageAutomationBranchLockService = createBranchLock(prisma);
        const service = new MessageTriggerService(
            prisma as never,
            deliveryService as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            createSystemTemplateService() as never,
            createTemplateAutomationLock(prisma) as never,
            systemSettingService as never,
            createOverrideRepository() as never,
            messageAutomationActivationService as never,
            messageAutomationBranchLockService as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, messageAutomationBranchLockService as never));

        jest.spyOn(service as unknown as ServiceInternals, "hasTriggerSchema").mockResolvedValue(true);

        return {
            service,
            deliveryService,
            ruleRepository,
            jobRepository,
            messageLogRepository,
            messageSenderApprovalService,
            prisma,
            transaction,
            claimedJobRead,
            messageAutomationActivationService,
            messageAutomationBranchLockService,
        };
    };

    it("cancels orphaned pending jobs before returning the upcoming list", async () => {
        const { service, jobRepository } = createService();

        await service.listUpcomingJobs(branchId);

        expect(jobRepository.cancelOrphanedPending).toHaveBeenCalledWith(
            "Related client or schedule deleted",
            branchId,
        );
        expect(jobRepository.findUpcomingPendingByBranch).toHaveBeenCalledWith(branchId, 200);
    });

    it("rebuilds stale rule generations before loading due jobs in the same scheduler tick", async () => {
        const { service, jobRepository } = createDispatchService();
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "processStaleRuleRebuilds").mockResolvedValue(undefined);

        await service.dispatchDueJobs();

        expect(rebuildSpy).toHaveBeenCalledTimes(1);
        expect(jobRepository.findDuePendingSystemScope).toHaveBeenCalledTimes(1);
        expect(rebuildSpy.mock.invocationCallOrder[0]!).toBeLessThan(
            jobRepository.findDuePendingSystemScope.mock.invocationCallOrder[0]!,
        );
    });

    it("omits private automation authority from upcoming jobs without changing stored payload", async () => {
        const { service, jobRepository, ruleRepository } = createService();
        const job = createJob({ id: "job-private-authority", status: "pending" });
        // Projection must omit malformed carriers too; parsing is a delivery boundary.
        job.payload.agentAutomationSeal = { private: "synthetic-authority" } as never;
        const stored = structuredClone(job.payload);
        jobRepository.findUpcomingPendingByBranch.mockResolvedValue([job]);
        ruleRepository.findAll.mockResolvedValue([createRule({ id: job.ruleId })]);
        const result = await service.listUpcomingJobs(branchId);
        expect(result).toHaveLength(1);
        expect(result[0]!.payload).not.toHaveProperty("agentAutomationSeal");
        expect(result[0]!.payload.recipientName).toBe(job.payload.recipientName);
        expect(job.payload).toEqual(stored);
    });

    it("includes manual scheduled SMS logs in the upcoming list", async () => {
        const { service, prisma } = createService();
        prisma.message_log.findMany.mockResolvedValue([{
            id: 91,
            branchId,
            provider: "aligo_sms",
            templateKey: "안내",
            receiver: "01012345678",
            clientId: 7,
            recipientName: "김고객",
            recipientPhone: "01012345678",
            messageBody: "예약 안내",
            variables: {
                triggerType: "scheduled",
                scheduledDate: "20260720",
                scheduledTime: "1530",
                title: "예약 안내",
            },
            status: "pending",
            createdAt: new Date("2026-07-16T00:00:00.000Z"),
            updatedAt: new Date("2026-07-16T00:00:00.000Z"),
        }]);

        const result = await service.listUpcomingJobs(branchId);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: "log:91",
            ruleName: "예약 안내",
            status: "pending",
            recipientPhone: "01012345678",
        });
        expect(result[0]?.scheduledFor.toISOString()).toBe("2026-07-20T06:30:00.000Z");
    });

    it("exposes canceled and failed jobs in history when no message log exists", async () => {
        const { service, jobRepository, ruleRepository } = createService();
        const canceledJob = createJob({
            id: "job-canceled",
            status: "canceled",
            cancelReason: "메시지 발송 승인 필요",
            canceledAt: new Date("2026-07-16T01:00:00.000Z"),
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const failedJob = createJob({
            id: "job-failed",
            status: "failed",
            cancelReason: "provider timeout",
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        jobRepository.findTerminalByBranch.mockResolvedValue([canceledJob, failedJob]);
        ruleRepository.findAll.mockResolvedValue([
            createRule({ id: "rule-1", name: "서비스 안내 자동 발송" }),
        ]);

        const result = await service.listHistory(branchId);

        expect(result.map((record) => record.id)).toEqual([
            "job:job-canceled",
            "job:job-failed",
        ]);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                triggerJobId: "job-canceled",
                status: "canceled",
                errorMessage: "메시지 발송 승인 필요",
            }),
            expect.objectContaining({
                triggerJobId: "job-failed",
                status: "failed",
                errorMessage: "provider timeout",
            }),
        ]));
    });

    it("returns needs_setup and its actionable reason through all three history mappers", async () => {
        const { service, jobRepository, prisma, ruleRepository } = createService();
        const job = createJob({ status: "needs_setup", cancelReason: "필수 정보 누락 (name)" });
        ruleRepository.findAll.mockResolvedValue([]);
        jobRepository.findTerminalByBranch.mockResolvedValue([job]);
        jobRepository.findHistoryPageByBranch.mockResolvedValue([job]);
        jobRepository.findClientHistoryPageByBranch.mockResolvedValue([job]);
        prisma.client.findFirst.mockResolvedValue({ id: 1, phone: "010-1234-5678" });
        const rows = [
            ...(await service.listHistory(branchId)),
            ...(await service.listHistoryPage(branchId)).items,
            ...(await service.listClientHistoryPage(branchId, 1)).items,
        ];
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.status).toBe("needs_setup");
            expect(row.errorMessage).toBe("필수 정보 누락 (name)");
        }
    });

    it("rebuilds jobs for a newer client with the same phone as a canceled orphan", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-job",
            status: "canceled",
            clientId: null,
            canceledAt: new Date("2026-07-12T00:00:00.000Z"),
            cancelReason: "Related client or schedule deleted",
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([
            {
                id: 42,
                phone: "01012345678",
                createdAt: new Date("2026-07-12T01:00:00.000Z"),
                suppressGreetingSms: false,
            },
        ]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 42, true, false);
        expect(jobRepository.markOrphanedJobsReconciled).toHaveBeenCalledWith(
            ["orphaned-job"],
            42,
        );
    });

    it("reconciles a replacement client without creating greeting jobs when SMS greeting is suppressed", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-suppressed-greeting",
            clientId: null,
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([{
            id: 42,
            phone: "01012345678",
            createdAt: new Date("2026-07-12T01:00:00.000Z"),
            suppressGreetingSms: true,
        }]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 42, true, true);
    });

    it("does not reuse an orphan for a client that predates the old job", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-job",
            status: "canceled",
            clientId: null,
            canceledAt: new Date("2026-07-12T00:00:00.000Z"),
            cancelReason: "Related client or schedule deleted",
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([
            {
                id: 7,
                phone: "010-1234-5678",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
            },
        ]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(jobRepository.markOrphanedJobsReconciled).not.toHaveBeenCalled();
    });

    it("cancels orphaned pending jobs before dispatching due jobs", async () => {
        const { service, jobRepository } = createDispatchService();

        await service.dispatchDueJobs();

        expect(jobRepository.cancelOrphanedPending).toHaveBeenCalledWith(
            "Related client or schedule deleted",
        );
    });

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
            expect.any(Object),
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
            expect.any(Object),
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

    describe("branch-activation overlay on listRules", () => {
        it("marks a global rule isLockedByGlobal when it is disabled and no branch override exists", async () => {
            const { service, ruleRepository, overrideRepository, messageSenderApprovalService } = createService();
            const globalRule = createRule({ id: "rule-global", isActive: false });
            globalRule.branchId = null;
            ruleRepository.findAll.mockResolvedValue([globalRule]);
            // Skip default-trigger provisioning so this test stays focused on the overlay.
            messageSenderApprovalService.isApproved.mockResolvedValue(false);

            const rules = await service.listRules(branchId);

            expect(overrideRepository.findAllByBranch).toHaveBeenCalledWith(branchId);
            expect(rules).toHaveLength(1);
            expect(rules[0]?.isLockedByGlobal).toBe(true);
            expect(rules[0]?.isActive).toBe(false);
        });

        it("keeps isLockedByGlobal true and effective isActive false even when the branch opted back in — a global kill switch cannot be overridden by an opt-out-only override", async () => {
            const { service, ruleRepository, overrideRepository, messageSenderApprovalService } = createService();
            const globalRule = createRule({ id: "rule-global", isActive: false });
            globalRule.branchId = null;
            ruleRepository.findAll.mockResolvedValue([globalRule]);
            messageSenderApprovalService.isApproved.mockResolvedValue(false);
            overrideRepository.findAllByBranch.mockResolvedValue([
                { branchId, ruleId: "rule-global", isActive: true },
            ]);

            const rules = await service.listRules(branchId);

            expect(rules[0]?.isLockedByGlobal).toBe(true);
            expect(rules[0]?.isActive).toBe(false);
        });

        it("reports effective isActive false for a branch that opted out of an active global rule, without locking it", async () => {
            const { service, ruleRepository, overrideRepository, messageSenderApprovalService } = createService();
            const globalRule = createRule({ id: "rule-global", isActive: true });
            globalRule.branchId = null;
            ruleRepository.findAll.mockResolvedValue([globalRule]);
            messageSenderApprovalService.isApproved.mockResolvedValue(false);
            overrideRepository.findAllByBranch.mockResolvedValue([
                { branchId, ruleId: "rule-global", isActive: false },
            ]);

            const rules = await service.listRules(branchId);

            expect(rules[0]?.isLockedByGlobal).toBe(false);
            expect(rules[0]?.isActive).toBe(false);
        });
    });

    describe("updateRuleBranchActivation", () => {
        it("rejects re-enabling a branch (409) when the global rule itself is disabled", async () => {
            const { service, prisma } = createService();
            prisma.message_trigger_rule.findUnique.mockResolvedValue({
                id: "rule-global",
                branchId: null,
                isActive: false,
            });

            await expect(service.updateRuleBranchActivation(branchId, "rule-global", true))
                .rejects.toBeInstanceOf(ConflictException);
        });

        it("rejects (404) a branch-owned rule id — branch-activation only applies to global rules", async () => {
            const { service, prisma } = createService();
            prisma.message_trigger_rule.findUnique.mockResolvedValue({
                id: "rule-1",
                branchId: "branch-1",
                isActive: true,
            });

            await expect(service.updateRuleBranchActivation(branchId, "rule-1", false))
                .rejects.toBeInstanceOf(NotFoundException);
        });

        it("rejects (404) when the rule id does not exist at all", async () => {
            const { service, prisma } = createService();
            prisma.message_trigger_rule.findUnique.mockResolvedValue(null);

            await expect(service.updateRuleBranchActivation(branchId, "missing-rule", false))
                .rejects.toBeInstanceOf(NotFoundException);
        });

        it("opting out upserts the override and cancels the branch's jobs with the disabled reason", async () => {
            const { service, prisma, ruleRepository, overrideRepository, messageSenderApprovalService } =
                createService();
            prisma.message_trigger_rule.findUnique.mockResolvedValue({
                id: "rule-global",
                branchId: null,
                isActive: true,
            });
            const globalRule = createRule({ id: "rule-global", isActive: true });
            globalRule.branchId = null;
            ruleRepository.findAll.mockResolvedValue([globalRule]);
            messageSenderApprovalService.isApproved.mockResolvedValue(false);

            await service.updateRuleBranchActivation(branchId, "rule-global", false);

            expect(overrideRepository.upsert).toHaveBeenCalledWith(branchId, "rule-global", false);
            expect(overrideRepository.cancelJobsForBranchRule).toHaveBeenCalledWith(
                branchId,
                "rule-global",
                SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
                SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
            );
        });

        it("opting back in upserts the override without canceling any jobs", async () => {
            const { service, prisma, ruleRepository, overrideRepository, messageSenderApprovalService } =
                createService();
            prisma.message_trigger_rule.findUnique.mockResolvedValue({
                id: "rule-global",
                branchId: null,
                isActive: true,
            });
            const globalRule = createRule({ id: "rule-global", isActive: true });
            globalRule.branchId = null;
            ruleRepository.findAll.mockResolvedValue([globalRule]);
            messageSenderApprovalService.isApproved.mockResolvedValue(false);

            await service.updateRuleBranchActivation(branchId, "rule-global", true);

            expect(overrideRepository.upsert).toHaveBeenCalledWith(branchId, "rule-global", true);
            expect(overrideRepository.cancelJobsForBranchRule).not.toHaveBeenCalled();
        });
    });

    it("rejects an explicit automatic activation while the branch parent is disabled before writing the rule", async () => {
        const {
            prisma,
            ruleRepository,
            jobRepository,
            messageSenderApprovalService,
            systemTemplateService,
            overrideRepository,
            templateAutomationLock,
            messageLogRepository,
        } = createService();
        const parentDisabled = new ConflictException({
            code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
            message: "Message automation parent is disabled",
        });
        const activationService = {
            getTriggerDispatchEnabled: jest.fn().mockResolvedValue(true),
            assertTriggerDispatchEnabled: jest.fn().mockRejectedValue(parentDisabled),
        };
        const branchLock = {
            runExclusive: jest.fn(async (
                _branchId: string,
                work: (transaction: unknown) => Promise<unknown>,
            ) => work({})),
        };
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            systemTemplateService as never,
            templateAutomationLock as never,
            undefined,
            overrideRepository as never,
            activationService as never,
            branchLock as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, branchLock as never));
        jest.spyOn(service as unknown as ServiceInternals, "hasTriggerSchema").mockResolvedValue(true);
        ruleRepository.findById.mockResolvedValue(createRule({ id: "rule-parent-off", isActive: false }));

        await expect(service.updateRule("branch-1", "rule-parent-off", { isActive: true }))
            .rejects.toMatchObject({ response: { code: "MESSAGE_AUTOMATION_PARENT_DISABLED" } });

        expect(activationService.assertTriggerDispatchEnabled).toHaveBeenCalled();
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
    });

    it.each([undefined, "16:09"])("uses the locked rule time unless a new time is requested (%s)", async (sendTime) => {
        const { service, ruleRepository } = createService();
        const staleRule = createRule({ id: "rule-send-time-lock", isActive: false });
        staleRule.sendTime = "10:00";
        const rule = createRule({ id: "rule-send-time-lock", isActive: false });
        rule.sendTime = "14:37";
        ruleRepository.findById.mockResolvedValueOnce(staleRule).mockResolvedValue(rule);
        ruleRepository.update.mockImplementation(async (
            _branchId: string,
            persisted: MessageTriggerRuleEntity,
        ) => persisted);

        await service.updateRule(branchId, rule.id, { name: "Changed under lock", sendTime });

        expect(ruleRepository.update).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ id: rule.id, sendTime: sendTime ?? "14:37", isActive: false }),
            expect.any(Object),
        );
    });

    it("clamps a metadata-only update to the locked inactive row after a concurrent parent-off fence", async () => {
        const { service, ruleRepository } = createService();
        const staleActiveRule = createRule({
            id: "rule-metadata-race",
            isActive: true,
            jobsStale: false,
        });
        const lockedInactiveRule = createRule({
            id: staleActiveRule.id,
            isActive: false,
            jobsStale: false,
        });
        ruleRepository.findById
            .mockResolvedValueOnce(staleActiveRule)
            .mockResolvedValueOnce(lockedInactiveRule)
            .mockResolvedValueOnce(lockedInactiveRule);
        ruleRepository.update.mockImplementation(async (
            _branchId: string,
            persisted: MessageTriggerRuleEntity,
        ) => persisted);

        await service.updateRule(branchId, staleActiveRule.id, { name: "메타데이터만 수정" });

        expect(ruleRepository.update).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                id: staleActiveRule.id,
                name: "메타데이터만 수정",
                isActive: false,
            }),
            expect.any(Object),
        );
    });

    it("validates the candidate read after the branch lock when its template changes", async () => {
        const {
            service,
            ruleRepository,
            systemTemplateService,
            templateAutomationLock,
            messageAutomationActivationService,
            messageAutomationBranchLockService,
        } = createService();
        const lockedCandidate = createRule({
            id: "rule-template-race",
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            recipientType: MessageTriggerRecipientType.CLIENT,
        });
        let lockHeld = false;
        messageAutomationBranchLockService.runExclusive.mockImplementationOnce(async (
            _branchId: string,
            work: (transaction: unknown) => Promise<unknown>,
        ) => {
            lockHeld = true;
            return work({});
        });
        ruleRepository.findAll.mockImplementation(async () => {
            expect(lockHeld).toBe(true);
            return [lockedCandidate];
        });
        messageAutomationActivationService.activateRuleWithParent.mockResolvedValue(lockedCandidate);

        await expect(service.activateRuleWithParent(branchId, lockedCandidate.id)).resolves.toBe(lockedCandidate);

        expect(templateAutomationLock.runExclusive).toHaveBeenCalledWith(
            SystemTemplateKey.GREETING,
            expect.any(Function),
            expect.any(Object),
        );
        expect(systemTemplateService.getByKeyForBranch).toHaveBeenCalledWith(branchId, SystemTemplateKey.GREETING);
        expect(messageAutomationActivationService.activateRuleWithParent).toHaveBeenCalledWith(
            branchId,
            lockedCandidate.id,
            undefined,
            expect.any(Object),
        );
    });

    it("createRule synchronously reconciles the new rule generation before returning", async () => {
        const {
            service,
            internals,
            ruleRepository,
            jobRepository,
            templateAutomationLock,
        } = createService();
        const createdRule = createRule({
            id: "rule-created",
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const staleRule = createRule({
            id: createdRule.id,
            name: createdRule.name,
            eventType: createdRule.eventType,
            offsetType: createdRule.offsetType,
            offsetDays: createdRule.offsetDays,
            templateKey: createdRule.templateKey,
            jobsStale: true,
            updatedAt: new Date("2026-06-01T00:00:01.000Z"),
        });
        const reconciledRule = createRule({
            id: createdRule.id,
            name: createdRule.name,
            eventType: createdRule.eventType,
            offsetType: createdRule.offsetType,
            offsetDays: createdRule.offsetDays,
            templateKey: createdRule.templateKey,
            jobsStale: false,
            updatedAt: staleRule.updatedAt,
        });
        ruleRepository.create.mockResolvedValue(createdRule);
        ruleRepository.findById
            .mockResolvedValueOnce(staleRule)
            .mockResolvedValueOnce(reconciledRule);

        const result = await service.createRule(branchId, {
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        expect(result).toBe(reconciledRule);
        expect(templateAutomationLock.runExclusive).toHaveBeenCalledWith(
            SystemTemplateKey.GREETING,
            expect.any(Function),
            expect.any(Object),
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(
            branchId,
            createdRule.id,
            expect.any(Object),
        );
        expect(jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
            branchId,
            staleRule.id,
            staleRule.updatedAt,
            true,
            "규칙 재생성",
            expect.any(Object),
            expect.any(Object),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(
            branchId,
            staleRule,
            false,
            expect.any(Object),
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
            expect.any(Object),
        );
    });

    it.each(["initial", "final"] as const)(
        "returns the one persisted rule when the %s post-write reconciliation read fails",
        async (failedRead) => {
            const { service, ruleRepository } = createService();
            const createdRule = createRule({
                id: `rule-read-failure-${failedRead}`,
                name: "중복 방지 규칙",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            });
            const staleRule = createRule({
                id: createdRule.id,
                name: createdRule.name,
                eventType: createdRule.eventType,
                offsetType: createdRule.offsetType,
                offsetDays: createdRule.offsetDays,
                templateKey: createdRule.templateKey,
                jobsStale: true,
                updatedAt: new Date("2026-06-01T00:00:01.000Z"),
            });
            ruleRepository.create.mockResolvedValue(createdRule);
            if (failedRead === "initial") {
                ruleRepository.findById.mockRejectedValueOnce(new Error("temporary read failure"));
            } else {
                ruleRepository.findById
                    .mockResolvedValueOnce(staleRule)
                    .mockRejectedValueOnce(new Error("temporary read failure"));
            }

            await expect(service.createRule(branchId, {
                name: createdRule.name,
                eventType: createdRule.eventType,
                offsetType: createdRule.offsetType,
                recipientType: createdRule.recipientType,
                templateKey: createdRule.templateKey,
            })).resolves.toBe(createdRule);

            expect(ruleRepository.create).toHaveBeenCalledTimes(1);
            expect(ruleRepository.markJobsStale).toHaveBeenCalledTimes(1);
        },
    );

    it("rolls back the inserted rule when its stale marker fails so a retry cannot duplicate it", async () => {
        const { service, prisma, ruleRepository } = createService();
        const durableRules: MessageTriggerRuleEntity[] = [];
        let failStaleMarker = true;
        prisma.$transaction.mockImplementation(async (
            operation: (transaction: { id: string }) => Promise<MessageTriggerRuleEntity>,
        ) => {
            const snapshot = [...durableRules];
            try {
                return await operation({ id: `tx-${prisma.$transaction.mock.calls.length}` });
            } catch (error) {
                durableRules.splice(0, durableRules.length, ...snapshot);
                throw error;
            }
        });
        ruleRepository.create.mockImplementation(async (
            _branchId: string,
            candidate: MessageTriggerRuleEntity,
        ) => {
            const persisted = createRule({
                id: "rule-atomic-create",
                name: candidate.name,
                eventType: candidate.eventType,
                offsetType: candidate.offsetType,
                offsetDays: candidate.offsetDays,
                recipientType: candidate.recipientType,
                templateKey: candidate.templateKey,
            });
            durableRules.push(persisted);
            return persisted;
        });
        ruleRepository.markJobsStale.mockImplementation(async () => {
            if (failStaleMarker) {
                failStaleMarker = false;
                throw new Error("temporary stale-marker failure");
            }
        });
        const input = {
            name: "원자 생성 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        };

        await expect(service.createRule(branchId, input)).rejects.toThrow(
            "temporary stale-marker failure",
        );
        expect(durableRules).toHaveLength(0);

        await expect(service.createRule(branchId, input)).resolves.toEqual(
            expect.objectContaining({ id: "rule-atomic-create" }),
        );
        expect(durableRules).toHaveLength(1);
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("rejects a fake template without an SMS provider when creating a rule", async () => {
        const { service, ruleRepository } = createService();
        const fakeTemplateKey = "FAKE_SMS_DISABLED" as MessageTriggerTemplateKey;
        const catalog = MESSAGE_TRIGGER_TEMPLATE_CATALOG as Record<string, unknown>;
        catalog[fakeTemplateKey] = {
            key: fakeTemplateKey,
            name: "가짜 템플릿",
            description: "SMS provider 가드 테스트",
            allowedEventTypes: [MessageTriggerEventType.CLIENT_CREATED],
            allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
            requiredVariables: [],
            providers: {},
        };

        try {
            await expect(service.createRule(branchId, {
                name: "가짜 규칙",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: fakeTemplateKey,
            })).rejects.toThrow("SMS 발송 채널이 없는 템플릿입니다.");
            expect(ruleRepository.create).not.toHaveBeenCalled();
        } finally {
            delete catalog[fakeTemplateKey];
        }
    });

    it.each([
        MessageTriggerTemplateKey.CLIENT_WELCOME,
        MessageTriggerTemplateKey.SERVICE_START_REMINDER,
        MessageTriggerTemplateKey.SERVICE_END_REMINDER,
        MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
    ])("does not expose or accept non-configurable template %s in the generic rule builder", async (templateKey) => {
        const { service, ruleRepository } = createService();

        const listedTemplateKeys = service.listTemplates({}).map((template) => template.key);

        expect(listedTemplateKeys).not.toContain(templateKey);
        await expect(service.createRule(branchId, {
            name: "숨은 템플릿 일반 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey,
        })).rejects.toThrow(
            templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK
                ? "일반 자동 전송 규칙에서 사용할 수 없는 템플릿입니다."
                : "SMS 발송 채널이 없는 템플릿입니다.",
        );
        expect(ruleRepository.create).not.toHaveBeenCalled();
    });

    it("rejects an active rule before persistence when its required custom variable has no automatic source", async () => {
        const { service, ruleRepository, systemTemplateService } = createService();
        systemTemplateService.getByKeyForBranch.mockResolvedValue({
            id: "template-service-info",
            templateKey: "SERVICE_INFO",
            customVariables: [
                { key: "reservationCode", label: "예약 코드", required: true },
            ],
        });

        await expect(service.createRule(branchId, {
            name: "지원되지 않는 사용자 변수 규칙",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                unsupportedVariables: ["reservationCode"],
            }),
        });

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
    });

    it("rejects list-toggle activation when a required custom variable has no automatic source", async () => {
        const { service, ruleRepository, systemTemplateService } = createService();
        const inactiveRule = createRule({
            id: "rule-inactive-unsupported-variable",
            isActive: false,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        ruleRepository.findById.mockResolvedValue(inactiveRule);
        systemTemplateService.getByKeyForBranch.mockResolvedValue({
            id: "template-service-info",
            templateKey: "SERVICE_INFO",
            customVariables: [
                { key: "reservationCode", label: "예약 코드", required: true },
            ],
        });

        await expect(service.updateRule(branchId, inactiveRule.id, {
            isActive: true,
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                unsupportedVariables: ["reservationCode"],
            }),
        });

        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
    });

    it.each(
        CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS.flatMap((templateKey) =>
            MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].allowedEventTypes.flatMap((eventType) =>
                MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].allowedRecipientTypes.flatMap((recipientType) =>
                    EVENT_OFFSET_OPTIONS[eventType].map((offsetType) => ({
                        templateKey,
                        eventType,
                        recipientType,
                        offsetType,
                    })),
                ),
            ),
        ),
    )(
        "accepts configurable rule combination $templateKey / $eventType / $recipientType / $offsetType",
        ({ templateKey, eventType, recipientType, offsetType }) => {
            expect(() => validateMessageTriggerRule({
                templateKey,
                eventType,
                recipientType,
                offsetType,
                offsetDays:
                    offsetType === MessageTriggerOffsetType.BEFORE_DAYS
                    || offsetType === MessageTriggerOffsetType.AFTER_DAYS
                        ? 1
                        : 0,
            })).not.toThrow();
        },
    );

    it.each(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS)(
        "rejects invalid employee-recipient creation for %s without persisting a rule",
        async (templateKey) => {
            const { service, ruleRepository } = createService();

            await expect(service.createRule(branchId, {
                name: `잘못된 ${templateKey} 규칙`,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey,
            })).rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });

            expect(ruleRepository.create).not.toHaveBeenCalled();
            expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        },
    );

    it("rejects an approved automation update whose snapshot no longer matches as VALIDATION_FAILED", async () => {
        const { service } = createService();
        const existingRule = createRule({ id: "rule-approved-stale" });
        const staleSnapshot = {
            id: existingRule.id,
            branchId,
            name: "바뀐 이름",
            isActive: existingRule.isActive,
            eventType: existingRule.eventType,
            offsetType: existingRule.offsetType,
            offsetDays: existingRule.offsetDays,
            recipientType: existingRule.recipientType,
            templateKey: existingRule.templateKey,
            isDefault: existingRule.isDefault,
            jobsStale: existingRule.jobsStale,
            createdAt: existingRule.createdAt.toISOString(),
            updatedAt: existingRule.updatedAt.toISOString(),
        };
        const targetVersion = (service as unknown as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(existingRule);

        await expect(service.updateRuleApprovedTarget(branchId, existingRule.id, { name: "승인된 변경" }, targetVersion, staleSnapshot))
            .rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });
    });

    describe("rule 대상 고객 상태 / 실패 시 재전송 fields (규칙 메시지-04)", () => {
        const echoUpdate = (ruleRepository: ReturnType<typeof createService>["ruleRepository"]) => {
            ruleRepository.update.mockImplementation(async (_branch: string, updated: MessageTriggerRuleEntity) => updated);
        };

        it("update without the fields leaves both unchanged", async () => {
            const { service, ruleRepository } = createService();
            const rule = createRule({ targetClientStatus: "waiting", retryOnFailure: false });
            ruleRepository.findById.mockResolvedValue(rule);
            echoUpdate(ruleRepository);

            await service.updateRule(branchId, rule.id, { name: "이름만 변경" });

            expect(ruleRepository.update).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ name: "이름만 변경", targetClientStatus: "waiting", retryOnFailure: false }),
                expect.any(Object),
            );
        });

        it("an activation toggle (no fields) leaves both unchanged", async () => {
            const { service, ruleRepository } = createService();
            const rule = createRule({ isActive: false, targetClientStatus: "active", retryOnFailure: false });
            ruleRepository.findById.mockResolvedValue(rule);
            echoUpdate(ruleRepository);

            await service.updateRule(branchId, rule.id, { isActive: true });

            expect(ruleRepository.update).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ targetClientStatus: "active", retryOnFailure: false }),
                expect.any(Object),
            );
        });

        it("update persists the values it is given", async () => {
            const { service, ruleRepository } = createService();
            const rule = createRule();
            ruleRepository.findById.mockResolvedValue(rule);
            echoUpdate(ruleRepository);

            await service.updateRule(branchId, rule.id, { targetClientStatus: "pre_booking", retryOnFailure: false });

            expect(ruleRepository.update).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ targetClientStatus: "pre_booking", retryOnFailure: false }),
                expect.any(Object),
            );
        });

        it.each([
            [{}, "all", true],
            [{ targetClientStatus: "active", retryOnFailure: false }, "active", false],
        ] as const)("create %j persists %s / %s", async (extra, status, retry) => {
            const { service, ruleRepository } = createService();
            const created = createRule({ id: "rule-created" });
            ruleRepository.create.mockResolvedValue(created);
            ruleRepository.findById.mockResolvedValue(created);

            await service.createRule(branchId, {
                name: "신규", eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE, recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING, ...extra,
            });

            expect(ruleRepository.create).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ targetClientStatus: status, retryOnFailure: retry }),
                expect.any(Object),
            );
        });

        it("rejects an unknown status with the validation-failed problem shape (service level)", () => {
            expect(() => validateMessageTriggerRule({
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                targetClientStatus: "completed" as never,
            })).toThrow(BadRequestException);
            expect(() => validateMessageTriggerRule({
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                targetClientStatus: "waiting",
                retryOnFailure: false,
            })).not.toThrow();
        });

        const approvedSnapshot = (rule: MessageTriggerRuleEntity, omit: string[] = []) => {
            const snapshot: Record<string, unknown> = {
                id: rule.id, branchId, name: rule.name, isActive: rule.isActive, eventType: rule.eventType,
                offsetType: rule.offsetType, offsetDays: rule.offsetDays, sendTime: rule.sendTime,
                recipientType: rule.recipientType, templateKey: rule.templateKey, isDefault: rule.isDefault,
                jobsStale: rule.jobsStale, targetClientStatus: rule.targetClientStatus, retryOnFailure: rule.retryOnFailure,
                createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString(),
            };
            for (const key of omit) delete snapshot[key];
            return snapshot;
        };
        const versionOf = (service: unknown, rule: MessageTriggerRuleEntity) =>
            (service as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(rule);

        it("an approved update of the name leaves 대상 고객 상태 and 실패 시 재전송 unchanged", async () => {
            const { service, ruleRepository } = createService();
            const rule = createRule({ id: "rule-approved-fields", targetClientStatus: "waiting", retryOnFailure: false });
            ruleRepository.updateIfTargetMatchesAndFenceJobs.mockImplementation(
                async (_b: string, _expected: MessageTriggerRuleEntity, next: MessageTriggerRuleEntity) => next,
            );

            await service.updateRuleApprovedTarget(
                branchId, rule.id, { name: "승인된 이름 변경" }, versionOf(service, rule), approvedSnapshot(rule),
            );

            expect(ruleRepository.updateIfTargetMatchesAndFenceJobs).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ targetClientStatus: "waiting", retryOnFailure: false }),
                expect.objectContaining({ name: "승인된 이름 변경", targetClientStatus: "waiting", retryOnFailure: false }),
                "Rule updated",
                expect.any(Date),
                expect.any(Object),
            );
        });

        it.each([["targetClientStatus"], ["retryOnFailure"]])(
            "rejects an approval snapshot issued without %s as stale instead of defaulting it",
            async (missing) => {
                const { service, ruleRepository } = createService();
                const rule = createRule({ id: "rule-approved-stale", targetClientStatus: "waiting", retryOnFailure: false });

                await expect(service.updateRuleApprovedTarget(
                    branchId, rule.id, { name: "x" }, versionOf(service, rule), approvedSnapshot(rule, [missing]),
                )).rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });
                expect(ruleRepository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled();
            },
        );

        it("the approval version changes when either field changes", () => {
            const { service } = createService();
            const base = createRule({ id: "rule-version" });
            const versions = new Set([
                versionOf(service, base),
                versionOf(service, createRule({ id: "rule-version", targetClientStatus: "active" })),
                versionOf(service, createRule({ id: "rule-version", retryOnFailure: false })),
            ]);
            expect(versions.size).toBe(3);
        });
    });

    it.each([undefined, "23:59"])("preserves or updates sendTime without losing the generation fence (%s)", async (sendTime) => {
        const { service, ruleRepository, jobRepository } = createService();
        const rule = createRule();
        rule.sendTime = "14:37";
        ruleRepository.findById.mockResolvedValue(rule);
        ruleRepository.update.mockImplementation(async (_branch, updated) => updated);
        await service.updateRule(branchId, rule.id, { name: "시간 검증", ...(sendTime === undefined ? {} : { sendTime }) });
        expect(ruleRepository.update).toHaveBeenCalledWith(branchId, expect.objectContaining({ sendTime: sendTime ?? "14:37" }), expect.any(Object));
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(rule.id, "Rule updated");
    });

    it("updateRule cancels the old generation and reconciles the new generation before returning", async () => {
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
        const staleRule = createRule({
            id: updatedRule.id,
            name: updatedRule.name,
            eventType: updatedRule.eventType,
            offsetType: updatedRule.offsetType,
            offsetDays: updatedRule.offsetDays,
            templateKey: updatedRule.templateKey,
            jobsStale: true,
            updatedAt: new Date("2026-06-01T00:00:01.000Z"),
        });
        const reconciledRule = createRule({
            id: staleRule.id,
            name: staleRule.name,
            eventType: staleRule.eventType,
            offsetType: staleRule.offsetType,
            offsetDays: staleRule.offsetDays,
            templateKey: staleRule.templateKey,
            jobsStale: false,
            updatedAt: staleRule.updatedAt,
        });
        ruleRepository.findById
            .mockResolvedValueOnce(existingRule)
            .mockResolvedValueOnce(staleRule)
            .mockResolvedValueOnce(staleRule)
            .mockResolvedValueOnce(reconciledRule);
        ruleRepository.update.mockResolvedValue(updatedRule);

        const result = await service.updateRule(branchId, existingRule.id, {
            name: "수정된 규칙",
        });

        expect(result).toBe(reconciledRule);
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(
            existingRule.id,
            "Rule updated",
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(
            branchId,
            existingRule.id,
            expect.any(Object),
        );
        expect(jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
            branchId,
            staleRule.id,
            staleRule.updatedAt,
            true,
            "규칙 재생성",
            expect.any(Object),
            expect.any(Object),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(
            branchId,
            staleRule,
            false,
            expect.any(Object),
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
            expect.any(Object),
        );
    });

    it.each([
        [MessageTriggerEventType.CLIENT_CREATED, MessageTriggerOffsetType.IMMEDIATE, MessageTriggerTemplateKey.CLIENT_GREETING],
        [MessageTriggerEventType.EMPLOYEE_ASSIGNED, MessageTriggerOffsetType.IMMEDIATE, MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED],
    ])("preserves needs_setup on saving a non-rebuilt %s rule", async (eventType, offsetType, templateKey) => {
        const { service, ruleRepository, jobRepository } = createService();
        const rule = createRule({ eventType, offsetType, templateKey, recipientType: eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED
            ? MessageTriggerRecipientType.PRIMARY_EMPLOYEE : MessageTriggerRecipientType.CLIENT, jobsStale: true });
        const waiting = createJob({ ruleId: rule.id, status: "needs_setup" });
        ruleRepository.findById.mockResolvedValue(rule);
        ruleRepository.update.mockResolvedValue(rule);
        jobRepository.cancelPendingForRuleGeneration.mockImplementation(async (
            _branchId: string, _ruleId: string, _updatedAt: Date, _stale: boolean, _reason: string, scope?: MessageTriggerJobCancellationScope,
        ) => {
            if (scope?.needsSetup) waiting.cancel("unexpected supersession");
            return 0;
        });
        if (eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED) {
            // 이 레거시 종류는 현재 편집 validator에서 거부되지만 stale rebuild는 여전히 처리한다.
            ruleRepository.findStaleRules.mockResolvedValue([rule]);
            await (service as unknown as ServiceInternals).processStaleRuleRebuilds();
        } else {
            await service.updateRule(branchId, rule.id, { name: "수정된 규칙" });
        }
        expect(waiting.status).toBe("needs_setup");
        expect(jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledTimes(eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED ? 1 : 2);
        for (const call of jobRepository.cancelPendingForRuleGeneration.mock.calls) expect(call[5]?.needsSetup).toBeUndefined();
    });

    it.each(["deactivated", "parent disabled"])("supersedes needs_setup when its rule is %s", async (source) => {
        const { service, ruleRepository, jobRepository, messageAutomationActivationService } = createDispatchService();
        const rule = createRule({ jobsStale: true, isActive: source !== "deactivated", offsetType: MessageTriggerOffsetType.IMMEDIATE });
        const waiting = createJob({ status: "needs_setup" });
        ruleRepository.findStaleRules.mockResolvedValue([rule]);
        messageAutomationActivationService.getTriggerDispatchEnabled.mockResolvedValue(source !== "parent disabled");
        jobRepository.cancelPendingForRuleGeneration.mockImplementation(async (
            _branchId: string, _ruleId: string, _updatedAt: Date, _stale: boolean, reason: string, scope?: MessageTriggerJobCancellationScope,
        ) => {
            if (scope?.needsSetup === "all") waiting.cancel(reason);
            return 1;
        });
        await (service as unknown as ServiceInternals).processStaleRuleRebuilds();
        expect(waiting.status).toBe("canceled");
    });

    it("uses branch-scoped CAS hooks for approved automation updates and deletes", async () => {
        const { service, ruleRepository, jobRepository } = createService();
        const existingRule = createRule({ id: "rule-approved-target" });
        const updatedRule = createRule({ id: existingRule.id, name: "승인된 변경" });
        const snapshot = {
            id: existingRule.id,
            branchId,
            name: existingRule.name,
            isActive: existingRule.isActive,
            eventType: existingRule.eventType,
            offsetType: existingRule.offsetType,
            offsetDays: existingRule.offsetDays,
            sendTime: existingRule.sendTime,
            recipientType: existingRule.recipientType,
            templateKey: existingRule.templateKey,
            isDefault: existingRule.isDefault,
            jobsStale: existingRule.jobsStale,
            targetClientStatus: existingRule.targetClientStatus,
            retryOnFailure: existingRule.retryOnFailure,
            createdAt: existingRule.createdAt.toISOString(),
            updatedAt: existingRule.updatedAt.toISOString(),
        };
        const targetVersion = (service as unknown as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(existingRule);
        ruleRepository.updateIfTargetMatchesAndFenceJobs.mockResolvedValue(updatedRule);
        ruleRepository.deleteIfTargetMatchesAndFenceJobs.mockResolvedValue(true);

        await expect(service.updateRuleApprovedTarget(branchId, existingRule.id, { name: "승인된 변경" }, targetVersion, snapshot))
            .resolves.toBe(updatedRule);
        expect(ruleRepository.updateIfTargetMatchesAndFenceJobs).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ id: existingRule.id }),
            expect.objectContaining({ name: "승인된 변경" }),
            "Rule updated",
            expect.any(Date),
            expect.any(Object),
        );
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalledWith(existingRule.id, "Rule updated");

        await expect(service.deleteRuleApprovedTarget(branchId, existingRule.id, targetVersion, snapshot)).resolves.toBeUndefined();
        expect(ruleRepository.deleteIfTargetMatchesAndFenceJobs).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ id: existingRule.id }),
            "Rule deleted",
            expect.any(Date),
        );
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalledWith(existingRule.id, "Rule deleted");
    });

    it("does not call the provider when an approved rule update linearizes before a dispatcher claim", async () => {
        const mutation = createService();
        const dispatcher = createDispatchService();
        const existingRule = createRule({ id: "rule-interleaving" });
        const updatedRule = createRule({ id: existingRule.id, name: "원자 변경", jobsStale: true });
        const snapshot = {
            id: existingRule.id,
            branchId,
            name: existingRule.name,
            isActive: existingRule.isActive,
            eventType: existingRule.eventType,
            offsetType: existingRule.offsetType,
            offsetDays: existingRule.offsetDays,
            sendTime: existingRule.sendTime,
            recipientType: existingRule.recipientType,
            templateKey: existingRule.templateKey,
            isDefault: existingRule.isDefault,
            jobsStale: existingRule.jobsStale,
            targetClientStatus: existingRule.targetClientStatus,
            retryOnFailure: existingRule.retryOnFailure,
            createdAt: existingRule.createdAt.toISOString(),
            updatedAt: existingRule.updatedAt.toISOString(),
        };
        const targetVersion = (mutation.service as unknown as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(existingRule);
        const job = createJob({ id: "job-interleaving", ruleId: existingRule.id });
        dispatcher.jobRepository.findByIdInBranch.mockResolvedValue(job);
        let mutationWon = false;
        const mutationEntered = new Promise<void>((resolve) => {
            mutation.ruleRepository.updateIfTargetMatchesAndFenceJobs.mockImplementation(async () => {
                mutationWon = true;
                resolve();
                return updatedRule;
            });
        });
        dispatcher.jobRepository.claimPendingWithRuleFence.mockImplementation(async () => mutationWon ? null : "claim-a");

        const updatePromise = mutation.service.updateRuleApprovedTarget(
            branchId,
            existingRule.id,
            { name: "원자 변경" },
            targetVersion,
            snapshot,
        );
        await mutationEntered;
        await dispatcher.service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });
        await expect(updatePromise).resolves.toBe(updatedRule);

        expect(dispatcher.jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(
            job.id,
            job.branchId,
            expect.any(Object),
        );
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
    });

    it("reactivates cleanup-deactivated default rules once their branch is approved and marks them stale", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const approvedAt = new Date("2026-06-05T00:00:00.000Z");
        const inactiveDefault = createRule({
            id: "rule-default-approved",
            isActive: false,
            isDefault: true,
            branchId,
            updatedAt: new Date("2026-06-04T00:00:00.000Z"),
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map([[branchId, approvedAt]]));
        ruleRepository.update.mockResolvedValue(inactiveDefault);

        await internals.recoverApprovedBranches();

        expect(ruleRepository.findInactiveDefaultRules).toHaveBeenCalledWith(50);
        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(inactiveDefault.isActive).toBe(true);
        expect(ruleRepository.update).toHaveBeenCalledWith(
            branchId,
            inactiveDefault,
            expect.any(Object),
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(
            inactiveDefault.branchId,
            inactiveDefault.id,
            expect.any(Object),
        );
    });

    it("keeps a recovered default inactive when its required custom variable has no automatic source", async () => {
        const {
            internals,
            ruleRepository,
            messageSenderApprovalService,
            systemTemplateService,
        } = createService();
        const approvedAt = new Date("2026-06-05T00:00:00.000Z");
        const inactiveDefault = createRule({
            id: "rule-default-unsupported-variable",
            isActive: false,
            isDefault: true,
            branchId,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-04T00:00:00.000Z"),
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map([[branchId, approvedAt]]));
        systemTemplateService.getByKeyForBranch.mockResolvedValue({
            id: "template-service-info",
            templateKey: "SERVICE_INFO",
            customVariables: [
                { key: "reservationCode", label: "예약 코드", required: true },
            ],
        });

        await internals.recoverApprovedBranches();

        expect(inactiveDefault.isActive).toBe(false);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
    });

    it("does not reactivate a default rule disabled after branch approval", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const approvedAt = new Date("2026-06-05T00:00:00.000Z");
        const adminDisabledDefault = createRule({
            id: "rule-default-admin-disabled",
            isActive: false,
            isDefault: true,
            branchId,
            updatedAt: new Date("2026-06-06T00:00:00.000Z"),
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([adminDisabledDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map([[branchId, approvedAt]]));

        await internals.recoverApprovedBranches();

        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        expect(adminDisabledDefault.isActive).toBe(false);
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
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map());

        await internals.recoverApprovedBranches();

        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        expect(inactiveDefault.isActive).toBe(false);
    });

    it("does not enqueue jobs for existing clients when an IMMEDIATE CLIENT_GREETING rule is created", async () => {
        // Do NOT spy on rebuildJobsForRule — let the real guard run.
        const jobRepository = {
            upsertPending: jest.fn(),
            upsertPendingForRuleGeneration: jest.fn(),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,  // prisma — should not be reached past the IMMEDIATE guard
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            messageLogRepository as never,
            createSystemTemplateService() as never,
            createTemplateAutomationLock() as never,
            undefined,
            createOverrideRepository() as never,
            createAutomationActivationService() as never,
            createBranchLock() as never,
        undefined, createLegacyAutomationDeliveryGate({} as never, createBranchLock() as never));

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

    it("cancelJobByUser cancels a pending job scoped to the caller's branch and returns the canceled status", async () => {
        const { service, jobRepository } = createService();

        await expect(service.cancelJobByUser(branchId, "job-1")).resolves.toEqual({
            id: "job-1",
            status: "canceled",
        });
        expect(jobRepository.cancelPendingByUser).toHaveBeenCalledWith(
            "job-1",
            branchId,
            "사용자가 발송을 취소함",
        );
    });

    it("cancelJobByUser rejects with a conflict when the repository finds no cancelable pending job (already sent, processing, already canceled, or missing)", async () => {
        const { service, jobRepository } = createService();
        jobRepository.cancelPendingByUser.mockResolvedValue(false);

        const failure: ConflictException = await service
            .cancelJobByUser(branchId, "job-1")
            .catch((error) => error);

        expect(failure).toBeInstanceOf(ConflictException);
        expect(failure.message).toBe("이미 발송되었거나 취소할 수 없는 상태입니다");
        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toMatchObject({ code: "REQUEST_CONFLICT" });
    });

    describe("rescheduleJobForDebug", () => {
        const future = () => new Date(Date.now() + 5 * 60 * 1000);
        const rescheduleFixture = (jobOverrides: Parameters<typeof createJob>[0] = {}) => {
            const fx = createService();
            const job = createJob({ id: "job-1", status: "pending", scheduledFor: new Date("2099-06-01T00:00:00.000Z"), ...jobOverrides });
            const jobRepository = Object.assign(fx.jobRepository, {
                findByIdInBranch: jest.fn().mockResolvedValue(job),
                rescheduleDebugPending: jest.fn().mockResolvedValue(true),
            });
            const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            return { ...fx, job, jobRepository, warn };
        };
        afterEach(() => jest.restoreAllMocks());

        it("moves a pending job in the caller's branch, logs once and returns the new time", async () => {
            const { service, job, jobRepository, warn } = rescheduleFixture();
            const target = future();

            await expect(service.rescheduleJobForDebug(branchId, "job-1", target, "user-9")).resolves.toEqual({
                id: "job-1",
                status: "pending",
                scheduledFor: target.toISOString(),
            });
            expect(jobRepository.findByIdInBranch).toHaveBeenCalledWith(branchId, "job-1");
            expect(jobRepository.rescheduleDebugPending).toHaveBeenCalledWith("job-1", branchId, target);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(
                `[debug] message trigger job job-1 rescheduled ${job.scheduledFor.toISOString()} -> ${target.toISOString()} by user-9`,
            );
        });

        it.each([
            ["the past", () => new Date(Date.now() - 1000)],
            ["now", () => new Date()],
            ["30 seconds ahead", () => new Date(Date.now() + 30_000)],
            ["exactly 60 seconds ahead", () => new Date(Date.now() + 60_000)],
            ["an invalid date", () => new Date("nope")],
        ])("rejects %s with 400 before touching the repository", async (_label, makeTime) => {
            const { service, jobRepository, warn } = rescheduleFixture();

            const failure = await service.rescheduleJobForDebug(branchId, "job-1", makeTime(), "user-9").catch((e) => e);

            expect(failure).toBeInstanceOf(BadRequestException);
            expect(jobRepository.findByIdInBranch).not.toHaveBeenCalled();
            expect(jobRepository.rescheduleDebugPending).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        });

        it("answers 404 when the job is not in the caller's branch", async () => {
            const { service, jobRepository, warn } = rescheduleFixture();
            jobRepository.findByIdInBranch.mockResolvedValue(null);

            const failure = await service.rescheduleJobForDebug("other-branch", "job-1", future(), "user-9").catch((e) => e);

            expect(failure).toBeInstanceOf(NotFoundException);
            expect(jobRepository.findByIdInBranch).toHaveBeenCalledWith("other-branch", "job-1");
            expect(jobRepository.rescheduleDebugPending).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        });

        it.each(["processing", "sent", "canceled", "failed", "needs_setup"] as const)(
            "answers 409 for a %s job without updating it",
            async (status) => {
                const { service, jobRepository, warn } = rescheduleFixture({ status });

                const failure = await service.rescheduleJobForDebug(branchId, "job-1", future(), "user-9").catch((e) => e);

                expect(failure).toBeInstanceOf(ConflictException);
                expect(failure.getStatus()).toBe(409);
                expect(jobRepository.rescheduleDebugPending).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
            },
        );

        it.each([
            ["already due", () => new Date(Date.now() - 60_000)],
            ["due in 30 seconds", () => new Date(Date.now() + 30_000)],
            ["due in exactly 60 seconds", () => new Date(Date.now() + 60_000)],
        ])("answers 409 with the too-soon message for a pending job that is %s, without updating it", async (_label, makeTime) => {
            const { service, jobRepository, warn } = rescheduleFixture({ scheduledFor: makeTime() });

            const failure = await service.rescheduleJobForDebug(branchId, "job-1", future(), "user-9").catch((e) => e);

            expect(failure).toBeInstanceOf(ConflictException);
            expect(failure.getStatus()).toBe(409);
            expect(failure.message).toContain("곧 발송될 예정");
            expect(jobRepository.rescheduleDebugPending).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        });

        it.each([
            ["a sealed agent-automation job", { payload: { memberId: "m", agentAutomationSeal: { digest: "x" } } }],
            ["a job whose seal key is null", { payload: { memberId: "m", agentAutomationSeal: null } }],
            ["a manual agent-sms job (rule prefix)", { ruleId: "agent-sms:abc" }],
            ["a manual agent-sms retry job (dedupe prefix)", { dedupeKey: "agent-sms-retry:1" }],
        ] as const)("answers 409 with the automatic-rules-only message for %s, without updating it", async (_label, overrides) => {
            const { service, jobRepository, warn } = rescheduleFixture(overrides as Parameters<typeof createJob>[0]);

            const failure = await service.rescheduleJobForDebug(branchId, "job-1", future(), "user-9").catch((e) => e);

            expect(failure).toBeInstanceOf(ConflictException);
            expect(failure.getStatus()).toBe(409);
            expect(failure.message).toBe("자동 발송 규칙으로 만든 대기 문자만 시간을 바꿀 수 있어요.");
            expect(jobRepository.rescheduleDebugPending).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
        });

        it("moves a pending job that is just over a minute from due", async () => {
            const { service, jobRepository } = rescheduleFixture({ scheduledFor: new Date(Date.now() + 61_000) });

            await expect(service.rescheduleJobForDebug(branchId, "job-1", future(), "user-9")).resolves.toMatchObject({ status: "pending" });
            expect(jobRepository.rescheduleDebugPending).toHaveBeenCalledTimes(1);
        });

        it("answers 409 and does not log when the conditional update loses a race (count 0)", async () => {
            const { service, jobRepository, warn } = rescheduleFixture();
            jobRepository.rescheduleDebugPending.mockResolvedValue(false);

            const failure = await service.rescheduleJobForDebug(branchId, "job-1", future(), "user-9").catch((e) => e);

            expect(failure).toBeInstanceOf(ConflictException);
            expect(failure.getResponse()).toMatchObject({ code: "REQUEST_CONFLICT" });
            expect(warn).not.toHaveBeenCalled();
        });
    });

    it("cancelJobByUser scopes the cancel to the caller's branch, so a job from another branch is refused", async () => {
        const { service, jobRepository } = createService();
        jobRepository.cancelPendingByUser.mockResolvedValueOnce(false);

        await expect(service.cancelJobByUser("other-branch", "job-1")).rejects.toBeInstanceOf(ConflictException);
        expect(jobRepository.cancelPendingByUser).toHaveBeenCalledWith(
            "job-1",
            "other-branch",
            "사용자가 발송을 취소함",
        );
    });

    it("skips a job whose claim was lost to another instance", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        jobRepository.claimPendingWithRuleFence.mockResolvedValue(false);

        await service.dispatchDueJobs();

        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(
            job.id,
            job.branchId,
            expect.any(Object),
        );
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it("marks a job sent without calling the provider when a sent message_log exists", async () => {
        const { service, deliveryService, jobRepository, messageLogRepository } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set([job.id]));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch cancels a claimed job whose branch is unapproved without calling the provider", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set());

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(
            job.id,
            job.branchId,
            expect.any(Object),
        );
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("메시지 발송 승인 필요");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch sends normally for approved branches", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("cancels a queued automatic service-end notice when the client was already notified", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            clientId: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: "rule-service-end-notice:client:7:CLIENT:2026-09-16T03:00:00.000Z",
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.transaction.$queryRaw
            .mockResolvedValueOnce([{ service_end_notice_sent_at: new Date("2026-09-15T03:00:00.000Z") }])
            .mockResolvedValueOnce([{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }])
            .mockResolvedValueOnce([{ id: job.id }]);

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("서비스 종료 안내가 이미 발송됨");
    });

    it("still allows an explicitly requested manual service-end notice", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            clientId: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: "system:service_end_notice:client:7:manual:request-1",
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
    });

    it("blocks an already-sent automatic service-end notice before receipt-link preparation", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            clientId: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: "rule-service-end-notice:client:7:CLIENT:2026-09-16T03:00:00.000Z",
        });
        const prepareJob = jest.fn();
        const sendPreparedJob = jest.fn();
        Object.assign(dispatcher.deliveryService, { prepareJob, sendPreparedJob });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.transaction.$queryRaw.mockResolvedValueOnce([{
            service_end_notice_sent_at: new Date("2026-09-15T03:00:00.000Z"),
        }]);

        await dispatcher.service.dispatchDueJobs();

        expect(prepareJob).not.toHaveBeenCalled();
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("서비스 종료 안내가 이미 발송됨");
    });

    it("leaves initial pending jobs untouched while branch dispatch is disabled", async () => {
        const systemSettingService = {
            getMessageSettingsPolicyEnabled: jest.fn().mockResolvedValue(false),
        };
        const { service, deliveryService, jobRepository, messageAutomationActivationService } = createDispatchService(systemSettingService);
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        messageAutomationActivationService.getTriggerDispatchEnabled.mockResolvedValue(false);

        await service.dispatchDueJobs();

        expect(messageAutomationActivationService.getTriggerDispatchEnabled).toHaveBeenCalledWith(branchId);
        expect(jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("pending");
    });

    it("leaves retry jobs pending while only trigger retry is disabled", async () => {
        const systemSettingService = {
            getMessageSettingsPolicyEnabled: jest.fn(async (
                _branchId: string,
                policyId: string,
            ) => policyId !== "trigger-job-retry"),
        };
        const { service, deliveryService, jobRepository } = createDispatchService(systemSettingService);
        const job = createJob({ attempts: 1, nextAttemptAt: new Date() });
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

        await service.dispatchDueJobs();

        expect(jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("pending");
    });

    it("drops past-due catch-up candidates while past-trigger handling is disabled", async () => {
        const systemSettingService = {
            getMessageSettingsPolicyEnabled: jest.fn().mockResolvedValue(false),
        };
        const { internals } = createService(systemSettingService);
        const past = { rule: createRule(), job: createJob({ scheduledFor: new Date(Date.now() - 1_000) }) };
        const future = { rule: createRule({ id: "rule-2" }), job: createJob({ id: "job-2", scheduledFor: new Date(Date.now() + 60_000) }) };

        await expect(
            internals.applyRetroactiveSendConfig(branchId, [past, future]),
        ).resolves.toEqual([future]);
        expect(systemSettingService.getMessageSettingsPolicyEnabled).toHaveBeenCalledWith(
            branchId,
            "past-trigger",
        );
    });

    it("keeps a post-CAS admission refusal dispatching for uncertain reconciliation", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob(); jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        deliveryService.sendPreparedJob.mockRejectedValue(new AgentAutomationDispatchUncertainError());
        await service.dispatchDueJobs();
        expect(job.status).toBe("dispatching");
        expect(job.attempts).toBe(0); expect(job.nextAttemptAt).toBeNull();
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        // Only the pre-CAS prepared snapshot is written, never the stale result.
        expect(jobRepository.update).toHaveBeenCalledTimes(1);
    });

    it("refuses the automatic one-step compatibility path before provider authorization", async () => {
        const { service, deliveryService, jobRepository, transaction } = createDispatchService();
        Object.assign(deliveryService, { prepareJob: undefined, sendPreparedJob: undefined });
        const job = createJob(); jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        await service.dispatchDueJobs();
        expect(job.status).toBe("canceled");
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(transaction.$queryRaw).not.toHaveBeenCalled();
    });

    it("persists preparation before authorization and sends only the frozen snapshot", async () => {
        const dispatcher = createDispatchService();
        const job = createJob();
        const events: string[] = [];
        const serializedSnapshot = "prepared-snapshot";
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
        dispatcher.jobRepository.update.mockImplementation(async () => {
            events.push("persist-preparation");
            return job;
        });
        const preparedDelivery = dispatcher.deliveryService as typeof dispatcher.deliveryService & {
            prepareJob: jest.Mock;
            sendPreparedJob: jest.Mock;
        };
        const preparation = {
            snapshot: { snapshotHash: "snapshot-hash" },
            serializedSnapshot,
        };
        preparedDelivery.prepareJob = jest.fn(async (jobArg: MessageTriggerJobEntity) => {
            events.push("prepare");
            jobArg.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = serializedSnapshot;
            return preparation;
        });
        preparedDelivery.sendPreparedJob = jest.fn(async () => {
            events.push("send-prepared");
            return true;
        });
        dispatcher.deliveryService.sendJob.mockImplementation(async () => {
            events.push("legacy-send");
            return true;
        });
        let queryCount = 0;
        dispatcher.transaction.$queryRaw.mockImplementation(async () => {
            queryCount += 1;
            events.push(
                queryCount === 1
                    ? "preparation-claim-read"
                    : queryCount === 2
                        ? "claim-read"
                        : "authorize-cas",
            );
            return queryCount === 1 || queryCount === 2
                ? [{
                    status: "processing",
                    claim_token: "claim-a",
                    payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: serializedSnapshot } },
                }]
                : [{ id: job.id }];
        });

        await dispatcher.service.dispatchDueJobs();

        expect(events).toEqual([
            "preparation-claim-read",
            "prepare",
            "persist-preparation",
            "claim-read",
            "authorize-cas",
            "send-prepared",
            "persist-preparation",
        ]);
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(preparedDelivery.sendPreparedJob).toHaveBeenCalledWith(job, preparation);
        expect(job.status).toBe("sent");
    });

    it("does not prepare a legacy receipt when its claim is lost before preparation", async () => {
        const dispatcher = createDispatchService();
        const job = createJob();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
        const prepareJob = jest.fn().mockResolvedValue({
            snapshot: { snapshotHash: "must-not-prepare" },
            serializedSnapshot: "must-not-prepare",
        });
        const sendPreparedJob = jest.fn().mockResolvedValue(true);
        Object.assign(dispatcher.deliveryService, { prepareJob, sendPreparedJob });
        dispatcher.transaction.$queryRaw.mockResolvedValueOnce([{
            status: "canceled",
            claim_token: null,
        }]);

        await dispatcher.service.dispatchDueJobs();

        expect(prepareJob).not.toHaveBeenCalled();
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(dispatcher.jobRepository.update).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: "already stale synchronization",
            expectedDocumentSyncStatus: "pending" as const,
            expectedReason: "revision_or_business_state_changed",
        },
        {
            name: "revision capability is unverified",
            expectedDocumentSyncStatus: "completed" as const,
            expectedReason: "SERVICE_RECORD_DOCUMENT_SYNC_UNVERIFIED",
        },
    ])("rejects $name before receipt preparation", async ({
        expectedDocumentSyncStatus,
        expectedReason,
    }) => {
        const dispatcher = createDispatchService();
        const businessFingerprint = createHash("sha256").update("{}").digest("hex");
        const expectedContext = {
            branchId,
            clientId: 1,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-1",
            revisionNumber: 1,
            businessFingerprint,
            plannedSessionCount: 1,
            plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-10" }],
            documentSyncStatus: expectedDocumentSyncStatus,
            lifecycleStatus: "ACTIVE",
            formVersion: 1,
        };
        const job = createJob({
            payload: {
                memberId: "member-1",
                recipientName: "김산모",
                recipientPhone: "010-1234-5678",
                templateVariables: {},
                serviceRecordRevisionContext: expectedContext,
            },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
        const prepareJob = jest.fn().mockResolvedValue({
            snapshot: { snapshotHash: "must-not-prepare" },
            serializedSnapshot: "must-not-prepare",
        });
        const sendPreparedJob = jest.fn().mockResolvedValue(true);
        Object.assign(dispatcher.deliveryService, { prepareJob, sendPreparedJob });

        const currentCase = {
            id: "case-1",
            branchId,
            clientId: 1,
            requiredSessionCount: 1,
            plannedSessions: expectedContext.plannedSessionDates,
            currentRevisionId: "revision-1",
            currentUsableRevisionId: "revision-1",
            currentUsableDocumentVersion: 1,
            formVersion: 1,
            status: "ACTIVE",
        };
        const transaction = dispatcher.transaction as unknown as {
            $queryRaw: jest.Mock;
            service_record_case: { findUnique: jest.Mock };
            service_record_revision: { findUnique: jest.Mock };
        };
        transaction.service_record_case = {
            findUnique: jest.fn().mockResolvedValue(currentCase),
        };
        transaction.service_record_revision = {
            findUnique: jest.fn().mockResolvedValue({ revisionNumber: 1, payload: {} }),
        };
        let queryCount = 0;
        transaction.$queryRaw.mockImplementation(async () => {
            queryCount += 1;
            if (queryCount === 1) return [{ id: 1 }]; // client lock
            if (queryCount === 2) return [{ id: "case-1" }]; // case lock
            if (queryCount === 3 || queryCount === 4) return []; // assignments/days
            if (queryCount === 5) {
                return [{
                    payload: {
                        revisionId: "revision-1",
                        completeness: "complete",
                        manualReviewRequired: false,
                    },
                    payload_fingerprint: "b".repeat(64),
                    status: "completed",
                    progress_step: "sent",
                }];
            }
            throw new Error(`unexpected query ${queryCount}`);
        });

        await dispatcher.service.dispatchDueJobs();

        expect(prepareJob).not.toHaveBeenCalled();
        expect(sendPreparedJob).not.toHaveBeenCalled();
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe(expectedReason);
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("derives the observed document sync state from the locked revision job", async () => {
        const service = createDispatchService().service;
        const internals = service as unknown as ServiceInternals;
        const revisionPayload = {};
        const businessFingerprint = createHash("sha256").update("{}").digest("hex");
        const expectedContext = {
            branchId,
            clientId: 1,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-1",
            revisionNumber: 1,
            businessFingerprint,
            plannedSessionCount: 1,
            plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-10" }],
            documentSyncStatus: "pending" as const,
            lifecycleStatus: "ACTIVE",
            formVersion: 1,
        };
        const job = createJob({
            clientId: 1,
            payload: {
                memberId: "member-1",
                recipientName: "김산모",
                recipientPhone: "010-1234-5678",
                templateVariables: {},
                serviceRecordRevisionContext: expectedContext,
            },
        });
        const currentCase = {
            id: "case-1",
            branchId,
            clientId: 1,
            requiredSessionCount: 1,
            plannedSessions: expectedContext.plannedSessionDates,
            currentRevisionId: "revision-1",
            currentUsableRevisionId: "revision-1",
            currentUsableDocumentVersion: 1,
            formVersion: 1,
            status: "ACTIVE",
        };
        let rawQueryCount = 0;
        const transaction = {
            $queryRaw: jest.fn().mockImplementation(async () => {
                rawQueryCount += 1;
                if (rawQueryCount === 1) return [{ id: 1 }]; // client lock
                if (rawQueryCount === 2) return [{ id: "case-1" }]; // case lock
                if (rawQueryCount === 3 || rawQueryCount === 4) return []; // assignments/days
                return [{
                    payload: {
                        revisionId: "revision-1",
                        completeness: "complete",
                        manualReviewRequired: false,
                    },
                    payload_fingerprint: "b".repeat(64),
                    status: "completed",
                    progress_step: "sent",
                }];
            }),
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(currentCase),
            },
            service_record_revision: {
                findUnique: jest.fn().mockResolvedValue({ revisionNumber: 1, payload: revisionPayload }),
            },
        };

        const result = await internals.fenceServiceRecordRevisionBeforeProviderSend(
            job,
            transaction as unknown as Prisma.TransactionClient,
        );

        // The expected context says pending, but the locked durable job is
        // already completed. The previous implementation copied the expected
        // status into `observed` and incorrectly allowed the send.
        expect(result).toEqual({ kind: "stale", reason: "revision_or_business_state_changed" });
    });

    it("does not call the provider when cancellation invalidates a claim before the fence", async () => {
        const { service, deliveryService, jobRepository, transaction } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        jobRepository.claimPendingWithRuleFence.mockResolvedValue("claim-a");
        transaction.$queryRaw.mockResolvedValueOnce([{
            status: "canceled",
            claim_token: null,
        }]);

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it("does not call the provider when a newer claim token replaced the active attempt", async () => {
        const { service, deliveryService, jobRepository, transaction } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        jobRepository.claimPendingWithRuleFence.mockResolvedValue("claim-a");
        transaction.$queryRaw.mockResolvedValueOnce([{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } },
            status: "processing",
            claim_token: "claim-b",
        }]);

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it("does not call the provider when cancellation wins the authorization CAS", async () => {
        const { service, deliveryService, jobRepository, transaction } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        jobRepository.claimPendingWithRuleFence.mockResolvedValue("claim-a");
        let authorizationReadStarted!: () => void;
        const authorizationRead = new Promise<void>((resolve) => {
            authorizationReadStarted = resolve;
        });
        let releaseAuthorizationRead!: () => void;
        const authorizationReadReleased = new Promise<void>((resolve) => {
            releaseAuthorizationRead = resolve;
        });
        let cancellationWon = false;
        let queryCount = 0;
        transaction.$queryRaw.mockImplementation(async () => {
            queryCount += 1;
            if (queryCount === 1) { return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }]; }
            if (queryCount === 2) {
                authorizationReadStarted();
                await authorizationReadReleased;
                return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }];
            }
            return cancellationWon ? [] : [{ id: job.id }];
        });

        const dispatchPromise = service.dispatchDueJobs();
        await authorizationRead;
        cancellationWon = true;
        // Release the mocked claim read only after the concurrent cancellation
        // has committed; the following CAS must therefore return no row.
        releaseAuthorizationRead();
        await dispatchPromise;

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).toHaveBeenCalledTimes(1); // Only the pre-CAS snapshot write.
        expect(job.status).toBe("processing");
    });

    it("dispatchPendingJobNow claims and sends only the requested job, fetching through the required branch-scoped read", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob({ id: "manual-job" });
        jobRepository.findByIdInBranch.mockResolvedValue(job);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));

        const result = await service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });

        expect(jobRepository.findByIdInBranch).toHaveBeenCalledWith(job.branchId, job.id);
        expect(jobRepository.findDuePendingSystemScope).not.toHaveBeenCalled();
        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(
            job.id,
            job.branchId,
            expect.any(Object),
        );
        expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(result.status).toBe("sent");
    });

    describe("service-record link token fence before the dispatching CAS", () => {
        const linkJob = (dedupeKey: string, payloadOverrides: Record<string, unknown> = {}) => createJob({
            id: "link-job",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            employeeScheduleId: 10,
            dedupeKey,
            payload: {
                memberId: "employee:30",
                recipientName: "제공인력",
                recipientPhone: "010-1234-5678",
                buttonUrl: "https://mobile.test/service-record/efl_link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" },
                ...payloadOverrides,
            } as MessageTriggerJobEntity["payload"],
        });
        const isSql = (query: unknown, fragment: string) => {
            const strings = (query as { strings?: readonly string[] }).strings?.join("?") ?? "";
            return strings.includes(fragment);
        };
        /** Routes the authorization transaction's statements: the token read answers `tokenRows`. */
        const route = (transaction: { $queryRaw: jest.Mock }, tokenRows: unknown[], job: MessageTriggerJobEntity) => {
            const seen: string[] = [];
            transaction.$queryRaw.mockImplementation(async (query: unknown) => {
                if (isSql(query, "service_record_token")) { seen.push("token"); return tokenRows; }
                if (isSql(query, "SET status = 'canceled'")) { seen.push("cancel"); return [{ id: job.id }]; }
                if (isSql(query, "SET status = 'dispatching'")) { seen.push("dispatching"); return [{ id: job.id }]; }
                seen.push("claim");
                return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }];
            });
            return seen;
        };

        it.each([
            ["a manual link job", "system:service_record_link:schedule:10:primary:manual:abc"],
            ["an agent retry copy of a failed link job", "agent-sms-retry:action-1"],
        ])("cancels %s whose token is revoked instead of dispatching it", async (_label, dedupeKey) => {
            const { service, deliveryService, jobRepository, transaction, messageSenderApprovalService } = createDispatchService();
            const job = linkJob(dedupeKey);
            jobRepository.findByIdInBranch.mockResolvedValue(job);
            messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
            const seen = route(transaction, [], job);

            const result = await service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });

            expect(seen).toEqual(["claim", "claim", "token", "cancel"]);
            expect(seen).not.toContain("dispatching");
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(result.status).toBe("canceled");
            expect(result.cancelReason).toBe("제공기록지 링크가 철회되어 발송하지 않았습니다");
        });

        it("dispatches as before when the token row is active (read after the job lock, before the CAS)", async () => {
            const { service, deliveryService, jobRepository, transaction, messageSenderApprovalService } = createDispatchService();
            const job = linkJob("agent-sms-retry:action-2");
            jobRepository.findByIdInBranch.mockResolvedValue(job);
            messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
            const seen = route(transaction, [{ id: "token-row" }], job);

            const result = await service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });

            expect(seen).toEqual(["claim", "claim", "token", "dispatching"]);
            expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
            expect(result.status).toBe("sent");
        });

        it("fails closed when the job carries no readable link", async () => {
            const { service, deliveryService, jobRepository, transaction, messageSenderApprovalService } = createDispatchService();
            const job = linkJob("agent-sms-retry:action-3", { buttonUrl: null, templateVariables: {} });
            jobRepository.findByIdInBranch.mockResolvedValue(job);
            messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
            const seen = route(transaction, [{ id: "token-row" }], job);

            const result = await service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });

            expect(seen).toEqual(["claim", "claim", "cancel"]);
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(result.status).toBe("canceled");
        });

        it("does not read the token table for other templates", async () => {
            const { service, jobRepository, transaction, messageSenderApprovalService } = createDispatchService();
            const job = createJob({ id: "other-job" });
            jobRepository.findByIdInBranch.mockResolvedValue(job);
            messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
            const seen = route(transaction, [], job);

            await service.dispatchPendingJobNow(job.id, { expectedBranchId: job.branchId! });

            expect(seen).not.toContain("token");
        });
    });

    it("dispatchPendingJobNow fails not-found when the job does not belong to the expected branch", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        jobRepository.findByIdInBranch.mockResolvedValue(null);

        await expect(
            service.dispatchPendingJobNow("manual-job", { expectedBranchId: "some-other-branch" }),
        ).rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });

        expect(jobRepository.findByIdInBranch).toHaveBeenCalledWith("some-other-branch", "manual-job");
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
    });

    // Send-time SMS automation safeguard: rule + recipient flag + branch switch.
    interface SafeguardWorld {
        ruleActive: boolean;
        /** Per client id; an id absent from the map answers `clientDefault`. */
        clientFlags: Map<number, boolean>;
        clientDefault: boolean;
        employeeEnabled: boolean;
        phoneClientDisabled: boolean;
        branchOn: boolean;
    }
    const attachSafeguard = (
        fx: ReturnType<typeof createDispatchService>,
        overrides: Partial<SafeguardWorld> = {},
    ) => {
        const world: SafeguardWorld = {
            ruleActive: true, clientFlags: new Map(), clientDefault: true, employeeEnabled: true,
            phoneClientDisabled: false, branchOn: true, ...overrides,
        };
        const models = {
            message_trigger_rule: { findFirst: jest.fn(async () => ({ isActive: world.ruleActive, branchId })) },
            message_trigger_rule_branch_override: { findFirst: jest.fn(async () => null) },
            client: {
                findFirst: jest.fn(async ({ where }: { where: { id?: number; smsAutomationEnabled?: boolean } }) => {
                    if (where.smsAutomationEnabled === false) return world.phoneClientDisabled ? { id: 1 } : null;
                    return { smsAutomationEnabled: world.clientFlags.get(where.id ?? -1) ?? world.clientDefault };
                }),
            },
            employee: { findFirst: jest.fn(async () => null) },
            user: { findMany: jest.fn(async () => []) },
        };
        const updateMany = jest.fn(async () => ({ count: 1 }));
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        for (const db of [fx.prisma, fx.transaction] as Array<Record<string, unknown>>) {
            Object.assign(db, models);
            db["message_trigger_job"] = { ...(db["message_trigger_job"] as object), updateMany };
            // The deleted-client raw-phone lookup finds no tombstone; every other raw query (the claim) keeps its fixture.
            const fixtureQueryRaw = db["$queryRaw"] as ((...args: unknown[]) => unknown) | undefined;
            db["$queryRaw"] = jest.fn(async (...args: unknown[]) => {
                const sql = (args[0] as { strings?: string[]; sql?: string } | undefined);
                const text = sql?.sql ?? sql?.strings?.join("?") ?? "";
                if (text.includes("deleted_at IS NOT NULL")) return [];
                return fixtureQueryRaw?.(...args);
            });
        }
        fx.messageAutomationActivationService.getTriggerDispatchEnabled.mockImplementation(async () => world.branchOn);
        const safeguard = new SmsAutomationSafeguardService(
            fx.prisma as never,
            fx.messageAutomationActivationService as never,
        );
        Object.assign(fx.service, { smsAutomationSafeguard: safeguard });
        return { world, models, updateMany };
    };
    const safeguardCancel = (level: string) => expect.objectContaining({
        where: { id: expect.any(String), status: "pending" },
        data: expect.objectContaining({ status: "canceled", cancelReason: `sms_automation_safeguard:${level}`, canceledByUser: false }),
    });

    describe("SMS automation safeguard at dispatch", () => {
        const agentJob = (overrides: Parameters<typeof createJob>[0] = {}) => createJob({
            id: "agent-job", ruleId: `agent-sms:${branchId}`, dedupeKey: "agent-sms:action-1",
            clientId: null, templateKey: MessageTriggerTemplateKey.INFO, ...overrides,
        });
        const adminDirectJob = () => createJob({
            id: "admin-direct", ruleId: "system:service_end_notice", clientId: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: "system:service_end_notice:client:7:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
        });

        it("cancels a CLIENT rule job whose client flag is off, before any claim or provider call", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx, { clientFlags: new Map([[1, false]]) });
            const job = createJob({ clientId: 1 });
            fx.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            await fx.service.dispatchDueJobs();

            expect(updateMany).toHaveBeenCalledWith(safeguardCancel("recipient"));
            expect(fx.jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
            expect(fx.deliveryService.prepareJob).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toBe("sms_automation_safeguard:recipient");
        });

        it("cancels the automatic service-record-link job of an employee whose flag is off (incident case)", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx);
            fx.prisma.employee_schedule.findFirst.mockResolvedValue({
                primaryEmployee: { smsAutomationEnabled: false }, secondaryEmployee: null,
            });
            const job = createJob({
                id: "link-auto", ruleId: "system:service_record_link", employeeScheduleId: 10,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: "system:service_record_link:schedule:10:primary",
            });
            fx.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            await fx.service.dispatchDueJobs();

            expect(updateMany).toHaveBeenCalledWith(safeguardCancel("recipient"));
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
        });

        it("cancels a rule job whose rule was deactivated after the job was created", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx, { ruleActive: false });
            const job = createJob();
            fx.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            await fx.service.dispatchDueJobs();

            expect(updateMany).toHaveBeenCalledWith(safeguardCancel("rule"));
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
        });

        it("keeps an ordinary job blocked only by the branch switch pending", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx, { branchOn: false });
            const job = createJob();
            fx.jobRepository.findByIdInBranch.mockResolvedValue(job);

            await fx.service.dispatchPendingJobNow(job.id, { expectedBranchId: branchId });

            expect(updateMany).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("pending");
        });

        it("does not send an agent-sms job dispatched now while the branch switch is off, and cancels it", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx, { branchOn: false });
            const job = agentJob();
            fx.jobRepository.findByIdInBranch.mockResolvedValue(job);

            const result = await fx.service.dispatchPendingJobNow(job.id, { expectedBranchId: branchId });

            expect(updateMany).toHaveBeenCalledWith(safeguardCancel("branch"));
            expect(fx.jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(result.status).toBe("canceled");
            expect(result.cancelReason).toBe("sms_automation_safeguard:branch");
        });

        it("blocks an agent-sms job to a phone matching a client whose automation is off", async () => {
            const fx = createDispatchService();
            const { updateMany } = attachSafeguard(fx, { phoneClientDisabled: true });
            const job = agentJob();
            fx.jobRepository.findByIdInBranch.mockResolvedValue(job);

            await fx.service.dispatchPendingJobNow(job.id, { expectedBranchId: branchId });

            expect(updateMany).toHaveBeenCalledWith(safeguardCancel("recipient"));
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("sends an agent-sms job when branch and recipient allow, without reading its intentionally inactive rule", async () => {
            const fx = createDispatchService();
            const { models } = attachSafeguard(fx, { ruleActive: false });
            const job = agentJob();
            fx.jobRepository.findByIdInBranch.mockResolvedValue(job);

            const result = await fx.service.dispatchPendingJobNow(job.id, { expectedBranchId: branchId });

            expect(models.message_trigger_rule.findFirst).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).toHaveBeenCalledWith(job);
            expect(result.status).toBe("sent");
        });

        it("sends an admin direct manual job with every level off, without consulting the safeguard", async () => {
            const fx = createDispatchService();
            const { models, updateMany } = attachSafeguard(fx, {
                ruleActive: false, clientDefault: false, phoneClientDisabled: true, branchOn: false,
            });
            const job = adminDirectJob();
            fx.jobRepository.findByIdInBranch.mockResolvedValue(job);

            const result = await fx.service.dispatchPendingJobNow(job.id, { expectedBranchId: branchId });

            expect(models.message_trigger_rule.findFirst).not.toHaveBeenCalled();
            expect(models.client.findFirst).not.toHaveBeenCalled();
            expect(updateMany).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).toHaveBeenCalledWith(job);
            expect(result.status).toBe("sent");
        });

        it("cancels in the authorize transaction when a flag flips off between claim and authorize: no send, no message_log", async () => {
            const fx = createDispatchService();
            const { world, updateMany } = attachSafeguard(fx);
            const job = createJob({ clientId: 1 });
            fx.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            fx.deliveryService.prepareJob.mockImplementation(async (prepared: MessageTriggerJobEntity) => {
                prepared.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = "synthetic-trigger-prepared";
                world.clientFlags.set(1, false); // admin turns the client off while the message is prepared
                return { serializedSnapshot: "synthetic-trigger-prepared", snapshot: { snapshotHash: "synthetic" } };
            });
            const statements: string[] = [];
            fx.transaction.$queryRaw.mockImplementation(async (query: unknown) => {
                const text = (query as { strings?: readonly string[] }).strings?.join("?") ?? "";
                if (text.includes("SET status = 'canceled'")) {
                    statements.push(`cancel:${(query as { values: unknown[] }).values[0]}`);
                    return [{ id: job.id }];
                }
                if (text.includes("SET status = 'dispatching'")) { statements.push("dispatching"); return [{ id: job.id }]; }
                return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }];
            });

            await fx.service.dispatchDueJobs();

            expect(fx.jobRepository.claimPendingWithRuleFence).toHaveBeenCalled();
            expect(updateMany).not.toHaveBeenCalled();
            expect(statements).toEqual(["cancel:sms_automation_safeguard:recipient"]);
            expect(fx.deliveryService.sendPreparedJob).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toBe("sms_automation_safeguard:recipient");
        });

        it("does not let recipient-blocked jobs starve an eligible job: blocked ones are canceled, the next tick sends it", async () => {
            const fx = createDispatchService();
            const flags = new Map<number, boolean>();
            const blocked = Array.from({ length: 100 }, (_, index) => {
                flags.set(index + 1, false);
                return createJob({
                    id: `blocked-${index}`, clientId: index + 1,
                    scheduledFor: new Date(Date.now() - 60_000 - (100 - index) * 1000),
                });
            });
            flags.set(500, true);
            const eligible = createJob({ id: "eligible", clientId: 500, scheduledFor: new Date(Date.now() - 1000) });
            attachSafeguard(fx, { clientFlags: flags });
            const all = [...blocked, eligible];
            fx.jobRepository.findDuePendingSystemScope.mockImplementation(async (limit: number) =>
                all.filter((job) => job.status === "pending").slice(0, limit));

            await fx.service.dispatchDueJobs();
            expect(blocked.every((job) => job.status === "canceled")).toBe(true);
            expect(eligible.status).toBe("pending");
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();

            await fx.service.dispatchDueJobs();
            expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
            expect(fx.deliveryService.sendJob).toHaveBeenCalledWith(eligible);
            expect(eligible.status).toBe("sent");
        });
    });

    // 규칙 메시지-04 / BJJ-444: manual, one-at-a-time resend of a '추가 정보 필요' job.
    describe("history resendBlockedBy", () => {
        const historyFixture = (
            safeguardOverrides: Parameters<typeof attachSafeguard>[1] = {},
            jobOverrides: Parameters<typeof createJob>[0] = {},
        ) => {
            const fx = createDispatchService();
            const { world } = attachSafeguard(fx, safeguardOverrides);
            const job = createJob({ id: "waiting-job", status: "needs_setup", cancelReason: "필수 정보 누락 (name)", clientId: 1, ...jobOverrides });
            Object.assign(fx.jobRepository, {
                findTerminalByBranch: jest.fn().mockResolvedValue([job]),
                findHistoryPageByBranch: jest.fn().mockResolvedValue([job]),
                findClientHistoryPageByBranch: jest.fn().mockResolvedValue([job]),
            });
            Object.assign(fx.ruleRepository, { findAll: jest.fn().mockResolvedValue([]) });
            (fx.prisma.client.findFirst as jest.Mock).mockImplementation(async ({ where }: { where: { id?: number; smsAutomationEnabled?: boolean } }) => {
                if (where.smsAutomationEnabled === false) return null;
                return { id: 1, phone: "010-1234-5678", smsAutomationEnabled: world.clientFlags.get(where.id ?? -1) ?? world.clientDefault };
            });
            return { ...fx, job };
        };
        const allRows = async (fx: ReturnType<typeof historyFixture>) => [
            ...(await fx.service.listHistory(branchId)),
            ...(await fx.service.listHistoryPage(branchId)).items,
            ...(await fx.service.listClientHistoryPage(branchId, 1)).items,
        ];

        it("is null on every history mapper when no safeguard level blocks a resend", async () => {
            const rows = await allRows(historyFixture());
            expect(rows).toHaveLength(3);
            for (const row of rows) expect(row).toMatchObject({ status: "needs_setup", resendBlockedBy: null });
        });

        it("names the recipient level when the client's automatic-SMS flag is off", async () => {
            const rows = await allRows(historyFixture({ clientFlags: new Map([[1, false]]) }));
            expect(rows).toHaveLength(3);
            for (const row of rows) {
                expect(row.resendBlockedBy).toBe("recipient");
                expect(row.resendBlockedRecipient).toEqual({ kind: "client", id: 1 });
            }
        });

        it("carries no recipient entity for a rule or branch block", async () => {
            for (const rows of [
                await allRows(historyFixture({ ruleActive: false })),
                await allRows(historyFixture({ branchOn: false })),
            ]) {
                for (const row of rows) expect(row).not.toHaveProperty("resendBlockedRecipient");
            }
        });

        it("checks the safeguard only for the rows of the returned slice, not the whole over-read window", async () => {
            const fx = historyFixture();
            const jobs = Array.from({ length: 7 }, (_, index) => createJob({
                id: `waiting-${index}`, status: "needs_setup", cancelReason: "필수 정보 누락 (name)", clientId: 1,
            }));
            (fx.jobRepository as unknown as Record<string, jest.Mock>)["findTerminalByBranch"]!.mockResolvedValue(jobs);

            const rows = await fx.service.listHistory(branchId, 2, 1);

            expect(rows.map((row) => row.triggerJobId)).toEqual(["waiting-1", "waiting-2"]);
            for (const row of rows) expect(row.resendBlockedBy).toBeNull();
            // The branch level is the last check a passing job reaches: one call per returned row only.
            expect(fx.messageAutomationActivationService.getTriggerDispatchEnabled).toHaveBeenCalledTimes(2);
        });

        it("skips the lookahead job of a history page and never checks more than five jobs at once", async () => {
            const fx = historyFixture();
            const jobs = Array.from({ length: 13 }, (_, index) => createJob({
                id: `waiting-${index}`, status: "needs_setup", cancelReason: "필수 정보 누락 (name)", clientId: 1,
            }));
            // 12 rows requested, 13 read: the 13th is the lookahead row and is not returned.
            (fx.jobRepository as unknown as Record<string, jest.Mock>)["findHistoryPageByBranch"]!.mockResolvedValue(jobs);
            let inFlight = 0;
            let maxInFlight = 0;
            fx.messageAutomationActivationService.getTriggerDispatchEnabled.mockImplementation(async () => {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 0));
                inFlight -= 1;
                return true;
            });

            const page = await fx.service.listHistoryPage(branchId, 12);

            expect(page.items).toHaveLength(12);
            expect(fx.messageAutomationActivationService.getTriggerDispatchEnabled).toHaveBeenCalledTimes(12);
            expect(maxInFlight).toBeGreaterThan(1);
            expect(maxInFlight).toBeLessThanOrEqual(5);
        });

        it("names the branch level when the branch trigger-dispatch switch is off", async () => {
            const rows = await allRows(historyFixture({ branchOn: false }));
            for (const row of rows) expect(row.resendBlockedBy).toBe("branch");
        });

        it("names the rule level when the automation rule is off", async () => {
            const rows = await allRows(historyFixture({ ruleActive: false }));
            for (const row of rows) expect(row.resendBlockedBy).toBe("rule");
        });

        it("gives non-needs_setup job rows no resendBlockedBy and never runs the safeguard for them", async () => {
            const fx = historyFixture({ branchOn: false }, { status: "failed" });
            const rows = await allRows(fx);
            expect(rows).toHaveLength(3);
            for (const row of rows) {
                expect(row.status).toBe("failed");
                expect(row).not.toHaveProperty("resendBlockedBy");
            }
            expect(fx.messageAutomationActivationService.getTriggerDispatchEnabled).not.toHaveBeenCalled();
        });

        it("is null for an admin-direct job, which bypasses the safeguard", async () => {
            const fx = historyFixture({ branchOn: false }, {
                ruleId: "system:service_end_notice", templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
                dedupeKey: "system:service_end_notice:client:7:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
            });
            for (const row of await allRows(fx)) expect(row.resendBlockedBy).toBeNull();
        });

        it("falls back to null and still returns the list when the safeguard check throws", async () => {
            const fx = historyFixture();
            fx.messageAutomationActivationService.getTriggerDispatchEnabled.mockRejectedValue(new Error("db down"));
            const rows = await allRows(fx);
            expect(rows).toHaveLength(3);
            for (const row of rows) expect(row.resendBlockedBy).toBeNull();
        });
    });

    describe("resendNeedsSetupJob", () => {
        const SETUP_REASON = "필수 정보 누락 (name)";
        const DAY_MS = 24 * 60 * 60 * 1000;

        const resendFixture = (jobOverrides: Parameters<typeof createJob>[0] = {}) => {
            const dispatcher = createDispatchService();
            const client = { id: 1, name: "현재 산모", phone: "010-9999-8888", type: null,
                startDate: new Date("2026-10-01"), endDate: new Date("2026-10-20"),
                serviceEndNoticeSentAt: null, createdAt: new Date("2026-06-01") };
            const rule = createRule({ id: jobOverrides.ruleId ?? "rule-1" });
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(rule);
            jest.spyOn(dispatcher.service, "readClientAutomationSource").mockResolvedValue(client);
            jest.spyOn(dispatcher.service, "readClientAutomationSchedules").mockResolvedValue([]);
            const scheduledFor = jobOverrides.scheduledFor ?? new Date(Date.now() - 3 * DAY_MS);
            const recipe = buildClientMessageRecipe(rule, client, scheduledFor)!;
            const job = createJob({
                id: "waiting-job", status: "needs_setup", cancelReason: SETUP_REASON, attempts: 1,
                scheduledFor, dedupeKey: recipe.dedupeKey, ...jobOverrides,
            });
            job.claimToken = "claim-old";
            dispatcher.jobRepository.findByIdInBranch.mockResolvedValue(job);
            dispatcher.messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));
            const writtenStatuses: string[] = [];
            const writes: Array<{ status: string; cancelReason: string | null }> = [];
            dispatcher.jobRepository.update.mockImplementation(async (written: MessageTriggerJobEntity) => {
                writtenStatuses.push(written.status);
                writes.push({ status: written.status, cancelReason: written.cancelReason });
            });
            return { ...dispatcher, job, client, rule, writtenStatuses, writes };
        };
        const linkJobOverrides = (): Parameters<typeof createJob>[0] => ({
            ruleId: "system:service_record_link", employeeScheduleId: 10,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: "system:service_record_link:schedule:10:primary",
            payload: { memberId: "employee:30", recipientName: "제공인력", recipientPhone: "010-1234-5678",
                buttonUrl: "https://mobile.test/service-record/efl_link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" } },
        });

        describe("current-value rebuild", () => {
            const identityReason = "발송 대상 일정이 변경되어 재전송하지 않았습니다";
            const datedFixture = (catchUp = false) => {
                const fx = resendFixture();
                const rule = createRule({ eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.BEFORE_DAYS, offsetDays: 1 });
                fx.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(rule);
                const recipe = buildClientMessageRecipe(rule, fx.client, fx.job.scheduledFor)!;
                fx.job.scheduledFor = recipe.scheduledFor;
                fx.job.dedupeKey = recipe.dedupeKey;
                if (catchUp) {
                    fx.job.payload.catchUp = { batchId: "batch", sequence: 1, intervalMinutes: 3,
                        originalScheduledFor: recipe.scheduledFor.toISOString(), predecessorDedupeKey: null };
                    fx.job.scheduledFor = new Date("2026-10-10T00:00:00Z");
                    fx.job.dedupeKey = "catch-up-batch-key";
                }
                return fx;
            };

            it.each([false, true])("persists exactly CURRENT IMMEDIATE recipe values before the gate (prepared=%s), retaining time, key and reason", async (prepared) => {
                const fx = resendFixture();
                const reference = createAgentAutomationTaskCommitReference({
                    actionId: "70000000-0000-4000-8000-000000000004",
                    taskId: "70000000-0000-4000-8000-000000000005", taskRevision: 1,
                    authorities: [{ id: "70000000-0000-4000-8000-000000000001", recordDigest: "a".repeat(64), scopeDigest: "b".repeat(64) }], coverages: [],
                });
                fx.job.payload.taskAutomationReference = reference;
                fx.job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = "stale-snapshot";
                fx.job.payload.templateVariables["receiptUrl"] = "https://stale.test/receipt";
                fx.job.payload.buttonUrl = "https://stale.test/button";
                const expected = { ...buildClientMessageRecipe(fx.rule, fx.client, fx.job.scheduledFor)!.payload,
                    taskAutomationReference: reference };
                const scheduledFor = fx.job.scheduledFor;
                const dedupeKey = fx.job.dedupeKey;
                let stored: { payload: MessageTriggerJobEntity["payload"]; recipientPhone: string | null;
                    status: string; cancelReason: string | null } | undefined;
                fx.jobRepository.update.mockImplementation(async (job: MessageTriggerJobEntity) => {
                    stored = structuredClone({ payload: job.payload, recipientPhone: job.recipientPhone,
                        status: job.status, cancelReason: job.cancelReason });
                });
                const internals = fx.service as unknown as {
                    authorizeClaimedJobBeforePreparation: (job: MessageTriggerJobEntity) => Promise<{ kind: "allow" | "lost" }>;
                    authorizeClaimedJobForDispatch: (job: MessageTriggerJobEntity) => Promise<{ kind: "allow" | "lost" }>;
                };
                const gate = jest.spyOn(internals, prepared ? "authorizeClaimedJobBeforePreparation" : "authorizeClaimedJobForDispatch")
                    .mockImplementation(async (job) => {
                        expect(stored).toEqual({ payload: expected, recipientPhone: fx.client.phone,
                            status: "processing", cancelReason: SETUP_REASON });
                        return { kind: JSON.stringify(stored?.payload) === JSON.stringify(job.payload) ? "allow" : "lost" };
                    });
                if (!prepared) Object.assign(fx.deliveryService, { prepareJob: undefined, sendPreparedJob: undefined });
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(gate).toHaveBeenCalled();
                expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
                expect(fx.job.payload.templateVariables["name"]).toBe(fx.client.name);
                expect(fx.job.scheduledFor).toBe(scheduledFor);
                expect(fx.job.dedupeKey).toBe(dedupeKey);
                expect(fx.job.status).toBe("sent");
            });

            it.each([false, true])("accepts an unchanged dated source, including catch-up=%s", async (catchUp) => {
                const fx = datedFixture(catchUp);
                const preserved = structuredClone(fx.job.payload.catchUp);
                const time = fx.job.scheduledFor;
                const key = fx.job.dedupeKey;
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.status).toBe("sent");
                expect(fx.job.payload.catchUp).toEqual(preserved);
                expect(fx.job.scheduledFor).toBe(time);
                expect(fx.job.dedupeKey).toBe(key);
            });

            it.each([false, true])("cancels a changed start date, including catch-up=%s", async (catchUp) => {
                const fx = datedFixture(catchUp);
                fx.client.startDate = new Date("2026-11-01");
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.cancelReason).toBe(identityReason);
                expect(fx.job.status).toBe("canceled");
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
                expect(fx.jobRepository.hasNewerClientRuleSibling).not.toHaveBeenCalled();
                expect(fx.jobRepository.findForClientAutomationReview).not.toHaveBeenCalled();
            });

            it.each(["key", "time"])("requires the client occurrence's %s independently", async (changed) => {
                const fx = datedFixture();
                if (changed === "key") fx.job.dedupeKey = "different-key";
                else fx.job.scheduledFor = new Date(fx.job.scheduledFor.getTime() + 1);
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.status).toBe("canceled");
                expect(fx.job.cancelReason).toBe(identityReason);
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            });

            it.each(["client", "rule", "schedule"])("cancels when the %s source is gone", async (source) => {
                const fx = resendFixture(source === "schedule" ? { employeeScheduleId: 10 } : {});
                if (source === "client") jest.mocked(fx.service.readClientAutomationSource).mockResolvedValue(null);
                if (source === "rule") fx.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(null);
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.cancelReason).toBe(identityReason);
                expect(fx.job.status).toBe("canceled");
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            });

            it("cancels the resend without delivery when the database reports a newer sibling", async () => {
                const fx = resendFixture();
                fx.jobRepository.hasNewerClientRuleSibling.mockResolvedValue(true);
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.jobRepository.hasNewerClientRuleSibling).toHaveBeenCalledTimes(1);
                expect(fx.jobRepository.hasNewerClientRuleSibling).toHaveBeenCalledWith({
                    branchId,
                    clientId: fx.job.clientId,
                    ruleId: fx.job.ruleId,
                    recipientType: fx.job.recipientType,
                    excludeJobId: fx.job.id,
                    createdAfter: fx.job.createdAt,
                });
                expect(fx.jobRepository.findForClientAutomationReview).not.toHaveBeenCalled();
                expect(fx.job.status).toBe("canceled");
                expect(fx.job.cancelReason).toBe("새 예약 메시지가 있어 재전송하지 않았습니다");
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            });

            it("resends when the database reports no newer sibling", async () => {
                const fx = resendFixture();
                fx.jobRepository.hasNewerClientRuleSibling.mockResolvedValue(false);
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.jobRepository.hasNewerClientRuleSibling).toHaveBeenCalledTimes(1);
                expect(fx.jobRepository.findForClientAutomationReview).not.toHaveBeenCalled();
                expect(fx.job.status).toBe("sent");
                expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
            });

            it.each([false, true])("checks assignment identity (changed key=%s) without checking a second schedule's sibling", async (changedKey) => {
                const fx = resendFixture({ employeeScheduleId: 10 });
                const rule = createRule({ eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                    recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED });
                const schedule: EmployeeAssignmentScheduleSource = { id: 10, branchId, clientId: 1,
                    workAddress: "주소", startDate: new Date("2026-10-01"), endDate: new Date("2026-10-20"),
                    replaced: false, terminatedAt: null, primaryEmployeeId: 30, secondaryEmployeeId: null,
                    client: { id: 1, name: "현재 산모" }, primaryEmployee: { id: 30, name: "현재 직원", phone: "010-9999-8888" }, secondaryEmployee: null };
                fx.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(rule);
                jest.mocked(fx.service.readClientAutomationSchedules).mockResolvedValue([{ ...schedule, incarnationId: "schedule-generation" }]);
                const recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, fx.job.scheduledFor)!;
                Object.assign(fx.job, { dedupeKey: recipe.dedupeKey, recipientType: recipe.recipientType, templateKey: recipe.templateKey });
                if (changedKey) fx.job.dedupeKey = "previous-assignment-key";
                fx.jobRepository.hasNewerClientRuleSibling.mockResolvedValue(true);
                // The existing assignment fence independently re-reads the same current schedule.
                fx.prisma.employee_schedule.findFirst.mockResolvedValue(schedule);
                fx.claimedJobRead.mockImplementation(async () => ({ ...fx.job, status: "processing" }));
                const time = fx.job.scheduledFor;
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                if (changedKey) {
                    expect(fx.job.status).toBe("canceled");
                    expect(fx.job.cancelReason).toBe(identityReason);
                    expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
                    expect(fx.jobRepository.hasNewerClientRuleSibling).not.toHaveBeenCalled();
                    expect(fx.jobRepository.findForClientAutomationReview).not.toHaveBeenCalled();
                    return;
                }
                expect(fx.job.payload.templateVariables["employeeName"]).toBe("현재 직원");
                expect(fx.job.dedupeKey).toBe(recipe.dedupeKey);
                expect(fx.job.scheduledFor).toBe(time);
                expect(fx.jobRepository.hasNewerClientRuleSibling).not.toHaveBeenCalled();
                expect(fx.jobRepository.findForClientAutomationReview).not.toHaveBeenCalled();
                expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
            });

            it("returns to needs_setup with the existing reason if the rebuild persist throws", async () => {
                const fx = resendFixture();
                fx.jobRepository.update.mockRejectedValueOnce(new Error("persist failed"));
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.status).toBe("needs_setup");
                expect(fx.job.cancelReason).toBe(SETUP_REASON);
                expect(fx.deliveryService.prepareJob).not.toHaveBeenCalled();
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
                expect(fx.writtenStatuses).toEqual(["needs_setup"]);
            });

            it.each(["link", "sealed", "manual"])("keeps the %s stored payload unchanged", async (kind) => {
                const fx = resendFixture(kind === "link" ? linkJobOverrides() : kind === "manual" ? { dedupeKey: "agent-sms-retry:stored" } : {});
                if (kind === "link") fx.prisma.employee_schedule.findFirst.mockResolvedValue({
                    endDate: new Date(Date.now() + DAY_MS), replaced: false, terminatedAt: null, client: null });
                if (kind === "sealed") fx.job.payload.agentAutomationSeal = { private: "synthetic-seal" } as never;
                const stored = structuredClone(fx.job.payload);
                fx.deliveryService.prepareJob.mockImplementation(async (job: MessageTriggerJobEntity) => {
                    expect(job.payload).toEqual(stored);
                    return { serializedSnapshot: "synthetic-trigger-prepared", snapshot: { snapshotHash: "synthetic" } };
                });
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
                expect(fx.service.readClientAutomationSource).not.toHaveBeenCalled();
                expect(fx.job.payload).toEqual(stored);
            });

            it("leaves a sealed job to the gate, whose refusal cancels it", async () => {
                const fx = resendFixture();
                fx.job.payload.agentAutomationSeal = { private: "synthetic-seal" } as never;
                const stored = structuredClone(fx.job.payload);
                const internals = fx.service as unknown as { authorizeClaimedJobBeforePreparation: () => Promise<{ kind: "stale"; reason: string }> };
                jest.spyOn(internals, "authorizeClaimedJobBeforePreparation").mockResolvedValue({ kind: "stale", reason: "sealed refusal" });
                await fx.service.resendNeedsSetupJob(branchId, fx.job.id);
                expect(fx.job.status).toBe("canceled");
                expect(fx.job.payload).toEqual(stored);
                expect(fx.service.readClientAutomationSource).not.toHaveBeenCalled();
                expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            });
        });

        it("is a 404 for an unknown id or another branch's job, through the caller's branch-scoped read", async () => {
            const { service, jobRepository, deliveryService } = resendFixture();
            jobRepository.findByIdInBranch.mockResolvedValue(null);

            await expect(service.resendNeedsSetupJob("other-branch", "waiting-job"))
                .rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });

            expect(jobRepository.findByIdInBranch).toHaveBeenCalledWith("other-branch", "waiting-job");
            expect(jobRepository.claimNeedsSetupWithRuleFence).not.toHaveBeenCalled();
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it.each(["pending", "processing", "dispatching", "sent", "canceled", "failed"] as const)(
            "is a 409 for a %s job, without claiming or sending",
            async (status) => {
                const { service, job, jobRepository, deliveryService } = resendFixture({ status });

                const failure = await service.resendNeedsSetupJob(branchId, job.id).catch((error: unknown) => error);

                expect(failure).toBeInstanceOf(ConflictException);
                expect((failure as ConflictException).getStatus()).toBe(409);
                expect((failure as ConflictException).getResponse()).toMatchObject({ code: "REQUEST_CONFLICT" });
                expect(jobRepository.claimNeedsSetupWithRuleFence).not.toHaveBeenCalled();
                expect(jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
                expect(deliveryService.sendJob).not.toHaveBeenCalled();
                expect(jobRepository.update).not.toHaveBeenCalled();
                expect(job.status).toBe(status);
            },
        );

        it.each([
            ["a lost concurrent claim", "claim"],
            ["an inactive rule, inactive branch override or stale rule (the rule fence refuses)", "claim"],
            ["trigger dispatch being off", "dispatch-off"],
        ])("is a 409 with the row unchanged and no provider call for %s", async (_label, cause) => {
            const { service, job, jobRepository, deliveryService, messageAutomationActivationService } = resendFixture();
            jobRepository.claimNeedsSetupWithRuleFence.mockResolvedValue(null);
            if (cause === "dispatch-off") messageAutomationActivationService.getTriggerDispatchEnabled.mockResolvedValue(false);

            const failure = await service.resendNeedsSetupJob(branchId, job.id).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ConflictException);
            expect((failure as ConflictException).getResponse()).toMatchObject({
                code: "REQUEST_CONFLICT",
                message: "지금은 재전송할 수 없습니다. 자동 전송 설정과 받는 사람의 자동 문자 설정을 확인해 주세요.",
            });
            if (cause === "dispatch-off") expect(jobRepository.claimNeedsSetupWithRuleFence).not.toHaveBeenCalled();
            expect(deliveryService.prepareJob).not.toHaveBeenCalled();
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(jobRepository.update).not.toHaveBeenCalled();
            expect(job.status).toBe("needs_setup");
            expect(job.cancelReason).toBe(SETUP_REASON);
            expect(job.claimToken).toBe("claim-old");
        });

        it("sends the stored payload unchanged through the needs_setup claim and reports sent", async () => {
            const storedVariables = { name: "김산모", counselorName: "홍길동", visitDate: "2026-10-01" };
            const { service, job, jobRepository, deliveryService, writtenStatuses, writes } = resendFixture({
                payload: {
                    memberId: "member-1", recipientName: "김산모", recipientPhone: "010-1234-5678",
                    buttonUrl: "https://mobile.test/stored", messageBody: "저장된 본문",
                    templateVariables: { ...storedVariables },
                },
                dedupeKey: "agent-sms-retry:stored",
            });
            const payloadBefore = structuredClone(job.payload);
            const scheduledFor = job.scheduledFor;
            const dedupeKey = job.dedupeKey;
            // Capture BY VALUE at call time: the job reference is shared and mutable, so a copy taken
            // afterwards would hide a mutation made on the way to delivery.
            let delivered: MessageTriggerJobEntity["payload"] | null = null;
            deliveryService.sendJob.mockImplementation(async (handed: MessageTriggerJobEntity) => {
                delivered = structuredClone(handed.payload);
                return true;
            });

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(jobRepository.claimNeedsSetupWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
            expect(jobRepository.claimPendingWithRuleFence).not.toHaveBeenCalled();
            expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
            // prepareJob freezes the delivery snapshot into the variables; every stored value is unchanged.
            const { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: snapshot, ...deliveredVariables } = delivered!.templateVariables;
            expect(snapshot).toBe("synthetic-trigger-prepared");
            expect(deliveredVariables).toEqual(storedVariables);
            expect({ ...delivered!, templateVariables: undefined }).toEqual({ ...payloadBefore, templateVariables: undefined });
            expect(job.claimToken).toBe("claim-a");
            expect(job.scheduledFor).toBe(scheduledFor);
            expect(job.dedupeKey).toBe(dedupeKey);
            expect(job.attempts).toBe(1);
            expect(writtenStatuses[writtenStatuses.length - 1]).toBe("sent");
            // A sent job reports no reason: the setup reason is dropped at the sent transition.
            expect(writes[writes.length - 1]).toEqual({ status: "sent", cancelReason: null });
            expect(result).toEqual({ id: job.id, status: "sent", reason: null });
        });

        it("keeps the setup reason on the in-flight row after the claim, as the durable resend mark", async () => {
            const { service, job, deliveryService, writes } = resendFixture();
            let inFlight: { status: string; cancelReason: string | null } | null = null;
            deliveryService.sendJob.mockImplementation(async (handed: MessageTriggerJobEntity) => {
                inFlight = { status: handed.status, cancelReason: handed.cancelReason };
                return true;
            });

            await service.resendNeedsSetupJob(branchId, job.id);

            expect(inFlight).toEqual({ status: "dispatching", cancelReason: SETUP_REASON });
            // Every write before the terminal one (the frozen-snapshot write) still carries the mark.
            const beforeTerminal = writes.slice(0, -1);
            expect(beforeTerminal.length).toBeGreaterThan(0);
            for (const written of beforeTerminal) expect(written.cancelReason).toBe(SETUP_REASON);
        });

        it("returns '추가 정보 필요' with the fresh reason, attempts unchanged, when the cause is still there", async () => {
            const { service, job, deliveryService, writtenStatuses } = resendFixture();
            deliveryService.sendJob.mockImplementation(async () => {
                job.markNeedsSetup("템플릿을 찾을 수 없습니다");
                return false;
            });

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(result).toEqual({ id: job.id, status: "needs_setup", reason: "템플릿을 찾을 수 없습니다" });
            expect(job.attempts).toBe(1);
            expect(job.nextAttemptAt).toBeNull();
            expect(writtenStatuses[writtenStatuses.length - 1]).toBe("needs_setup");
            expect(writtenStatuses).not.toContain("pending");
        });

        it("resends a job whose scheduled time is far more than 24 hours old, while the ordinary dispatcher still expires an old pending job", async () => {
            const resend = resendFixture({ scheduledFor: new Date(Date.now() - 30 * DAY_MS) });
            const result = await resend.service.resendNeedsSetupJob(branchId, resend.job.id);
            expect(result.status).toBe("sent");
            expect(resend.deliveryService.sendJob).toHaveBeenCalledTimes(1);

            const ordinary = createDispatchService();
            const oldPending = createJob({ scheduledFor: new Date(Date.now() - 30 * DAY_MS) });
            ordinary.jobRepository.findDuePendingSystemScope.mockResolvedValue([oldPending]);
            await ordinary.service.dispatchDueJobs();
            expect(oldPending.status).toBe("canceled");
            expect(oldPending.cancelReason).toBe("기존 발송 예정 24시간 경과");
            expect(ordinary.deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("still cancels an automatic service-record-link job whose link token window has ended", async () => {
            const { service, job, prisma, deliveryService } = resendFixture(linkJobOverrides());
            prisma.employee_schedule.findFirst.mockResolvedValue({
                endDate: new Date("2026-01-01"), replaced: false, terminatedAt: null,
                client: { serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date(), endDate: new Date() },
            });

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(result).toEqual({ id: job.id, status: "canceled", reason: SERVICE_RECORD_LINK_ENDED_REASON });
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("still blocks the pre-booking service-record-link gate (200, canceled)", async () => {
            const { service, job, prisma, deliveryService } = resendFixture(linkJobOverrides());
            prisma.employee_schedule.findFirst.mockResolvedValue({
                endDate: new Date(Date.now() + DAY_MS), replaced: false, terminatedAt: null,
                client: { serviceStatus: "pre_booking", bookingConfirmedAt: null, startDate: new Date(), endDate: new Date(Date.now() + DAY_MS) },
            });

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(result).toEqual({
                id: job.id, status: "canceled", reason: "예약 전 고객이라 제공기록지 링크를 발송하지 않았습니다",
            });
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("still skips a client outside the rule's 대상 고객 상태 (200, canceled)", async () => {
            const { service, job, ruleRepository, prisma, deliveryService } = resendFixture({ ruleId: "rule-target" });
            ruleRepository.findByIdIncludingGlobal.mockResolvedValue(createRule({ id: "rule-target", targetClientStatus: "active" }));
            prisma.client.findFirst.mockResolvedValue({
                serviceStatus: null, bookingConfirmedAt: new Date("2026-01-01"),
                startDate: new Date(Date.now() + 3 * DAY_MS), endDate: new Date(Date.now() + 20 * DAY_MS),
            });

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(result.status).toBe("canceled");
            expect(result.reason).toContain("target_client_status_mismatch");
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("resends a job of a global rule", async () => {
            const { service, job, ruleRepository, jobRepository, deliveryService } = resendFixture({ ruleId: "rule-global" });
            ruleRepository.findByIdIncludingGlobal.mockResolvedValue(createRule({ id: "rule-global", branchId: null }));

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(jobRepository.claimNeedsSetupWithRuleFence).toHaveBeenCalledWith(job.id, branchId, expect.any(Object));
            expect(deliveryService.sendJob).toHaveBeenCalledTimes(1);
            expect(result.status).toBe("sent");
        });

        it("keeps a sender-approval block terminal (200, canceled)", async () => {
            const { service, job, messageSenderApprovalService, deliveryService } = resendFixture();
            messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set<string>());

            const result = await service.resendNeedsSetupJob(branchId, job.id);

            expect(result.status).toBe("canceled");
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
        });

        describe("a transient deferral never leaves the job pending", () => {
            it("from preparation: back to '추가 정보 필요' with the transient reason, attempts and schedule unchanged", async () => {
                const { service, job, deliveryService, writtenStatuses } = resendFixture();
                const scheduledFor = job.scheduledFor;
                deliveryService.prepareJob.mockRejectedValue(new TriggerJobDeferredError("transient", "Rule retry policy could not be read"));

                const result = await service.resendNeedsSetupJob(branchId, job.id);

                expect(result).toEqual({ id: job.id, status: "needs_setup", reason: "Rule retry policy could not be read" });
                expect(job.attempts).toBe(1);
                expect(job.scheduledFor).toBe(scheduledFor);
                expect(job.nextAttemptAt).toBeNull();
                expect(writtenStatuses).not.toContain("pending");
                expect(deliveryService.sendJob).not.toHaveBeenCalled();
            });

            it("from delivery: back to '추가 정보 필요' with the transient reason, attempts and schedule unchanged", async () => {
                const { service, job, deliveryService, writtenStatuses } = resendFixture();
                const scheduledFor = job.scheduledFor;
                deliveryService.sendJob.mockRejectedValue(new TriggerJobDeferredError("transient", "Provider timeout"));

                const result = await service.resendNeedsSetupJob(branchId, job.id);

                expect(result).toEqual({ id: job.id, status: "needs_setup", reason: "Provider timeout" });
                expect(job.attempts).toBe(1);
                expect(job.scheduledFor).toBe(scheduledFor);
                expect(writtenStatuses[writtenStatuses.length - 1]).toBe("needs_setup");
                expect(writtenStatuses).not.toContain("pending");
            });

            it("does not terminal-fail on the attempts cap, because attempts are not incremented", async () => {
                const { service, job, deliveryService } = resendFixture({ attempts: TRIGGER_JOB_MAX_ATTEMPTS - 1 });
                deliveryService.sendJob.mockRejectedValue(new TriggerJobDeferredError("transient", "Provider timeout"));

                const result = await service.resendNeedsSetupJob(branchId, job.id);

                expect(result.status).toBe("needs_setup");
                expect(job.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS - 1);
            });

            it("from a catch-up postponement: back to '추가 정보 필요', scheduledFor unchanged", async () => {
                const scheduledFor = new Date(Date.now() - 3 * DAY_MS);
                const { service, job, prisma, deliveryService, writtenStatuses } = resendFixture({
                    scheduledFor,
                    payload: {
                        memberId: "1", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {},
                        catchUp: {
                            batchId: "client:1:batch", sequence: 2, intervalMinutes: 3,
                            originalScheduledFor: "2026-07-07T00:00:00.000Z", predecessorDedupeKey: "dedupe-predecessor",
                        },
                    },
                });
                prisma.message_trigger_job.findUnique.mockResolvedValue({
                    status: "pending", scheduledFor: new Date(), sentAt: null, canceledAt: null,
                    nextAttemptAt: null, updatedAt: new Date(),
                });

                const result = await service.resendNeedsSetupJob(branchId, job.id);

                expect(result.status).toBe("needs_setup");
                expect(job.scheduledFor).toBe(scheduledFor);
                expect(job.attempts).toBe(1);
                expect(writtenStatuses).toEqual(["needs_setup"]);
                expect(deliveryService.sendJob).not.toHaveBeenCalled();
            });

            it("control: the ordinary dispatcher still defers the same error to pending with one more attempt", async () => {
                const { service, deliveryService, jobRepository } = createDispatchService();
                const job = createJob({ attempts: 1 });
                jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
                deliveryService.sendJob.mockRejectedValue(new TriggerJobDeferredError("transient", "Provider timeout"));

                await service.dispatchDueJobs();

                expect(job.status).toBe("pending");
                expect(job.attempts).toBe(2);
            });
        });

        describe("an in-flight resend that is reclaimed returns to '추가 정보 필요', never pending", () => {
            const processingResendRow = (overrides: Parameters<typeof createJob>[0] = {}) => {
                const row = createJob({
                    id: "waiting-job", status: "processing", cancelReason: SETUP_REASON, attempts: 1,
                    scheduledFor: new Date(Date.now() - 30 * DAY_MS), ...overrides,
                });
                row.claimToken = "claim-resend";
                return row;
            };

            it("reclaims a stale resend claim to needs_setup with attempts and schedule unchanged, fenced by its claim token", async () => {
                const { service, jobRepository, messageLogRepository } = createDispatchService();
                const row = processingResendRow();
                const scheduledFor = row.scheduledFor;
                jobRepository.findStaleProcessingSystemScope.mockResolvedValue([row]);
                messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());

                await service.dispatchDueJobs();

                expect(row.status).toBe("needs_setup");
                expect(row.cancelReason).toBe(SETUP_REASON);
                expect(row.attempts).toBe(1);
                expect(row.scheduledFor).toBe(scheduledFor);
                expect(row.nextAttemptAt).toBeNull();
                expect(row.claimToken).toBe("claim-resend");
                expect(jobRepository.update).toHaveBeenCalledWith(row);
            });

            it("control: an ordinary stale processing row (no resend mark) is still deferred to pending with one more attempt", async () => {
                const { service, jobRepository, messageLogRepository } = createDispatchService();
                const row = createJob({ id: "ordinary-job", status: "processing", attempts: 1 });
                row.claimToken = "claim-ordinary";
                jobRepository.findStaleProcessingSystemScope.mockResolvedValue([row]);
                messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());

                await service.dispatchDueJobs();

                expect(row.status).toBe("pending");
                expect(row.attempts).toBe(2);
                expect(row.nextAttemptAt).toBeInstanceOf(Date);
            });

            it("a stale resend row already dispatching keeps the uncertain-outcome handling", async () => {
                const { service, jobRepository, messageLogRepository } = createDispatchService();
                const row = processingResendRow({ status: "dispatching" });
                jobRepository.findStaleProcessingSystemScope.mockResolvedValue([row]);
                messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());

                await service.dispatchDueJobs();

                expect(row.status).toBe("failed");
                expect(row.cancelReason).toContain("불확실");
            });

            it("a stale resend row with a sent message log is reconciled to sent with no reason", async () => {
                const { service, jobRepository, messageLogRepository } = createDispatchService();
                const row = processingResendRow();
                jobRepository.findStaleProcessingSystemScope.mockResolvedValue([row]);
                messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set([row.id]));

                await service.dispatchDueJobs();

                expect(row.status).toBe("sent");
                expect(row.cancelReason).toBeNull();
            });

            it("a reclaim that wins the race against a running resend: the fenced rebuild cannot overwrite it, calls no provider, and reports needs_setup", async () => {
                const { service, job, jobRepository, deliveryService, transaction, writtenStatuses } = resendFixture();
                const reclaimed = createJob({
                    id: job.id, status: "needs_setup", cancelReason: SETUP_REASON, attempts: 1,
                    scheduledFor: new Date(Date.now() - 30 * DAY_MS),
                });
                jobRepository.findByIdInBranch.mockResolvedValueOnce(job).mockResolvedValue(reclaimed);
                jobRepository.update.mockResolvedValue(reclaimed);
                // The pre-preparation gate re-reads the row: the reclaim already moved it out of `processing`.
                transaction.$queryRaw.mockResolvedValueOnce([{ status: "needs_setup", claim_token: null }]);

                const result = await service.resendNeedsSetupJob(branchId, job.id);

                expect(result).toEqual({ id: job.id, status: "needs_setup", reason: SETUP_REASON });
                expect(deliveryService.prepareJob).not.toHaveBeenCalled();
                expect(deliveryService.sendJob).not.toHaveBeenCalled();
                expect(jobRepository.update).toHaveBeenCalledTimes(1);
                expect(reclaimed.status).toBe("needs_setup");
                expect(writtenStatuses).not.toContain("pending");
            });

            it("a request that dies after the claim is reclaimed to needs_setup, and a second resend then succeeds", async () => {
                const fx = resendFixture();
                fx.ruleRepository.findByIdIncludingGlobal.mockRejectedValueOnce(new Error("read failed after the claim"));

                await expect(fx.service.resendNeedsSetupJob(branchId, fx.job.id)).rejects.toThrow("read failed after the claim");
                // The claim left the setup reason in place: the row sits in `processing` carrying it.
                expect(fx.job.cancelReason).toBe(SETUP_REASON);
                expect(fx.jobRepository.update).not.toHaveBeenCalled();
                const stuck = processingResendRow({ cancelReason: fx.job.cancelReason, attempts: fx.job.attempts });

                fx.jobRepository.findStaleProcessingSystemScope.mockResolvedValueOnce([stuck]);
                fx.messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());
                await fx.service.dispatchDueJobs();
                expect(stuck.status).toBe("needs_setup");
                expect(stuck.attempts).toBe(1);

                fx.jobRepository.findByIdInBranch.mockResolvedValue(stuck);
                stuck.dedupeKey = buildClientMessageRecipe(fx.rule, fx.client, stuck.scheduledFor)!.dedupeKey;
                const result = await fx.service.resendNeedsSetupJob(branchId, stuck.id);

                expect(result).toEqual({ id: stuck.id, status: "sent", reason: null });
                expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
            });
        });

        it("refuses an admin resend when the recipient flag is off: 409, row kept needs_setup, no provider call", async () => {
            const fx = resendFixture();
            const { updateMany } = attachSafeguard(fx, { clientDefault: false });

            const failure = await fx.service.resendNeedsSetupJob(branchId, fx.job.id).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ConflictException);
            expect((failure as ConflictException).getResponse()).toMatchObject({
                code: "REQUEST_CONFLICT",
                message: expect.stringContaining("받는 사람의 자동 문자 설정"),
            });
            expect(fx.jobRepository.claimNeedsSetupWithRuleFence).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(fx.jobRepository.update).not.toHaveBeenCalled();
            expect(fx.job.status).toBe("needs_setup");
            expect(updateMany).not.toHaveBeenCalled();
        });

        it("refuses an admin resend when the branch switch is off, keeping the row needs_setup", async () => {
            const fx = resendFixture();
            const { updateMany } = attachSafeguard(fx, { branchOn: false });

            const failure = await fx.service.resendNeedsSetupJob(branchId, fx.job.id).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ConflictException);
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(fx.job.status).toBe("needs_setup");
            expect(updateMany).not.toHaveBeenCalled();
        });

        it("returns a resend to needs_setup with a 409 when the recipient flag flips off after the claim", async () => {
            const fx = resendFixture();
            const { world } = attachSafeguard(fx, { clientDefault: true });
            const claim = fx.jobRepository.claimNeedsSetupWithRuleFence.getMockImplementation();
            fx.jobRepository.claimNeedsSetupWithRuleFence.mockImplementation(async (...args: unknown[]) => {
                const token = claim ? await (claim as (...a: unknown[]) => Promise<unknown>)(...args) : "claim-a";
                world.clientDefault = false;
                return token;
            });
            const sql: string[] = [];
            const queryRaw = fx.transaction.$queryRaw.getMockImplementation();
            fx.transaction.$queryRaw.mockImplementation(async (query: { strings?: readonly string[] }, ...rest: unknown[]) => {
                sql.push((query.strings ?? []).join("?"));
                return queryRaw ? queryRaw(query, ...rest) : [{ id: fx.job.id, status: "processing", claim_token: "claim-a" }];
            });

            const failure = await fx.service.resendNeedsSetupJob(branchId, fx.job.id).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ConflictException);
            expect(fx.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(fx.deliveryService.sendPreparedJob).not.toHaveBeenCalled();
            expect(fx.job.status).toBe("needs_setup");
            expect(fx.job.cancelReason).toBe(SETUP_REASON);
            expect(sql.some((text) => text.includes("SET status = 'needs_setup'"))).toBe(true);
            expect(sql.some((text) => text.includes("SET status = 'canceled'"))).toBe(false);
            expect(fx.writtenStatuses).not.toContain("canceled");
        });

        it("still sends an admin resend when rule, recipient and branch all allow it", async () => {
            const fx = resendFixture();
            attachSafeguard(fx, { clientDefault: true });

            const result = await fx.service.resendNeedsSetupJob(branchId, fx.job.id);

            expect(result).toEqual({ id: fx.job.id, status: "sent", reason: null });
            expect(fx.deliveryService.sendJob).toHaveBeenCalledTimes(1);
        });
    });

    it("binds employee-assignment jobs to the schedule source generation", () => {
        const { internals } = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-fence",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const job = internals.buildEmployeeAssignmentJob(employeeRule, createEmployeeSchedule());

        expect((job?.payload as unknown as Record<string, unknown>)["employeeScheduleFingerprint"])
            .toEqual(expect.any(String));
    });

    it("performs the schedule fence after claim and before sending an unchanged assignment", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-accept",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const schedule = createEmployeeSchedule();
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, schedule)!;
        const dispatcher = createDispatchService();
        const events: string[] = [];
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockImplementation(async () => {
            events.push("job-read");
            return job;
        });
        dispatcher.jobRepository.claimPendingWithRuleFence.mockImplementation(async () => {
            events.push("claim");
            return "claim-a";
        });
        let queryCount = 0;
        dispatcher.transaction.$queryRaw.mockImplementation(async () => {
            queryCount += 1;
            if (queryCount === 1) { return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }]; }
            if (queryCount === 2) {
                events.push("schedule-lock");
                return [{ id: schedule.id }];
            }
            if (queryCount === 3) {
                return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }];
            }
            return [{ id: job.id }];
        });
        dispatcher.prisma.employee_schedule.findFirst.mockImplementation(async () => {
            events.push("schedule-read");
            return schedule;
        });
        dispatcher.deliveryService.sendJob.mockImplementation(async () => {
            events.push("provider");
            return true;
        });

        await dispatcher.service.dispatchDueJobs();

        expect(events).toEqual(["claim", "job-read", "schedule-lock", "schedule-read", "provider"]);
        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
    });

    it("commits dispatch authorization before the provider call begins", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-dispatch-authorization",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const schedule = createEmployeeSchedule();
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, schedule)!;
        const dispatcher = createDispatchService();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(schedule);

        let transactionOpen = false;
        dispatcher.prisma.$transaction.mockImplementation(async (operation: (transaction: typeof dispatcher.transaction) => Promise<unknown>) => {
            transactionOpen = true;
            try {
                return await operation(dispatcher.transaction);
            } finally {
                transactionOpen = false;
            }
        });

        let providerEntered!: () => void;
        const providerStarted = new Promise<void>((resolve) => {
            providerEntered = resolve;
        });
        dispatcher.deliveryService.sendJob.mockImplementation(async () => {
            expect(transactionOpen).toBe(false);
            providerEntered();
            return true;
        });

        await dispatcher.service.dispatchDueJobs();
        await providerStarted;
        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(transactionOpen).toBe(false);
        expect(job.status).toBe("sent");
    });

    it("cancels without a provider call when a replacement commits before the dispatcher acquires the schedule lock", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-replacement-wins",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const schedule = createEmployeeSchedule();
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, schedule)!;
        const dispatcher = createDispatchService();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(schedule);

        let lockWaitStarted!: () => void;
        const lockWait = new Promise<void>((resolve) => {
            lockWaitStarted = resolve;
        });
        let replacementCommitted!: () => void;
        const replacementDone = new Promise<void>((resolve) => {
            replacementCommitted = resolve;
        });
        let queryCount = 0;
        dispatcher.transaction.$queryRaw.mockImplementation(async () => {
            queryCount += 1;
            if (queryCount === 1) { return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }]; }
            if (queryCount === 2) {
                lockWaitStarted();
                await replacementDone;
                return [{ id: schedule.id }];
            }
            if (queryCount === 3) {
                return [{ payload: { templateVariables: { [SMS_DELIVERY_SNAPSHOT_VARIABLE]: "synthetic-trigger-prepared" } }, status: "processing", claim_token: "claim-a" }];
            }
            return [{ id: job.id }];
        });

        const dispatchPromise = dispatcher.service.dispatchDueJobs();
        await lockWait;
        schedule.replaced = true;
        replacementCommitted();
        await dispatchPromise;

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.sentAt).toBeNull();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it.each([
        ["start date", { startDate: new Date("2026-07-16T00:00:00.000Z") }],
        ["end date", { endDate: new Date("2026-08-16T00:00:00.000Z") }],
        ["work address", { workAddress: "서울 강남구" }],
        ["replacement state", { replaced: true }],
        // Termination is NOT a fingerprint input, so this case only passes because the
        // fence checks terminatedAt explicitly. Until the contracted period was
        // preserved, terminating rewrote end_date and staled the job by accident.
        ["termination", { terminatedAt: new Date("2026-07-20T00:00:00.000Z") }],
        ["employee assignment", {
            primaryEmployeeId: 31,
            primaryEmployee: { id: 31, name: "박신규", phone: "010-2222-3333" },
        }],
        ["branch ownership", { branchId: "branch-2" }],
    ] as const)("refuses a claimed assignment when the schedule %s changed", async (_label, change) => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-stale",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const originalSchedule = createEmployeeSchedule();
        const currentSchedule = createEmployeeSchedule(change);
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, originalSchedule)!;
        const dispatcher = createDispatchService();
        const events: string[] = [];
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockImplementation(async () => {
            events.push("job-read");
            return job;
        });
        dispatcher.jobRepository.claimPendingWithRuleFence.mockImplementation(async () => {
            events.push("claim");
            return "claim-a";
        });
        dispatcher.prisma.employee_schedule.findFirst.mockImplementation(async () => {
            events.push("schedule-read");
            return currentSchedule;
        });
        dispatcher.deliveryService.sendJob.mockImplementation(async () => {
            events.push("provider");
            return true;
        });

        await dispatcher.service.dispatchDueJobs();

        expect(events).toEqual(["claim", "job-read", "schedule-read"]);
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.sentAt).toBeNull();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("refuses a legacy assignment job when the schedule has been replaced", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            id: "legacy-replaced-assignment",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 30,
                employeeName: "홍제공",
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {
                    employeeName: "홍제공",
                    clientName: "김산모",
                    serviceStartDate: "2026-07-15",
                },
            },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(
            createEmployeeSchedule({ replaced: true }),
        );

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.sentAt).toBeNull();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("refuses a legacy assignment job when an existing recipient field is stale", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            id: "legacy-stale-recipient-assignment",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 30,
                employeeName: "이전 담당자명",
                memberId: "employee:30",
                recipientName: "이전 담당자명",
                recipientPhone: "010-1111-2222",
                templateVariables: {
                    employeeName: "이전 담당자명",
                    clientName: "김산모",
                    serviceStartDate: "2026-07-15",
                },
            },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(createEmployeeSchedule());

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.sentAt).toBeNull();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("delivers an unchanged legacy assignment job", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({
            id: "legacy-valid-assignment",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 30,
                employeeName: "홍제공",
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {
                    employeeName: "홍제공",
                    clientName: "김산모",
                    serviceStartDate: "2026-07-15",
                },
            },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(createEmployeeSchedule());

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(job.sentAt).not.toBeNull();
    });

    it("does not overwrite a claimed job when the final job read observes a concurrent cancellation", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-lost",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, createEmployeeSchedule())!;
        const dispatcher = createDispatchService();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue({
            ...job,
            status: "canceled",
            canceledAt: new Date("2026-08-01T00:00:00.000Z"),
            cancelReason: "사용자가 발송을 취소함",
        } as MessageTriggerJobEntity);

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(dispatcher.prisma.employee_schedule.findFirst).not.toHaveBeenCalled();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledTimes(1); // Only the pre-CAS snapshot write.
    });

    it("leaves a claimed assignment retryable when the final schedule read fails", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-read-failure",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, createEmployeeSchedule())!;
        const dispatcher = createDispatchService();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockRejectedValue(new Error("schedule read failed"));

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledTimes(1); // Only the pre-CAS snapshot write.
        expect(job.status).toBe("processing");
    });

    it("refuses a claimed assignment when its schedule was deleted", async () => {
        const builder = createService();
        const employeeRule = createRule({
            id: "rule-employee-pre-send-deleted",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const job = builder.internals.buildEmployeeAssignmentJob(employeeRule, createEmployeeSchedule())!;
        const dispatcher = createDispatchService();
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.claimedJobRead.mockResolvedValue(job);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(null);

        await dispatcher.service.dispatchDueJobs();

        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.sentAt).toBeNull();
        expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
    });

    it.each([
        ["late link", "system:service_record_link", { endDate: new Date("2026-11-14T00:00:00.000Z"), replaced: false, terminatedAt: null }, true],
        ["link on end date", "system:service_record_link", { endDate: new Date("2026-11-05T00:00:00.000Z"), replaced: false, terminatedAt: null }, true],
        ["expired link", "system:service_record_link", { endDate: new Date("2026-11-04T00:00:00.000Z"), replaced: false, terminatedAt: null }, false],
        ["expired link at midnight", "system:service_record_link", { endDate: new Date("2026-11-04T00:00:00.000Z"), replaced: false, terminatedAt: null }, false, "2026-11-04T15:00:00.000Z"],
        ["link one millisecond before midnight", "system:service_record_link", { endDate: new Date("2026-11-04T00:00:00.000Z"), replaced: false, terminatedAt: null }, true, "2026-11-04T14:59:59.999Z"],
        ["replaced link", "system:service_record_link", { endDate: new Date("2026-11-14T00:00:00.000Z"), replaced: true, terminatedAt: null }, false],
        ["terminated link", "system:service_record_link", { endDate: new Date("2026-11-14T00:00:00.000Z"), replaced: false, terminatedAt: new Date() }, false],
        ["replaced past-end link", "system:service_record_link", { endDate: new Date("2026-11-04T00:00:00.000Z"), replaced: true, terminatedAt: null }, false],
        ["terminated past-end link", "system:service_record_link", { endDate: new Date("2026-11-04T00:00:00.000Z"), replaced: false, terminatedAt: new Date() }, false],
        ["deleted link schedule", "system:service_record_link", null, false],
        ["another rule", "rule-1", null, false],
    ])("dispatches three-day-old jobs only for an eligible automatic link: %s", async (_name, ruleId, schedule, sends, now = "2026-11-05T03:00:00.000Z") => {
        jest.useFakeTimers().setSystemTime(new Date(now));
        try {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId, employeeScheduleId: 10,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                payload: { memberId: "employee:30", recipientName: "제공인력", recipientPhone: "010-1234-5678",
                    buttonUrl: "https://mobile.test/service-record/efl_link",
                    templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" } },
                scheduledFor: new Date("2026-11-02T03:00:00.000Z") });
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(schedule && {
                ...schedule,
                client: { serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2026-11-03T00:00:00.000Z"), endDate: new Date("2026-11-14T00:00:00.000Z") },
            });

            await dispatcher.service.dispatchDueJobs();

            expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledTimes(sends ? 1 : 0);
            expect(job.status).toBe(sends ? "sent" : "canceled");
            if (!sends && ruleId === "system:service_record_link") {
                expect(job.cancelReason).toBe(_name.startsWith("expired link")
                    ? SERVICE_RECORD_LINK_ENDED_REASON
                    : "Service record link schedule ended or replaced");
            }
            if (ruleId === "rule-1") expect(job.cancelReason).toBe("기존 발송 예정 24시간 경과");
            else {
                expect(job.cancelReason).not.toBe("기존 발송 예정 24시간 경과");
                expect(dispatcher.prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
                    where: { id: 10, branchId },
                    select: { endDate: true, replaced: true, terminatedAt: true,
                        client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } } },
                });
            }
        } finally {
            jest.useRealTimers();
        }
    });

    it.each([
        ["automatic", "pre_booking", true],
        ["automatic", "waiting", false],
        ["automatic", "active", false],
        ["manual", "pre_booking", true],
        ["manual", "waiting", false],
        ["retry", "pre_booking", true],
        ["retry", "waiting", false],
        ["automatic", "waiting", true, "end"],
        ["manual", "waiting", true, "start"],
        ["retry", "waiting", true, "end"],
        ["manual", "waiting", false, "client"],
        ["automatic", "waiting", true, "confirmation"],
    ])("dispatch gates %s link jobs for %s clients (missing %s)", async (kind, serviceStatus, cancels, missing = "none") => {
        const dispatcher = createDispatchService();
        const job = createJob({
            ruleId: "system:service_record_link", employeeScheduleId: 10,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: kind === "automatic" ? "system:service_record_link:schedule:10:primary"
                : kind === "manual" ? "system:service_record_link:schedule:10:primary:manual:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
                    : "agent-sms-retry:synthetic-copy",
            payload: { memberId: "employee:30", recipientName: "제공인력", recipientPhone: "010-1234-5678",
                buttonUrl: "https://mobile.test/service-record/efl_link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" } },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue({
            endDate: new Date(Date.now() + 86400000), replaced: false, terminatedAt: null,
            client: missing === "client" ? null : {
                serviceStatus,
                bookingConfirmedAt: missing === "confirmation" || serviceStatus === "pre_booking" ? null : new Date("2026-01-01"),
                startDate: missing === "start" ? null : new Date(),
                endDate: missing === "end" ? null : new Date(Date.now() + 86400000),
            },
        });
        await dispatcher.service.dispatchDueJobs();
        expect(job.status).toBe(cancels ? "canceled" : "sent");
        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledTimes(cancels ? 0 : 1);
        if (cancels) {
            expect(job.cancelReason).toBe("예약 전 고객이라 제공기록지 링크를 발송하지 않았습니다");
            expect(dispatcher.deliveryService.prepareJob).not.toHaveBeenCalled();
            expect(job.nextAttemptAt).toBeNull();
            expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
        }
    });

    // 규칙 메시지-04: 대상 고객 상태 send-time gate.
    describe("target client status gate", () => {
        const kstDay = (offsetDays: number): Date => {
            const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 86_400_000);
            return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
        };
        const EFFECTIVE_STATUSES = [
            "pre_booking", "waiting", "active", "completed", "terminated", "replacement_requested",
        ] as const;
        type EffectiveStatus = (typeof EFFECTIVE_STATUSES)[number];
        const clientFacts = (status: EffectiveStatus) => {
            switch (status) {
                case "pre_booking":
                    return { serviceStatus: null, bookingConfirmedAt: null, startDate: kstDay(3), endDate: kstDay(20) };
                case "waiting":
                    return { serviceStatus: null, bookingConfirmedAt: new Date("2026-01-01"), startDate: kstDay(3), endDate: kstDay(20) };
                case "active":
                    return { serviceStatus: null, bookingConfirmedAt: new Date("2026-01-01"), startDate: kstDay(-3), endDate: kstDay(10) };
                case "completed":
                    return { serviceStatus: null, bookingConfirmedAt: new Date("2026-01-01"), startDate: kstDay(-20), endDate: kstDay(-2) };
                case "terminated":
                case "replacement_requested":
                    return { serviceStatus: status, bookingConfirmedAt: new Date("2026-01-01"), startDate: kstDay(-3), endDate: kstDay(10) };
            }
        };
        const targets: MessageTriggerTargetClientStatus[] = ["all", "pre_booking", "waiting", "active"];

        const dispatchWith = async (
            target: MessageTriggerTargetClientStatus,
            status: EffectiveStatus,
            jobOverrides: Parameters<typeof createJob>[0] = {},
        ) => {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId: "rule-target", ...jobOverrides });
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                createRule({ id: "rule-target", targetClientStatus: target }),
            );
            dispatcher.prisma.client.findFirst.mockResolvedValue(clientFacts(status));
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            await dispatcher.service.dispatchDueJobs();
            return { dispatcher, job };
        };

        it.each(targets.flatMap((target) => EFFECTIVE_STATUSES.map((status) => [
            target, status, target === "all" || target === status,
        ] as const)))("target %s with an effective %s client sends=%s", async (target, status, sends) => {
            const { dispatcher, job } = await dispatchWith(target, status);

            expect(job.status).toBe(sends ? "sent" : "canceled");
            expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledTimes(sends ? 1 : 0);
            if (target === "all") {
                // 전체 behaves exactly as before: no client read, every status sends.
                expect(dispatcher.prisma.client.findFirst).not.toHaveBeenCalled();
            }
            if (!sends) {
                expect(job.cancelReason).toContain("target_client_status_mismatch");
                expect(dispatcher.deliveryService.prepareJob).not.toHaveBeenCalled();
                expect(dispatcher.deliveryService.sendPreparedJob).not.toHaveBeenCalled();
                expect(job.attempts).toBe(0);
                expect(job.nextAttemptAt).toBeNull();
                expect(dispatcher.jobRepository.update).toHaveBeenCalledWith(job);
            }
        });

        it("counts an unconfirmed client WITH dates as pre_booking, whatever the stored column says", async () => {
            const facts = { serviceStatus: "waiting", bookingConfirmedAt: null, startDate: kstDay(3), endDate: kstDay(20) };
            for (const [target, sends] of [["pre_booking", true], ["waiting", false]] as const) {
                const dispatcher = createDispatchService();
                const job = createJob({ ruleId: "rule-target" });
                dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                    createRule({ id: "rule-target", targetClientStatus: target }),
                );
                dispatcher.prisma.client.findFirst.mockResolvedValue(facts);
                dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
                await dispatcher.service.dispatchDueJobs();
                expect(job.status).toBe(sends ? "sent" : "canceled");
            }
        });

        it("reads the rule row at dispatch (including a global rule) and the client fresh by the job's client and branch", async () => {
            const { dispatcher, job } = await dispatchWith("waiting", "waiting");

            expect(job.status).toBe("sent");
            expect(dispatcher.ruleRepository.findByIdIncludingGlobal).toHaveBeenCalledWith(branchId, "rule-target");
            expect(dispatcher.prisma.client.findFirst).toHaveBeenCalledWith({
                where: { id: 1, branchId },
                select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true },
            });
        });

        it("applies a global rule's target status (branch-scoped lookups cannot see it)", async () => {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId: "rule-global" });
            // findById is branch-scoped and returns null for a branchless rule;
            // only the global-aware lookup may be consulted.
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                createRule({ id: "rule-global", branchId: null, targetClientStatus: "active" }),
            );
            dispatcher.prisma.client.findFirst.mockResolvedValue(clientFacts("waiting"));
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            await dispatcher.service.dispatchDueJobs();

            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toContain("target_client_status_mismatch");
        });

        it("uses the rule's value at dispatch time, not anything stored on the job", async () => {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId: "rule-target" });
            dispatcher.prisma.client.findFirst.mockResolvedValue(clientFacts("waiting"));
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            // First tick: the admin has set 진행 only.
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValueOnce(
                createRule({ id: "rule-target", targetClientStatus: "active" }),
            );
            await dispatcher.service.dispatchDueJobs();
            expect(job.status).toBe("canceled");

            // The routine is then switched to 전체 and a resync re-pends the
            // system-canceled job; the gate re-reads the rule and now sends.
            job.status = "pending";
            job.cancelReason = null;
            job.canceledAt = null;
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                createRule({ id: "rule-target", targetClientStatus: "all" }),
            );
            await dispatcher.service.dispatchDueJobs();
            expect(job.status).toBe("sent");
        });

        it("sends a 대기-only job after 예약 확정 revives the skipped job (예약 전 -> 대기)", async () => {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId: "rule-target" });
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                createRule({ id: "rule-target", targetClientStatus: "waiting" }),
            );
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            // 09:00 — the client is still 예약 전.
            dispatcher.prisma.client.findFirst.mockResolvedValue(clientFacts("pre_booking"));
            await dispatcher.service.dispatchDueJobs();
            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toContain("target_client_status_mismatch");
            expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();

            // 14:00 — [예약 확정]; the resync's upsert flips the (non-user)
            // canceled row back to pending, which dispatch evaluates again.
            job.status = "pending";
            job.cancelReason = null;
            job.canceledAt = null;
            dispatcher.prisma.client.findFirst.mockResolvedValue(clientFacts("waiting"));
            await dispatcher.service.dispatchDueJobs();
            expect(job.status).toBe("sent");
            expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledTimes(1);
        });

        it("does not apply the gate to a job with no client", async () => {
            const { dispatcher, job } = await dispatchWith("waiting", "pre_booking", { clientId: null });

            expect(job.status).toBe("sent");
            expect(dispatcher.prisma.client.findFirst).not.toHaveBeenCalled();
        });

        it("applies the gate for an employee-recipient job that has a client", async () => {
            const { job } = await dispatchWith("active", "waiting", {
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            });

            expect(job.status).toBe("canceled");
        });

        it.each([
            ["an agent-approved manual retry (agent-sms-retry dedupe key, original rule)", { ruleId: "rule-target", dedupeKey: "agent-sms-retry:approved-1" }],
            ["an agent-scheduled send (agent-sms rule id)", { ruleId: "agent-sms:approved-2", dedupeKey: "agent-sms:approved-2:client:1" }],
        ])("does not apply the gate to %s", async (_name, jobOverrides) => {
            const { dispatcher, job } = await dispatchWith("active", "waiting", jobOverrides);

            expect(job.status).toBe("sent");
            expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledTimes(1);
            expect(dispatcher.ruleRepository.findByIdIncludingGlobal).not.toHaveBeenCalled();
            expect(dispatcher.prisma.client.findFirst).not.toHaveBeenCalled();
        });

        it("still skips an automatic job with the same non-matching target and client", async () => {
            const { dispatcher, job } = await dispatchWith("active", "waiting", { dedupeKey: "rule-target:client:1:auto" });

            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toContain("target_client_status_mismatch");
            expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        });

        it("skips a non-all target when the client row can no longer be read", async () => {
            const dispatcher = createDispatchService();
            const job = createJob({ ruleId: "rule-target" });
            dispatcher.ruleRepository.findByIdIncludingGlobal.mockResolvedValue(
                createRule({ id: "rule-target", targetClientStatus: "active" }),
            );
            dispatcher.prisma.client.findFirst.mockResolvedValue(null);
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            await dispatcher.service.dispatchDueJobs();

            expect(job.status).toBe("canceled");
            expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        });
    });

    it("does not apply the pre_booking gate to a link job without a schedule id", async () => {
        const dispatcher = createDispatchService();
        const job = createJob({ templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: "agent-sms-retry:synthetic-no-schedule",
            payload: { memberId: "employee:30", recipientName: "제공인력", recipientPhone: "010-1234-5678",
                buttonUrl: "https://mobile.test/service-record/efl_link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" } } });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        await dispatcher.service.dispatchDueJobs();
        expect(job.cancelReason).toBe("제공기록지 링크가 철회되어 발송하지 않았습니다");
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
        expect(dispatcher.prisma.employee_schedule.findFirst).not.toHaveBeenCalled();
    });

    it.each([
        ["replaced", { replaced: true }, "Service record link schedule ended or replaced"],
        ["terminated", { terminatedAt: new Date() }, "Service record link schedule ended or replaced"],
        ["expired", { endDate: new Date("2026-01-01") }, SERVICE_RECORD_LINK_ENDED_REASON],
        ["missing", null, "Service record link schedule ended or replaced"],
    ])("keeps %s cancellation ahead of pre_booking", async (_name, overrides, reason) => {
        const dispatcher = createDispatchService();
        const job = createJob({ ruleId: "system:service_record_link", employeeScheduleId: 10,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: "system:service_record_link:schedule:10:primary" });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue(overrides && {
            endDate: new Date(Date.now() + 86400000), replaced: false, terminatedAt: null,
            client: { serviceStatus: "pre_booking", bookingConfirmedAt: null, startDate: new Date(), endDate: new Date() },
            ...overrides,
        });
        await dispatcher.service.dispatchDueJobs();
        expect(job.cancelReason).toBe(reason);
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
    });

    it.each(["manual", "retry"])("does not apply automatic schedule/expiry cancels to a %s link", async (kind) => {
        const dispatcher = createDispatchService();
        const job = createJob({ ruleId: "system:service_record_link", employeeScheduleId: 10,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: kind === "manual" ? "system:service_record_link:schedule:10:primary:manual:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" : "agent-sms-retry:synthetic-copy",
            payload: { memberId: "employee:30", recipientName: "제공인력", recipientPhone: "010-1234-5678",
                buttonUrl: "https://mobile.test/service-record/efl_link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_link" } },
        });
        dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        dispatcher.prisma.employee_schedule.findFirst.mockResolvedValue({
            replaced: true, terminatedAt: new Date(), endDate: new Date("2026-01-01"),
            client: { serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date(), endDate: new Date() },
        });
        await dispatcher.service.dispatchDueJobs();
        expect(job.status).toBe("sent");
        expect(dispatcher.deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(dispatcher.prisma.employee_schedule.findFirst).toHaveBeenCalledTimes(1);
        expect(dispatcher.prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: { id: 10, branchId },
            select: { client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } } },
        });
    });

    it("cancels an existing pending job once its scheduled time is at least 24 hours old", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const { service, deliveryService, jobRepository } = createDispatchService();
            const job = createJob({
                scheduledFor: new Date("2026-07-08T12:00:00.000Z"),
            });
            jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);

            await service.dispatchDueJobs();

            expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(
                job.id,
                job.branchId,
                expect.any(Object),
            );
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toBe("기존 발송 예정 24시간 경과");
            expect(jobRepository.update).toHaveBeenCalledWith(job);
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not exempt a three-day-old manual service-record link job from the generic expiry", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-11-05T03:00:00.000Z"));
        try {
            const dispatcher = createDispatchService();
            const job = createJob({
                ruleId: "system:service_record_link", employeeScheduleId: 10,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: "system:service_record_link:schedule:10:primary:manual:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                scheduledFor: new Date("2026-11-02T03:00:00.000Z"),
            });
            dispatcher.jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            await dispatcher.service.dispatchDueJobs();
            expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.cancelReason).toBe("기존 발송 예정 24시간 경과");
            expect(dispatcher.prisma.employee_schedule.findFirst).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps a catch-up job behind its predecessor by the configured interval after downtime", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:10:00.000Z"));
        try {
            const { service, deliveryService, jobRepository, prisma } = createDispatchService();
            const job = createJob({
                scheduledFor: new Date("2026-07-09T12:03:00.000Z"),
                payload: {
                    memberId: "1",
                    recipientName: "김산모",
                    recipientPhone: "010-1234-5678",
                    templateVariables: {},
                    catchUp: {
                        batchId: "client:1:2026-07-09T12:00:00.000Z",
                        sequence: 2,
                        intervalMinutes: 3,
                        originalScheduledFor: "2026-07-07T00:00:00.000Z",
                        predecessorDedupeKey: "dedupe-predecessor",
                    },
                },
            });
            jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
            prisma.message_trigger_job.findUnique.mockResolvedValue({
                status: "sent",
                sentAt: new Date("2026-07-09T12:10:00.000Z"),
                canceledAt: null,
                nextAttemptAt: null,
                updatedAt: new Date("2026-07-09T12:10:00.000Z"),
            });

            await service.dispatchDueJobs();

            expect(prisma.message_trigger_job.findUnique).toHaveBeenCalledWith({
                where: { dedupeKey: "dedupe-predecessor" },
                select: {
                    status: true,
                    scheduledFor: true,
                    sentAt: true,
                    canceledAt: true,
                    nextAttemptAt: true,
                    updatedAt: true,
                },
            });
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("pending");
            expect(job.scheduledFor).toEqual(new Date("2026-07-09T12:13:00.000Z"));
            expect(jobRepository.update).toHaveBeenCalledWith(job);
        } finally {
            jest.useRealTimers();
        }
    });

    it("persists a settings refusal without incrementing attempts", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 2 });
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        deliveryService.sendJob.mockImplementation(async () => {
            job.markNeedsSetup("필수 정보 누락 (name)");
            return false;
        });

        await service.dispatchDueJobs();

        expect(job.status).toBe("needs_setup");
        expect(job.attempts).toBe(2);
        expect(job.nextAttemptAt).toBeNull();
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("persists an automatic preparation refusal under its retained claim without authorizing dispatch", async () => {
        const { service, deliveryService, jobRepository, transaction } = createDispatchService();
        const job = createJob({ attempts: 2 });
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        deliveryService.prepareJob.mockImplementation(async () => {
            job.markNeedsSetup("필수 정보 누락 (name)");
            return null;
        });
        await service.dispatchDueJobs();
        expect(jobRepository.update).toHaveBeenCalledWith(expect.objectContaining({
            status: "needs_setup", claimToken: "claim-a", attempts: 2, nextAttemptAt: null,
        }));
        expect(deliveryService.sendPreparedJob).not.toHaveBeenCalled();
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("terminal-fails after TRIGGER_JOB_MAX_ATTEMPTS transient defers", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: TRIGGER_JOB_MAX_ATTEMPTS - 1 });
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(
            new TriggerJobDeferredError("transient", "Provider timeout"),
        );

        await service.dispatchDueJobs();

        expect(job.status).toBe("failed");
        expect(job.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(job.cancelReason).toBe("Provider timeout");
    });

    it("marks a raw transient Prisma delivery error failed instead of deferring", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 0 });
        const prismaError = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
            code: "P1001",
            clientVersion: "test",
        });
        jobRepository.findDuePendingSystemScope.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(prismaError);

        await service.dispatchDueJobs();

        expect(job.status).toBe("failed");
        expect(job.attempts).toBe(0);
        expect(job.nextAttemptAt).toBeNull();
        expect(job.cancelReason).toContain("Can't reach database server");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("reclaim marks stale processing job sent when a sent log exists; re-queues pending otherwise", async () => {
        const { service, jobRepository, messageLogRepository } = createDispatchService();
        const deliveredJob = createJob({ id: "job-delivered", status: "processing" });
        const unsentJob = createJob({ id: "job-unsent", status: "processing" });
        jobRepository.findStaleProcessingSystemScope.mockResolvedValue([deliveredJob, unsentJob]);
        messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set([deliveredJob.id]));

        await service.dispatchDueJobs();

        expect(deliveredJob.status).toBe("sent");
        expect(unsentJob.status).toBe("pending");
        expect(unsentJob.attempts).toBe(1);
        expect(unsentJob.nextAttemptAt).toBeInstanceOf(Date);
        expect(jobRepository.update).toHaveBeenCalledTimes(2);
    });

    it("does not requeue a stale dispatch-authorized job after a worker crash", async () => {
        const { service, jobRepository, messageLogRepository } = createDispatchService();
        const dispatchingJob = createJob({ id: "job-dispatching", status: "dispatching" });
        jobRepository.findStaleProcessingSystemScope.mockResolvedValue([dispatchingJob]);
        messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());

        await service.dispatchDueJobs();

        expect(dispatchingJob.status).toBe("failed");
        expect(dispatchingJob.cancelReason).toContain("불확실");
        expect(dispatchingJob.nextAttemptAt).toBeNull();
        expect(jobRepository.update).toHaveBeenCalledWith(dispatchingJob);
    });

    it("reclaim terminal-fails a stale job whose provider attempt is uncertain instead of resending it", async () => {
        // Provider accepted (or the call went ambiguous) but the local result
        // save failed: the message_log row stays started/uncertain. Reclaiming
        // that job into pending would cross the provider boundary a second
        // time for an attempt that may already be accepted.
        const { service, jobRepository, messageLogRepository } = createDispatchService();
        const uncertainJob = createJob({ id: "job-uncertain", status: "processing" });
        const unsentJob = createJob({ id: "job-plain-unsent", status: "processing" });
        jobRepository.findStaleProcessingSystemScope.mockResolvedValue([uncertainJob, unsentJob]);
        messageLogRepository.findSentTriggerJobIdsSystemScope.mockResolvedValue(new Set());
        messageLogRepository.findUncertainTriggerJobIdsSystemScope.mockResolvedValue(
            new Set([uncertainJob.id]),
        );

        await service.dispatchDueJobs();

        expect(uncertainJob.status).toBe("failed");
        expect(uncertainJob.cancelReason).toContain("불확실");
        expect(uncertainJob.nextAttemptAt).toBeNull();
        // The job without an uncertain log still follows the bounded requeue path.
        expect(unsentJob.status).toBe("pending");
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
        jobRepository.findStaleProcessingSystemScope.mockImplementation(async () => {
            order.push("reclaim");
            return [];
        });
        jobRepository.findDuePendingSystemScope.mockImplementation(async () => {
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
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(
            new Map([[branchId, new Date("2026-07-09T00:00:00.000Z")]]),
        );
        ruleRepository.update.mockResolvedValue(inactiveDefault);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await service.dispatchDueJobs();

        expect(order).toEqual(["reclaim", "recover", "stale", "due"]);
        expect(ruleRepository.update).toHaveBeenCalledWith(
            branchId,
            inactiveDefault,
            expect.any(Object),
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(
            inactiveDefault.branchId,
            inactiveDefault.id,
            expect.any(Object),
        );
        expect(rebuildSpy).toHaveBeenCalledWith(
            inactiveDefault.branchId,
            inactiveDefault,
            false,
            expect.any(Object),
        );
    });

    it("a failing per-job status write does not abort the rest of the batch", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const firstJob = createJob({ id: "job-first" });
        const secondJob = createJob({ id: "job-second" });
        const logger = (service as unknown as {
            logger: { error: (message: string, stack?: string) => void };
        }).logger;
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
        jobRepository.findDuePendingSystemScope.mockResolvedValue([firstJob, secondJob]);
        jobRepository.update.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("write failed"));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).toHaveBeenCalledTimes(2);
        expect(firstJob.status).toBe("sent");
        expect(secondJob.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledTimes(4);
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
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(staleRule.id, "규칙 재생성");
        expect(rebuildSpy).toHaveBeenCalledWith(
            staleRule.branchId,
            staleRule,
            false,
            expect.any(Object),
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
            expect.any(Object),
        );
        expect(jobRepository.cancelPendingOlderThan).not.toHaveBeenCalled();
    });

    it("reconciles a rebuilt same-dedupe pending job using the rule update fence", async () => {
        const { service, ruleRepository, jobRepository } = createService();
        const ruleUpdatedAt = new Date("2026-07-09T00:00:00.000Z");
        const rebuiltRule = createRule({
            id: "rule-rebuilt-dedupe",
            jobsStale: false,
            updatedAt: ruleUpdatedAt,
        });
        ruleRepository.findById.mockResolvedValue(rebuiltRule);
        jobRepository.hasActiveJobsBefore.mockResolvedValue(false);

        await expect(service.isRuleMutationComplete(
            branchId,
            rebuiltRule.id,
            { name: rebuiltRule.name },
        )).resolves.toBe(true);

        expect(jobRepository.hasActiveJobsBefore).toHaveBeenCalledWith(
            branchId,
            rebuiltRule.id,
            ruleUpdatedAt,
        );
    });

    it("stale rebuild batch-cancels pending jobs before rebuilding and does not recreate jobs older than the grace window", async () => {
        const now = new Date("2026-07-09T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        try {
            const ruleRepository = {
                findStaleRules: jest.fn(),
                clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
            };
            const jobRepository = {
                cancelPendingByRuleId: jest.fn().mockResolvedValue(2),
                cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
                cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                    _branchId: string,
                    ruleId: string,
                    _expectedUpdatedAt: Date,
                    _expectedJobsStale: boolean,
                    reason: string,
                ) => {
                    await jobRepository.cancelPendingByRuleId(ruleId, reason);
                    return 2;
                }),
                upsertPending: jest.fn().mockResolvedValue(undefined),
                upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                    await jobRepository.upsertPending(job);
                    return job;
                }),
            };
            const messageSenderApprovalService = createMessageSenderApprovalService();
            const prisma = {
                client: {
                    findMany: jest.fn().mockResolvedValue([
                        {
                            id: 1,
                            name: "김산모",
                            phone: "010-1234-5678",
                            type: null,
                            startDate: new Date("2026-07-07T00:00:00.000Z"),
                            endDate: null,
                            duration: null,
                            fullPrice: null,
                            grant: null,
                            actualPrice: null,
                            createdAt: new Date("2026-07-01T00:00:00.000Z"),
                            area: null,
                        },
                    ]),
                },
            };
            const service = new MessageTriggerService(
                prisma as never,
                {} as never,
                messageSenderApprovalService as never,
                ruleRepository as never,
                jobRepository as never,
                createMessageLogRepository() as never,
                createSystemTemplateService() as never,
                createTemplateAutomationLock() as never,
                undefined,
                createOverrideRepository() as never,
                createAutomationActivationService() as never,
                createBranchLock(prisma) as never,
            undefined, createLegacyAutomationDeliveryGate(prisma as never, createBranchLock(prisma) as never));
            const staleRule = createRule({
                id: "rule-stale-past-cleanup",
                jobsStale: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                updatedAt: new Date("2026-07-08T00:00:00.000Z"),
            });
            ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
            const internals = service as unknown as ServiceInternals;

            await internals.processStaleRuleRebuilds();

            expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(staleRule.id, "규칙 재생성");
            expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(jobRepository.cancelPendingOlderThan).not.toHaveBeenCalled();
            expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
                staleRule.id,
                staleRule.updatedAt,
                expect.any(Object),
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("processStaleRuleRebuilds leaves the flag set when the rule changed mid-rebuild and the next pass converges", async () => {
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
        const editedRule = createRule({
            id: "rule-stale-changed",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.AFTER_DAYS,
            offsetDays: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-03T00:01:00.000Z"),
        });
        ruleRepository.findStaleRules
            .mockResolvedValueOnce([staleRule])
            .mockResolvedValueOnce([editedRule]);
        ruleRepository.clearJobsStaleIfUnchanged
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();
        await internals.processStaleRuleRebuilds();

        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
            expect.any(Object),
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            editedRule.id,
            editedRule.updatedAt,
            expect.any(Object),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenNthCalledWith(
            2,
            editedRule.branchId,
            editedRule,
            false,
            expect.any(Object),
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
            expect.any(Object),
        );
    });

    it("drains older OFF-branch rules so the bounded stale queue reaches an enabled branch", async () => {
        const { service, ruleRepository, messageAutomationActivationService } = createDispatchService();
        const disabledRules = Array.from({ length: 12 }, (_, index) => createRule({
            id: `off-rule-${index}`,
            branchId,
            isActive: index === 0, // Legacy active bits must not rebuild under an OFF parent.
            jobsStale: true,
        }));
        const enabledRule = createRule({ id: "enabled-branch-rule", branchId: "other-branch", jobsStale: true });
        const queue = [...disabledRules, enabledRule];
        messageAutomationActivationService.getTriggerDispatchEnabled.mockImplementation(async (id: string) => id !== branchId);
        ruleRepository.findStaleRules.mockImplementation(async () => queue.filter((rule) => rule.jobsStale).slice(0, 10));
        ruleRepository.clearJobsStaleIfUnchanged.mockImplementation(async (id: string) => {
            queue.find((rule) => rule.id === id)!.jobsStale = false;
            return true;
        });
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();
        await internals.processStaleRuleRebuilds();

        expect(queue.every((rule) => !rule.jobsStale)).toBe(true);
        expect(rebuildSpy).toHaveBeenCalledTimes(1);
        expect(rebuildSpy).toHaveBeenCalledWith(enabledRule.branchId, enabledRule, false, expect.any(Object));
    });

    it("does not rebuild or clear when a second stale worker loses the generation fence", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-worker-b",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-07T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
        jobRepository.cancelPendingForRuleGeneration.mockResolvedValue(null);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
            staleRule.branchId,
            staleRule.id,
            staleRule.updatedAt,
            true,
            "규칙 재생성",
            expect.any(Object),
            expect.any(Object),
        );
        expect(rebuildSpy).not.toHaveBeenCalled();
        expect(ruleRepository.clearJobsStaleIfUnchanged).not.toHaveBeenCalled();
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
            expect.any(Object),
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(firstRule.id),
            expect.any(String),
        );
    });

    it("maps the service information name variable from the client name", () => {
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });

        const variables = buildClientTemplateVariables(rule, {
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
        const rule = createRule({
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        const variables = buildClientTemplateVariables(rule, {
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
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.PRICE_INFO,
        });

        const variables = buildClientTemplateVariables(rule, {
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

    // Variables these templates deliberately do NOT get from buildClientTemplateVariables:
    // they are injected into the payload later by the delivery-time enricher (e.g. a signed
    // receipt URL), not derived from the client record at rule-build time.
    const DELIVERY_TIME_VARIABLES: Partial<Record<MessageTriggerTemplateKey, readonly string[]>> = {
        [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: ["receiptUrl"],
    };

    // Tripwire: today buildClientTemplateVariables does NOT produce receiptUrl for
    // SERVICE_END_NOTICE (a later delivery-time enricher task injects it into the job
    // payload). If a future change makes the builder start supplying it, this must fail
    // so DELIVERY_TIME_VARIABLES above is consciously updated rather than silently stale.
    it("does not derive receiptUrl for SERVICE_END_NOTICE from the client record today", () => {
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        });

        const variables = buildClientTemplateVariables(rule, {
            name: "자동발송 테스트",
            phone: "010-6621-1878",
            type: "A가1형",
            duration: 10,
            startDate: new Date("2026-08-31T00:00:00.000Z"),
            endDate: new Date("2026-09-11T00:00:00.000Z"),
            createdAt: new Date("2026-08-24T00:00:00.000Z"),
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            area: { bankAccountInfo: { bankName: "신한은행", accNum: "110-123-456789" } },
        });

        expect(variables["receiptUrl"]).toBeUndefined();
    });

    it.each(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS)(
        "builds every required %s variable from a complete client record",
        (templateKey) => {
            const rule = createRule({
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey,
            });

            const variables = buildClientTemplateVariables(rule, {
                name: "자동발송 테스트",
                phone: "010-6621-1878",
                type: "A가1형",
                duration: 10,
                startDate: new Date("2026-08-31T00:00:00.000Z"),
                endDate: new Date("2026-09-11T00:00:00.000Z"),
                createdAt: new Date("2026-08-24T00:00:00.000Z"),
                fullPrice: "3000000",
                grant: "2000000",
                actualPrice: "1000000",
                area: { bankAccountInfo: { bankName: "신한은행", accNum: "110-123-456789" } },
            });

            const deliveryTimeKeys = new Set(DELIVERY_TIME_VARIABLES[templateKey] ?? []);
            const missingRequiredVariables = MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey]
                .requiredVariables
                .map((variable) => variable.key)
                .filter((key) => !deliveryTimeKeys.has(key))
                .filter((key) => !variables[key]?.trim());

            expect(missingRequiredVariables).toEqual([]);
        },
    );

    const createSyncService = (clientOverrides: Partial<{
        id: number;
        name: string;
        phone: string | null;
        type: string | null;
        startDate: Date | null;
        endDate: Date | null;
        serviceEndNoticeSentAt: Date | null;
        createdAt: Date | null;
    }> = {}) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
            findPendingByRuleIdsAndClientId: jest.fn().mockResolvedValue([]),
            cancelPendingByClientContext: jest.fn().mockResolvedValue(0),
            cancelProcessingClaim: jest.fn().mockResolvedValue(true),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
                scope?: MessageTriggerJobCancellationScope,
            ) => {
                if (scope?.clientId === undefined) return 0;
                const jobs = await jobRepository.findPendingByRuleIdsAndClientId([ruleId], scope.clientId);
                for (const job of jobs) {
                    if (job.status === "needs_setup" && scope.needsSetup !== "all"
                        && !(scope.needsSetup === "within_window" && job.scheduledFor.getTime() > Date.now() - PAST_OCCURRENCE_GRACE_MS)) continue;
                    job.cancel(reason);
                    await jobRepository.update(job);
                }
                return jobs.length;
            }),
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
                    serviceEndNoticeSentAt: null,
                    createdAt: new Date("2026-06-27T00:00:00.000Z"),
                    ...clientOverrides,
                }),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const systemSettingService = {
            getMessageAutomationPastTriggerConfig: jest.fn().mockResolvedValue({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            }),
        };
        const messageAutomationActivationService = createAutomationActivationService();
        const messageAutomationBranchLockService = createBranchLock(prisma);
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            createSystemTemplateService() as never,
            createTemplateAutomationLock(prisma) as never,
            systemSettingService as never,
            createOverrideRepository() as never,
            messageAutomationActivationService as never,
            messageAutomationBranchLockService as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, messageAutomationBranchLockService as never));
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
            systemSettingService,
            messageAutomationActivationService,
            messageAutomationBranchLockService,
        };
    };

    const createEmployeeSchedule = (
        overrides: Partial<EmployeeAssignmentScheduleSource> = {},
    ): EmployeeAssignmentScheduleSource => ({
        id: 77,
        branchId,
        clientId: 1,
        workAddress: "인천 미추홀구",
        startDate: new Date("2026-07-15T00:00:00.000Z"),
        endDate: new Date("2026-08-15T00:00:00.000Z"),
        replaced: false,
        terminatedAt: null,
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
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
            findPendingByRuleIdsAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            findSentByRuleIdAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
                scope?: MessageTriggerJobCancellationScope,
            ) => {
                if (scope?.employeeScheduleId === undefined) return 0;
                const jobs = await jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
                    [ruleId],
                    scope.employeeScheduleId,
                );
                for (const job of jobs) {
                    if (job.status === "needs_setup" && scope.needsSetup !== "all") continue;
                    job.cancel(reason);
                    await jobRepository.update(job);
                }
                return jobs.length;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(createEmployeeSchedule(scheduleOverrides)),
                findMany: jest.fn().mockResolvedValue([]),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageAutomationActivationService = createAutomationActivationService();
        const messageAutomationBranchLockService = createBranchLock(prisma);
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            createSystemTemplateService() as never,
            createTemplateAutomationLock(prisma) as never,
            undefined,
            createOverrideRepository() as never,
            messageAutomationActivationService as never,
            messageAutomationBranchLockService as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, messageAutomationBranchLockService as never));
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
            messageAutomationActivationService,
            messageAutomationBranchLockService,
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

    it("refreshes assignment jobs for every active schedule owned by a client", async () => {
        const sync = createEmployeeSyncService();
        sync.prisma.employee_schedule.findMany.mockResolvedValue([{ id: 77 }, { id: 88 }]);
        const scheduleSync = jest
            .spyOn(sync.service, "syncEmployeeAssignmentRulesForSchedule")
            .mockResolvedValue(true);

        await sync.service.syncEmployeeAssignmentRulesForClient(branchId, 1);

        expect(sync.prisma.employee_schedule.findMany).toHaveBeenCalledWith({
            where: { branchId, clientId: 1, replaced: false, terminatedAt: null },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        expect(scheduleSync).toHaveBeenNthCalledWith(
            1,
            branchId,
            77,
            true,
        );
        expect(scheduleSync).toHaveBeenNthCalledWith(
            2,
            branchId,
            88,
            true,
        );
    });

    it("refreshes assignment jobs for every active schedule owned by an employee", async () => {
        const sync = createEmployeeSyncService();
        sync.prisma.employee_schedule.findMany.mockResolvedValue([{ id: 77 }, { id: 88 }]);
        const scheduleSync = jest
            .spyOn(sync.service, "syncEmployeeAssignmentRulesForSchedule")
            .mockResolvedValue(true);

        await sync.service.syncEmployeeAssignmentRulesForEmployee(branchId, 30);

        expect(sync.prisma.employee_schedule.findMany).toHaveBeenCalledWith({
            where: {
                branchId,
                replaced: false,
                terminatedAt: null,
                OR: [
                    { primaryEmployeeId: 30 },
                    { secondaryEmployeeId: 30 },
                ],
            },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        expect(scheduleSync).toHaveBeenCalledTimes(2);
        expect(scheduleSync).toHaveBeenNthCalledWith(1, branchId, 77, true);
        expect(scheduleSync).toHaveBeenNthCalledWith(2, branchId, 88, true);
    });

    it("returns a retryable result when any employee schedule refresh is stale", async () => {
        const sync = createEmployeeSyncService();
        sync.prisma.employee_schedule.findMany.mockResolvedValue([{ id: 77 }, { id: 88 }]);
        const scheduleSync = jest
            .spyOn(sync.service, "syncEmployeeAssignmentRulesForSchedule")
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await expect(sync.service.syncEmployeeAssignmentRulesForEmployee(branchId, 30)).resolves.toBe(false);

        expect(scheduleSync).toHaveBeenCalledTimes(2);
    });

    it("returns a retryable result when assignment job persistence reports a stale generation", async () => {
        const employeeRule = createRule({
            id: "rule-employee-retry",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sync = createEmployeeSyncService();
        sync.prisma.employee_schedule.findMany.mockResolvedValue([{ id: 77 }]);
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.upsertPendingForRuleGeneration.mockResolvedValue(null);

        await expect(sync.service.syncEmployeeAssignmentRulesForEmployee(branchId, 30)).resolves.toBe(false);
        expect(sync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(1);
    });

    it("does not query schedules when assignment refresh is not approved", async () => {
        const sync = createEmployeeSyncService();
        sync.messageSenderApprovalService.isApproved.mockResolvedValue(false);

        await sync.service.syncEmployeeAssignmentRulesForClient(branchId, 1);
        await sync.service.syncEmployeeAssignmentRulesForEmployee(branchId, 30);

        expect(sync.prisma.employee_schedule.findMany).not.toHaveBeenCalled();
    });

    it("updates one deterministic pending assignment job when a profile changes repeatedly", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const employeeRule = createRule({
                id: "rule-employee-profile",
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            });
            const sync = createEmployeeSyncService();
            let schedule = createEmployeeSchedule();
            sync.prisma.employee_schedule.findMany.mockResolvedValue([{ id: schedule.id }]);
            sync.prisma.employee_schedule.findFirst.mockImplementation(async () => schedule);
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);

            const persistedByDedupe = new Map<string, MessageTriggerJobEntity>();
            sync.jobRepository.upsertPending.mockImplementation(async (job: MessageTriggerJobEntity) => {
                persistedByDedupe.set(job.dedupeKey, job);
                return job;
            });

            await sync.service.syncEmployeeAssignmentRulesForClient(branchId, schedule.clientId);
            schedule = createEmployeeSchedule({
                client: { id: 1, name: "새 고객 이름" },
                primaryEmployee: { id: 30, name: "새 직원 이름", phone: "010-9999-0000" },
            });
            await sync.service.syncEmployeeAssignmentRulesForClient(branchId, schedule.clientId);

            expect(persistedByDedupe.size).toBe(1);
            const [job] = [...persistedByDedupe.values()];
            if (!job) throw new Error("Expected a persisted assignment job");
            expect(job).toMatchObject({
                dedupeKey: "rule-employee-profile:schedule:77:employee:30:PRIMARY_EMPLOYEE",
                recipientPhone: "010-9999-0000",
                payload: {
                    clientName: "새 고객 이름",
                    employeeName: "새 직원 이름",
                    recipientName: "새 직원 이름",
                    recipientPhone: "010-9999-0000",
                    templateVariables: {
                        clientName: "새 고객 이름",
                        employeeName: "새 직원 이름",
                    },
                },
            });
            expect(job.payload.employeeScheduleFingerprint).toBeDefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it("cancels every pending job tied to a client before client deletion", async () => {
        const sync = createSyncService();

        await sync.service.cancelPendingJobsForClientDeletion(branchId, 42);

        expect(sync.jobRepository.cancelPendingByClientContext).toHaveBeenCalledWith(
            branchId,
            42,
            "Client deleted",
        );
    });

    it("uses the new client id when the same phone is registered after deletion", async () => {
        const serviceEndRule = createRule({
            id: "rule-service-end",
            eventType: MessageTriggerEventType.SERVICE_END,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_REMINDER,
        });
        const recreated = createSyncService({
            id: 42,
            phone: "010-1234-5678",
            endDate: new Date("2026-08-01T00:00:00.000Z"),
        });
        recreated.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceEndRule]);

        await recreated.service.syncClientRulesForClient(branchId, 42, true);

        const persistedJob = recreated.jobRepository.upsertPending.mock.calls[0]?.[0];
        expect(persistedJob?.clientId).toBe(42);
        expect(persistedJob?.dedupeKey).toContain(":client:42:");
    });

    it("does not enqueue an automatic service-end notice after one was already sent", async () => {
        const serviceEndNoticeRule = createRule({
            id: "rule-service-end-notice",
            eventType: MessageTriggerEventType.SERVICE_END,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        });
        const sync = createSyncService({
            endDate: new Date("2026-08-01T00:00:00.000Z"),
            serviceEndNoticeSentAt: new Date("2026-07-31T03:00:00.000Z"),
        });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceEndNoticeRule]);

        await sync.service.syncClientRulesForClient(branchId, 1, true);

        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("stamps a task commit reference on every materialized task-origin client job", async () => {
        const greetingRule = createRule({
            id: "rule-task-reference",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const sync = createSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        const taskAutomationReference = createAgentAutomationTaskCommitReference({
            actionId: "70000000-0000-4000-8000-000000000004",
            taskId: "70000000-0000-4000-8000-000000000005",
            taskRevision: 4,
            authorities: [{ id: "70000000-0000-4000-8000-000000000001", recordDigest: "a".repeat(64), scopeDigest: "b".repeat(64) }],
            coverages: [],
        });

        await sync.service.syncClientRulesForClient(branchId, 1, true, false, {
            stableBatchAt: new Date("2026-06-27T00:00:00.000Z"),
            preserveExisting: true,
            taskOrigin: true,
            taskAutomationReference,
        });

        const materialized = sync.jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity | undefined;
        expect(materialized?.payload.taskAutomationReference).toEqual(taskAutomationReference);
    });

    it("rebuildJobsForRule is a no-op for an unapproved branch", async () => {
        const prisma = {
            client: {
                findMany: jest.fn(),
            },
        };
        const jobRepository = {
            upsertPending: jest.fn(),
            upsertPendingForRuleGeneration: jest.fn(),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        messageSenderApprovalService.isApproved.mockResolvedValue(false);
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            createMessageLogRepository() as never,
            createSystemTemplateService() as never,
            createTemplateAutomationLock(prisma) as never,
            undefined,
            createOverrideRepository() as never,
            createAutomationActivationService() as never,
            createBranchLock(prisma) as never,
        undefined, createLegacyAutomationDeliveryGate(prisma as never, createBranchLock(prisma) as never));
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
        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(1);
    });

    it("supersedes an immediate needs_setup job after client data is fixed and sends the fresh payload", async () => {
        const rule = createRule({ id: "rule-greeting-active", eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING });
        const waiting = createJob({ ruleId: rule.id, status: "needs_setup", cancelReason: "필수 정보 누락 (name)",
            payload: { memberId: "1", recipientName: "", recipientPhone: "010-1234-5678", templateVariables: { name: "" } } });
        const sync = createSyncService({ name: "김수정" });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
        sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([waiting]);
        await sync.service.syncClientRulesForClient(branchId, 1, false);
        expect(sync.jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
            branchId, rule.id, rule.updatedAt, false, "Client data changed", { clientId: 1, needsSetup: "within_window" },
        );
        expect(waiting.status).toBe("pending");
        expect(waiting.payload.templateVariables["name"]).toBe("김수정");
        const dispatch = createDispatchService();
        waiting.scheduledFor = new Date();
        dispatch.jobRepository.findDuePendingSystemScope.mockResolvedValue([waiting]);
        await dispatch.service.dispatchDueJobs();
        expect(dispatch.deliveryService.sendJob).toHaveBeenCalledTimes(1);
        expect(waiting.status).toBe("sent");
    });

    it("leaves an immediate needs_setup job alone on repeated unchanged client resync", async () => {
        const rule = createRule({ id: "rule-greeting-active", eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING });
        const job = createJob({ ruleId: rule.id });
        const sync = createSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
        sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([job]);
        await sync.service.syncClientRulesForClient(branchId, 1, false);
        job.markNeedsSetup("필수 정보 누락 (custom)");
        sync.jobRepository.upsertPendingForRuleGeneration.mockClear();
        for (let attempt = 0; attempt < 3; attempt += 1) await sync.service.syncClientRulesForClient(branchId, 1, false);
        expect(job.status).toBe("needs_setup");
        expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
    });

    it("leaves an expired immediate needs_setup job untouched even after client data is fixed", async () => {
        const rule = createRule({ eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING });
        const job = createJob({ ruleId: rule.id, status: "needs_setup", scheduledFor: new Date(Date.now() - 24 * 60 * 60 * 1000),
            payload: { memberId: "1", recipientName: "", recipientPhone: "010-1234-5678", templateVariables: { name: "" } } });
        const sync = createSyncService({ name: "김수정" });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
        sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([job]);
        await sync.service.syncClientRulesForClient(branchId, 1, false);
        expect(job.status).toBe("needs_setup");
        expect(job.payload.templateVariables["name"]).toBe("");
        expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
    });

    it.each([false, true])("preserves an aged non-immediate needs_setup on client fix (includePast=%s)", async (includePast) => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T01:00:00.000Z"));
        try {
            const rule = createRule({ eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.SAME_DAY,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO });
            const waiting = createJob({ ruleId: rule.id, status: "needs_setup", scheduledFor: new Date("2026-07-07T00:00:00.000Z") });
            const sync = createSyncService({ name: "김수정", startDate: new Date("2026-07-07T00:00:00.000Z") });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
            sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([waiting]);
            await sync.service.syncClientRulesForClient(branchId, 1, includePast);
            expect(waiting.status).toBe("needs_setup");
            expect(sync.jobRepository.update).not.toHaveBeenCalled();
            expect(sync.jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
                branchId, rule.id, rule.updatedAt, false, "Client data changed", { clientId: 1, needsSetup: "within_window" },
            );
        } finally { jest.useRealTimers(); }
    });

    it("supersedes and revives a within-window non-immediate refusal with a sendable fresh payload", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T01:00:00.000Z"));
        try {
            const rule = createRule({ eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.SAME_DAY,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO });
            const waiting = createJob({ ruleId: rule.id, status: "needs_setup", scheduledFor: new Date("2026-07-09T00:00:00.000Z"),
                dedupeKey: buildMessageRecipeDedupeKey(rule.id, "client:1", new Date("2026-07-09T00:00:00.000Z"), rule.recipientType),
                payload: { memberId: "1", recipientName: "", recipientPhone: "010-1234-5678", templateVariables: { name: "" } } });
            const sync = createSyncService({ name: "김수정", startDate: new Date("2026-07-09T00:00:00.000Z") });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
            sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([waiting]);
            sync.jobRepository.upsertPendingForRuleGeneration.mockImplementation(async (rebuilt: MessageTriggerJobEntity) => {
                expect(waiting.status).toBe("canceled");
                expect(rebuilt.dedupeKey).toBe(waiting.dedupeKey);
                Object.assign(waiting, rebuilt, { id: waiting.id });
                return waiting;
            });
            await sync.service.syncClientRulesForClient(branchId, 1, false);
            expect(waiting.status).toBe("pending");
            expect(waiting.payload.templateVariables["name"]).toBe("김수정");
            const dispatch = createDispatchService();
            dispatch.jobRepository.findDuePendingSystemScope.mockResolvedValue([waiting]);
            await dispatch.service.dispatchDueJobs();
            expect(dispatch.deliveryService.sendPreparedJob).toHaveBeenCalledTimes(1);
            expect(waiting.status).toBe("sent");
        } finally { jest.useRealTimers(); }
    });

    it("invalidates a claimed (processing) IMMEDIATE job with ONE status-predicated cancel under the token it read, never a read-then-update", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const claimed = createJob({ id: "job-greeting-claimed", ruleId: greetingRule.id });
        claimed.markProcessing("claim-token-1");
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([claimed]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.cancelProcessingClaim).toHaveBeenCalledWith(
            "job-greeting-claimed",
            "claim-token-1",
            "Client data changed",
        );
        // No id-only write of the stale in-memory copy, and no pending refresh of a claimed job.
        expect(reSync.jobRepository.update).not.toHaveBeenCalled();
        expect(reSync.jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(claimed.status).toBe("processing");
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
                catchUp: {
                    batchId: "client:1:batch",
                    sequence: 2,
                    intervalMinutes: 3,
                    originalScheduledFor: "2026-06-27T00:00:00.000Z",
                    predecessorDedupeKey: "dedupe-predecessor",
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

        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledWith(
            pendingGreeting,
            greetingRule.updatedAt,
            false,
            false,
            expect.any(Object),
        );
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
            catchUp: {
                batchId: "client:1:batch",
                sequence: 2,
                intervalMinutes: 3,
                originalScheduledFor: "2026-06-27T00:00:00.000Z",
                predecessorDedupeKey: "dedupe-predecessor",
            },
        });
        expect(pendingGreeting.status).toBe("pending");
        expect(pendingGreeting.scheduledFor).toBe(scheduledFor);
        expect(pendingGreeting.dedupeKey).toBe("dedupe-job-greeting-pending");
        expect(pendingGreeting.attempts).toBe(0);
    });

    it("still cancels and rebuilds non-IMMEDIATE jobs on the same resync", async () => {
        // Pin the clock like sibling tests: resync/rebuild logic is relative to "now",
        // so without this the test is date-brittle (passed on the service-start day, failed after).
        jest.useFakeTimers().setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
        try {
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
        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(2);
        expect(reSync.jobRepository.upsertPendingForRuleGeneration.mock.calls[1][0]).toMatchObject({
            ruleId: serviceInfoRule.id,
            status: "pending",
            clientId: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        } finally {
            jest.useRealTimers();
        }
    });

    it.each([
        [MessageTriggerOffsetType.SAME_DAY, 0, "00:00", "2026-07-14T15:00:00.000Z"],
        [MessageTriggerOffsetType.BEFORE_DAYS, 1, "10:37", "2026-07-14T01:37:00.000Z"],
        [MessageTriggerOffsetType.AFTER_DAYS, 2, "23:59", "2026-07-17T14:59:00.000Z"],
    ])("schedules %s at configured KST time %s %s", async (offsetType, offsetDays, sendTime, expected) => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const rule = createRule({
                id: "rule-configured-time",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType, offsetDays,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            Object.assign(rule, { sendTime });
            const sync = createSyncService({ startDate: new Date("2026-07-14T16:30:00.000Z") });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([rule]);
            await sync.service.syncClientRulesForClient(branchId, 1, false);
            const job = sync.jobRepository.upsertPending.mock.calls[0][0];
            expect(job.scheduledFor.toISOString()).toBe(expected);
            expect(job.dedupeKey).toContain(expected);
        } finally {
            jest.useRealTimers();
        }
    });

    it("schedules offset jobs at 09:00 KST regardless of process timezone", async () => {
        const originalTimeZone = process.env["TZ"];
        process.env["TZ"] = "UTC";
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 1,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-14T16:30:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const expectedDate = "2026-07-14";
            const expectedHour = String(SEND_HOUR_KST).padStart(2, "0");
            const expectedScheduledFor = new Date(`${expectedDate}T${expectedHour}:00:00+09:00`);
            const persistedJob = reSync.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(expectedScheduledFor);
            expect(persistedJob.dedupeKey).toContain(expectedScheduledFor.toISOString());
        } finally {
            if (originalTimeZone === undefined) {
                delete process.env["TZ"];
            } else {
                process.env["TZ"] = originalTimeZone;
            }
            jest.useRealTimers();
        }
    });

    it("includePast=false resync does not materialize occurrences older than the grace window", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-07T00:00:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=false resync still materializes an occurrence due within the grace window", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T01:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-09T00:00:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const persistedJob = reSync.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(new Date("2026-07-09T09:00:00+09:00"));
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true catches up a pre-start notice when registration is late but service has not started", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const create = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const persistedJob = create.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:00:00.000Z"));
            expect(persistedJob.dedupeKey).toContain("2026-07-09T12:00:00.000Z");
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true skips pre-start notices once the service start date has arrived", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const create = createSyncService({
                startDate: new Date("2026-07-09T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T01:00:00.000Z"),
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true applies saved retroactive order and interval to due client jobs", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const firstRule = createRule({
                id: "rule-first",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                createdAt: new Date("2026-06-02T00:00:00.000Z"),
            });
            const secondRule = createRule({
                id: "rule-second",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                createdAt: new Date("2026-06-01T00:00:00.000Z"),
            });
            const create = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            create.systemSettingService.getMessageAutomationPastTriggerConfig.mockResolvedValue({
                sendIntervalMinutes: 3,
                ruleOrder: [secondRule.id, firstRule.id],
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([firstRule, secondRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(2);
            const firstPersistedJob = create.jobRepository.upsertPending.mock.calls[0][0];
            const secondPersistedJob = create.jobRepository.upsertPending.mock.calls[1][0];
            expect(firstPersistedJob.ruleId).toBe(secondRule.id);
            expect(firstPersistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:00:00.000Z"));
            expect(secondPersistedJob.ruleId).toBe(firstRule.id);
            expect(secondPersistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:03:00.000Z"));
            expect(firstPersistedJob.payload.catchUp).toMatchObject({
                sequence: 1,
                intervalMinutes: 3,
                predecessorDedupeKey: null,
            });
            expect(secondPersistedJob.payload.catchUp).toMatchObject({
                batchId: firstPersistedJob.payload.catchUp.batchId,
                sequence: 2,
                intervalMinutes: 3,
                predecessorDedupeKey: firstPersistedJob.dedupeKey,
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it("replays a client intent with stable keys without canceling an existing pending job", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const stableBatchAt = new Date("2026-07-09T11:58:00.000Z");
            const greetingRule = createRule({
                id: "rule-greeting-intent",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            });
            const serviceInfoRule = createRule({
                id: "rule-service-info-intent",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const existingServiceInfo = createJob({
                id: "job-service-info-existing",
                ruleId: serviceInfoRule.id,
                clientId: 1,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const sync = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([
                greetingRule,
                serviceInfoRule,
            ]);
            sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([
                existingServiceInfo,
            ]);

            await sync.service.syncClientRulesForClient(
                branchId,
                1,
                true,
                false,
                { stableBatchAt, preserveExisting: true },
            );
            await sync.service.syncClientRulesForClient(
                branchId,
                1,
                true,
                false,
                { stableBatchAt, preserveExisting: true },
            );

            expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
            expect(sync.jobRepository.findPendingByRuleIdsAndClientId).not.toHaveBeenCalled();
            expect(existingServiceInfo.status).toBe("pending");
            expect(sync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(4);

            const firstAttempt = sync.jobRepository.upsertPendingForRuleGeneration.mock.calls
                .slice(0, 2)
                .map(([job, , , preserveExisting]) => ({
                    dedupeKey: job.dedupeKey,
                    scheduledFor: job.scheduledFor,
                    preserveExisting,
                }));
            const secondAttempt = sync.jobRepository.upsertPendingForRuleGeneration.mock.calls
                .slice(2, 4)
                .map(([job, , , preserveExisting]) => ({
                    dedupeKey: job.dedupeKey,
                    scheduledFor: job.scheduledFor,
                    preserveExisting,
                }));
            expect(secondAttempt).toEqual(firstAttempt);
            expect(firstAttempt.every(({ preserveExisting }) => preserveExisting === true)).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("replays an employee-assignment intent without canceling its stable job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-intent",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const existingAssignment = createJob({
            id: "job-employee-existing",
            ruleId: employeeRule.id,
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sync = createEmployeeSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId.mockResolvedValue([
            existingAssignment,
        ]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(
            branchId,
            77,
            true,
            { preserveExisting: true },
        );

        expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(existingAssignment.status).toBe("pending");
        expect(sync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledWith(
            expect.objectContaining({
                dedupeKey: "rule-employee-intent:schedule:77:employee:30:PRIMARY_EMPLOYEE",
            }),
            employeeRule.updatedAt,
            false,
            true,
            expect.any(Object),
        );
    });

    it("cancels the old pending assignment job before rebuilding the current schedule generation", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        try {
            const employeeRule = createRule({
                id: "rule-employee-update",
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            });
            const pendingOldGeneration = createJob({
                id: "job-employee-old-generation",
                ruleId: employeeRule.id,
                employeeScheduleId: 77,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            });
            const sync = createEmployeeSyncService({
                startDate: new Date("2026-08-04T00:00:00.000Z"),
            });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
            sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId.mockResolvedValue([
                pendingOldGeneration,
            ]);

            await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

            expect(pendingOldGeneration.status).toBe("canceled");
            expect(pendingOldGeneration.cancelReason).toBe("Employee assignment changed");
            expect(sync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const rebuilt = sync.jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
            expect(rebuilt).toMatchObject({
                employeeScheduleId: 77,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                scheduledFor: new Date("2026-08-01T00:00:00.000Z"),
                payload: {
                    employeeId: 30,
                    templateVariables: { serviceStartDate: "2026-08-04" },
                },
            });
            const cancellationCall = sync.jobRepository.cancelPendingForRuleGeneration.mock.invocationCallOrder[0];
            const rebuildCall = sync.jobRepository.upsertPending.mock.invocationCallOrder[0];
            expect(cancellationCall).toBeDefined();
            expect(rebuildCall).toBeDefined();
            expect(cancellationCall!).toBeLessThan(rebuildCall!);
        } finally {
            jest.useRealTimers();
        }
    });

    it("cancels but does not rebuild assignment jobs for a replaced schedule", async () => {
        const employeeRule = createRule({
            id: "rule-employee-replaced",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const pendingAssignment = createJob({
            id: "job-employee-replaced",
            status: "needs_setup",
            ruleId: employeeRule.id,
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sync = createEmployeeSyncService({ replaced: true });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId.mockResolvedValue([
            pendingAssignment,
        ]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(pendingAssignment.status).toBe("canceled");
        expect(pendingAssignment.cancelReason).toBe("Employee assignment changed");
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
    });

    it("does not cancel or rebuild assignment jobs while sender approval is absent", async () => {
        const sync = createEmployeeSyncService();
        sync.messageSenderApprovalService.isApproved.mockResolvedValue(false);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(sync.prisma.employee_schedule.findFirst).not.toHaveBeenCalled();
        expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
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
            expect.any(Object),
        );
        expect(ruleRepository.create).toHaveBeenNthCalledWith(
            2,
            branchId,
            expect.objectContaining({
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: true,
            }),
            expect.any(Object),
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

    describe("listHistoryPage", () => {
        it("fills a page boundary from terminal jobs after the log source", async () => {
            const { service, ruleRepository, messageLogRepository, jobRepository } = createService();
            ruleRepository.findAll.mockResolvedValue([]);
            messageLogRepository.findHistoryPageByBranch.mockResolvedValue([
                createLog({ id: 40 }),
            ]);
            jobRepository.findHistoryPageByBranch.mockResolvedValue([
                createJob({ id: "00000000-0000-4000-8000-0000000000f0", status: "failed" }),
                createJob({ id: "00000000-0000-4000-8000-0000000000a0", status: "canceled" }),
            ]);

            const result = await service.listHistoryPage(branchId, 2);

            expect(result.items.map((item) => item.id)).toEqual([
                40,
                "job:00000000-0000-4000-8000-0000000000f0",
            ]);
            expect(result.page.hasMore).toBe(true);
            expect(messageLogRepository.findHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ after: null, limit: 3 }),
            );
            expect(jobRepository.findHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ after: null, limit: 2 }),
            );
        });

        it.each(["pending", "processing", "sent"])(
            "keeps current-state pagination usable when a terminal row becomes %s midwalk",
            async (nextStatus) => {
                const { service, prisma, ruleRepository } = createService();
                ruleRepository.findAll.mockResolvedValue([]);
                const firstJob = createJob({
                    id: "00000000-0000-4000-8000-0000000000f0",
                    status: "failed",
                    createdAt: new Date("2024-01-01T00:00:00.000Z"),
                });
                const lookaheadJob = createJob({
                    id: "00000000-0000-4000-8000-0000000000a0",
                    status: "failed",
                    createdAt: new Date("2024-01-02T00:00:00.000Z"),
                });
                const mutableUpdate = new Date(Date.now() + 60_000);
                firstJob.updatedAt = mutableUpdate;
                lookaheadJob.updatedAt = mutableUpdate;
                const rows = [firstJob, lookaheadJob];
                type HistoryJobQuery = {
                    where: {
                        branchId?: string;
                        status?: { in?: string[] };
                        createdAt?: { lte?: Date };
                        updatedAt?: { lte?: Date };
                        OR?: unknown[];
                        AND?: Array<{ id?: { lt?: string } }>;
                    };
                    take?: number;
                };
                prisma.message_trigger_job.findMany.mockImplementation(async (query: HistoryJobQuery) => {
                    const cutoff = query.where.createdAt?.lte;
                    const afterId = query.where.AND?.[0]?.id?.lt;
                    const candidates = rows.filter((row) => {
                        if (row.branchId !== query.where.branchId) return false;
                        if (afterId !== undefined && row.id >= afterId) return false;
                        if (cutoff !== undefined && row.createdAt > cutoff) return false;
                        if (query.where.status?.in && !query.where.status.in.includes(row.status)) return false;
                        if (query.where.OR) {
                            return row.status === "failed"
                                ? row.updatedAt <= cutoff!
                                : row.status === "canceled"
                                    && row.canceledAt !== null
                                    && row.canceledAt <= cutoff!;
                        }
                        return true;
                    });
                    return candidates
                        .sort((left, right) => right.id.localeCompare(left.id))
                        .slice(0, query.take ?? candidates.length);
                });

                const serviceInternals = service as unknown as {
                    messageLogRepository: unknown;
                    jobRepository: unknown;
                };
                serviceInternals.messageLogRepository = new SbMessageLogRepository(prisma as never);
                serviceInternals.jobRepository = new SbMessageTriggerJobRepository(prisma as never);

                const firstPage = await service.listHistoryPage(branchId, 1);
                expect(firstPage.items.map((item) => item.id)).toEqual([
                    "job:00000000-0000-4000-8000-0000000000f0",
                ]);
                expect(firstPage.page.hasMore).toBe(true);

                lookaheadJob.status = nextStatus as MessageTriggerJobStatus;
                const continuation = await service.listHistoryPage(
                    branchId,
                    1,
                    firstPage.page.nextCursor ?? undefined,
                );
                expect(continuation.items).toEqual([]);
                expect(continuation.page.hasMore).toBe(false);
            },
        );

        it("includes a pending row that becomes failed below the cursor and defers one above it to a fresh poll", async () => {
            const { service, prisma, ruleRepository } = createService();
            ruleRepository.findAll.mockResolvedValue([]);
            const rows = [
                createJob({
                    id: "00000000-0000-4000-8000-0000000000f0",
                    status: "failed",
                    createdAt: new Date("2024-01-01T00:00:00.000Z"),
                }),
                createJob({
                    id: "00000000-0000-4000-8000-0000000000e0",
                    status: "failed",
                    createdAt: new Date("2024-01-02T00:00:00.000Z"),
                }),
                createJob({
                    id: "00000000-0000-4000-8000-0000000000a0",
                    status: "pending",
                    createdAt: new Date("2024-01-03T00:00:00.000Z"),
                }),
                createJob({
                    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    status: "pending",
                    createdAt: new Date("2024-01-04T00:00:00.000Z"),
                }),
            ];
            type HistoryJobQuery = {
                where: {
                    branchId?: string;
                    status?: { in?: string[] };
                    createdAt?: { lte?: Date };
                    AND?: Array<{ id?: { lt?: string } }>;
                };
                take?: number;
            };
            prisma.message_trigger_job.findMany.mockImplementation(async (query: HistoryJobQuery) => {
                const cutoff = query.where.createdAt?.lte;
                const afterId = query.where.AND?.[0]?.id?.lt;
                return rows
                    .filter((row) => row.branchId === query.where.branchId)
                    .filter((row) => query.where.status?.in?.includes(row.status) ?? false)
                    .filter((row) => cutoff === undefined || row.createdAt <= cutoff)
                    .filter((row) => afterId === undefined || row.id < afterId)
                    .sort((left, right) => right.id.localeCompare(left.id))
                    .slice(0, query.take ?? rows.length);
            });

            const serviceInternals = service as unknown as {
                messageLogRepository: unknown;
                jobRepository: unknown;
            };
            serviceInternals.messageLogRepository = new SbMessageLogRepository(prisma as never);
            serviceInternals.jobRepository = new SbMessageTriggerJobRepository(prisma as never);

            const firstPage = await service.listHistoryPage(branchId, 1);
            expect(firstPage.items.map((item) => item.id)).toEqual([
                "job:00000000-0000-4000-8000-0000000000f0",
            ]);
            expect(firstPage.page.hasMore).toBe(true);

            const snapshotAt = new Date(firstPage.page.snapshotAt);
            rows[2]!.status = "failed";
            rows[2]!.updatedAt = new Date(snapshotAt.getTime() + 1_000);
            rows[3]!.status = "failed";
            rows[3]!.updatedAt = new Date(snapshotAt.getTime() + 1_000);

            const continuation = await service.listHistoryPage(
                branchId,
                2,
                firstPage.page.nextCursor ?? undefined,
            );
            expect(continuation.items.map((item) => item.id)).toEqual([
                "job:00000000-0000-4000-8000-0000000000e0",
                "job:00000000-0000-4000-8000-0000000000a0",
            ]);
            expect(continuation.items.some((item) => item.id === "job:ffffffff-ffff-4fff-8fff-ffffffffffff")).toBe(false);

            const freshPage = await service.listHistoryPage(branchId, 2);
            expect(freshPage.items.map((item) => item.id)).toEqual([
                "job:ffffffff-ffff-4fff-8fff-ffffffffffff",
                "job:00000000-0000-4000-8000-0000000000f0",
            ]);
        });

        it("walks more than 200 static records while an ordinary pending job becomes processing and sent", async () => {
            const { service, prisma, ruleRepository } = createService();
            ruleRepository.findAll.mockResolvedValue([]);
            const logRows = Array.from({ length: 205 }, (_, index) => {
                const id = 205 - index;
                return createLog({
                    id,
                    createdAt: new Date(1_704_067_200_000 + index * 60_000),
                    updatedAt: new Date(1_704_067_200_000 + index * 60_000),
                });
            });
            const terminalRows = [
                createJob({ id: "00000000-0000-4000-8000-0000000000f0", status: "failed" }),
                createJob({ id: "00000000-0000-4000-8000-0000000000e0", status: "canceled" }),
                createJob({ id: "00000000-0000-4000-8000-0000000000d0", status: "failed" }),
            ];
            const ordinaryJob = createJob({
                id: "00000000-0000-4000-8000-0000000000b0",
                status: "pending",
            });
            const jobRows = [...terminalRows, ordinaryJob];
            type LogHistoryQuery = {
                where?: { AND?: Array<{ id?: { lt?: number } }> };
                take?: number;
            };
            type JobHistoryQuery = {
                where: {
                    branchId?: string;
                    status?: { in?: string[] };
                    createdAt?: { lte?: Date };
                    updatedAt?: { gte?: Date; lte?: Date };
                    AND?: Array<{ id?: { lt?: string } }>;
                };
                take?: number;
            };
            prisma.message_log.findMany.mockImplementation(async (query: LogHistoryQuery) => {
                const afterId = query.where?.AND?.[0]?.id?.lt;
                return logRows
                    .filter((row) => afterId === undefined || row.id < afterId)
                    .slice(0, query.take ?? logRows.length);
            });
            prisma.message_trigger_job.findMany.mockImplementation(async (query: JobHistoryQuery) => {
                const afterId = query.where.AND?.[0]?.id?.lt;
                const cutoff = query.where.createdAt?.lte;
                return jobRows
                    .filter((row) => row.branchId === query.where.branchId)
                    .filter((row) => query.where.status?.in === undefined || query.where.status.in.includes(row.status))
                    .filter((row) => cutoff === undefined || row.createdAt <= cutoff)
                    .filter((row) => query.where.updatedAt?.gte === undefined || row.updatedAt >= query.where.updatedAt.gte)
                    .filter((row) => query.where.updatedAt?.lte === undefined || row.updatedAt <= query.where.updatedAt.lte)
                    .filter((row) => afterId === undefined || row.id < afterId)
                    .sort((left, right) => right.id.localeCompare(left.id))
                    .slice(0, query.take ?? terminalRows.length);
            });

            const serviceInternals = service as unknown as {
                messageLogRepository: unknown;
                jobRepository: unknown;
            };
            serviceInternals.messageLogRepository = new SbMessageLogRepository(prisma as never);
            serviceInternals.jobRepository = new SbMessageTriggerJobRepository(prisma as never);

            const ids: Array<number | string> = [];
            let cursor: string | undefined;
            let firstSnapshotAt: Date | undefined;
            type HistoryPageResult = Awaited<ReturnType<MessageTriggerService["listHistoryPage"]>>;
            let finalPage: HistoryPageResult | undefined;
            for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
                ordinaryJob.status = pageIndex === 0
                    ? "pending"
                    : pageIndex === 1
                        ? "processing"
                        : "sent";
                if (pageIndex > 0 && firstSnapshotAt) {
                    ordinaryJob.updatedAt = new Date(firstSnapshotAt.getTime() + pageIndex * 1_000);
                }
                const result = await service.listHistoryPage(branchId, 50, cursor);
                if (pageIndex === 0) {
                    firstSnapshotAt = new Date(result.page.snapshotAt);
                }
                finalPage = result;
                ids.push(...result.items.map((item) => item.id));
                if (!result.page.hasMore) break;
                cursor = result.page.nextCursor ?? undefined;
            }

            expect(ids).toHaveLength(208);
            expect(new Set(ids.map(String)).size).toBe(208);
            expect(ids.slice(0, 3)).toEqual([205, 204, 203]);
            expect(ids.slice(-3)).toEqual([
                "job:00000000-0000-4000-8000-0000000000f0",
                "job:00000000-0000-4000-8000-0000000000e0",
                "job:00000000-0000-4000-8000-0000000000d0",
            ]);
            expect(ids).not.toContain("job:00000000-0000-4000-8000-0000000000b0");
            expect(ordinaryJob.status).toBe("sent");
            expect(finalPage?.page.hasMore).toBe(false);
            expect(prisma.message_log.findMany).toHaveBeenCalledTimes(5);
        });

        it("walks older-created logs exactly once through the real service and repositories", async () => {
            const { service, prisma, ruleRepository } = createService();
            ruleRepository.findAll.mockResolvedValue([]);
            const logRows = [5, 4, 3, 2, 1].map((id) => createLog({
                id,
                createdAt: new Date(`2024-01-0${id}T00:00:00.000Z`),
                // A retry/update timestamp must not move the immutable id
                // cursor or cause an older row to disappear.
                updatedAt: new Date("2026-09-17T00:00:00.000Z"),
            }));
            prisma.message_log.findMany.mockImplementation(async (query: { where?: { AND?: Array<{ id?: { lt?: number } }> } }) => {
                const beforeId = query.where?.AND?.[0]?.id?.lt;
                return logRows.filter((row) => beforeId === undefined || row.id < beforeId);
            });
            prisma.message_trigger_job.findMany.mockResolvedValue([]);

            const serviceInternals = service as unknown as {
                messageLogRepository: unknown;
                jobRepository: unknown;
            };
            serviceInternals.messageLogRepository = new SbMessageLogRepository(prisma as never);
            serviceInternals.jobRepository = new SbMessageTriggerJobRepository(prisma as never);

            const ids: Array<number | string> = [];
            let cursor: string | undefined;
            for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
                const result = await service.listHistoryPage(branchId, 2, cursor);
                ids.push(...result.items.map((item) => item.id));
                if (!result.page.hasMore) break;
                cursor = result.page.nextCursor ?? undefined;
            }

            expect(ids).toEqual([5, 4, 3, 2, 1]);
            expect(new Set(ids.map(String)).size).toBe(5);
            expect(prisma.message_log.findMany).toHaveBeenCalledTimes(3);
        });

        it("does not query logs after a terminal-job cursor and preserves repository UUID order", async () => {
            const { service, ruleRepository, messageLogRepository, jobRepository } = createService();
            ruleRepository.findAll.mockResolvedValue([]);
            messageLogRepository.findHistoryPageByBranch.mockResolvedValue([]);
            jobRepository.findHistoryPageByBranch.mockResolvedValue([
                createJob({ id: "00000000-0000-4000-8000-0000000000ff", status: "failed" }),
                createJob({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", status: "failed" }),
                createJob({ id: "00000000-0000-4000-8000-000000000001", status: "failed" }),
            ]);

            const firstPage = await service.listHistoryPage(branchId, 2);
            expect(firstPage.items.map((item) => item.id)).toEqual([
                "job:00000000-0000-4000-8000-0000000000ff",
                "job:ffffffff-ffff-4fff-8fff-ffffffffffff",
            ]);
            expect(firstPage.page.nextCursor).toBeTruthy();

            messageLogRepository.findHistoryPageByBranch.mockClear();
            jobRepository.findHistoryPageByBranch.mockResolvedValue([]);
            await service.listHistoryPage(branchId, 2, firstPage.page.nextCursor!);

            expect(messageLogRepository.findHistoryPageByBranch).not.toHaveBeenCalled();
            expect(jobRepository.findHistoryPageByBranch).toHaveBeenLastCalledWith(
                branchId,
                expect.objectContaining({
                    after: {
                        source: "job",
                        nativeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    },
                    limit: 3,
                }),
            );
        });

        it("rejects a cursor whose snapshot is in the future", async () => {
            const { service } = createService();
            const futureCursor = Buffer.from(JSON.stringify({
                v: 1,
                branchId,
                snapshotAt: new Date(Date.now() + 60_000).toISOString(),
                source: "job",
                nativeId: "00000000-0000-4000-8000-000000000001",
            })).toString("base64url");

            await expect(service.listHistoryPage(branchId, 2, futureCursor)).rejects.toThrow(
                "메시지 발송 기록 페이지 커서가 올바르지 않습니다.",
            );
        });

        it("rejects a malformed terminal-job cursor before querying either source", async () => {
            const { service, messageLogRepository, jobRepository } = createService();
            const malformedCursor = Buffer.from(JSON.stringify({
                v: 1,
                branchId,
                snapshotAt: new Date(Date.now() - 60_000).toISOString(),
                source: "job",
                nativeId: "not-a-uuid",
            })).toString("base64url");

            await expect(service.listHistoryPage(branchId, 2, malformedCursor)).rejects.toThrow(
                "메시지 발송 기록 페이지 커서가 올바르지 않습니다.",
            );
            expect(messageLogRepository.findHistoryPageByBranch).not.toHaveBeenCalled();
            expect(jobRepository.findHistoryPageByBranch).not.toHaveBeenCalled();
        });
    });

    describe("listClientHistoryPage", () => {
        const clientId = 42;
        const withClient = (
            ctx: ReturnType<typeof createService>,
            phone: string | null = "010-1234-5678",
        ) => {
            ctx.prisma.client.findFirst.mockResolvedValue({ id: clientId, phone });
            ctx.ruleRepository.findAll.mockResolvedValue([]);
            return ctx;
        };

        it("reads the client's own history in SQL instead of slicing the branch-wide window", async () => {
            const ctx = withClient(createService());
            ctx.messageLogRepository.findClientHistoryPageByBranch.mockResolvedValue([
                createLog({ id: 9, createdAt: new Date("2025-01-01T00:00:00.000Z") }),
            ]);

            const result = await ctx.service.listClientHistoryPage(branchId, clientId, 50);

            expect(result.items.map((item) => item.id)).toEqual([9]);
            expect(result.page.hasMore).toBe(false);
            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                { clientId, phoneKey: "01012345678" },
                expect.objectContaining({ after: null, limit: 51 }),
            );
            // The branch-wide window the old UI sliced is never touched.
            expect(ctx.messageLogRepository.findRecentByBranch).not.toHaveBeenCalled();
            expect(ctx.messageLogRepository.findHistoryPageByBranch).not.toHaveBeenCalled();
        });

        it("resolves a client of another branch to 404 before reading any history", async () => {
            const ctx = createService();
            ctx.prisma.client.findFirst.mockResolvedValue(null);

            await expect(ctx.service.listClientHistoryPage(branchId, clientId)).rejects.toBeInstanceOf(NotFoundException);

            expect(ctx.prisma.client.findFirst).toHaveBeenCalledWith({
                where: { id: clientId, branchId },
                select: { id: true, phone: true },
            });
            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).not.toHaveBeenCalled();
            expect(ctx.jobRepository.findClientHistoryPageByBranch).not.toHaveBeenCalled();
        });

        it("uses the branch-fenced client repository when it is wired", async () => {
            const ctx = withClient(createService());
            const findById = jest.fn().mockResolvedValue({ id: clientId, phone: "+82 10-1234-5678" });
            (ctx.service as unknown as { clientRepository: unknown }).clientRepository = { findById };

            await ctx.service.listClientHistoryPage(branchId, clientId);

            expect(findById).toHaveBeenCalledWith(branchId, clientId);
            expect(ctx.prisma.client.findFirst).not.toHaveBeenCalled();
            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                { clientId, phoneKey: "01012345678" },
                expect.anything(),
            );
        });

        it("passes no phone key for a client without a usable phone", async () => {
            const ctx = withClient(createService(), null);

            await ctx.service.listClientHistoryPage(branchId, clientId);

            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                { clientId, phoneKey: null },
                expect.anything(),
            );
        });

        it("paginates: a full page yields a client-pinned cursor and the continuation resumes after it", async () => {
            const ctx = withClient(createService());
            ctx.messageLogRepository.findClientHistoryPageByBranch.mockResolvedValue([
                createLog({ id: 30 }),
                createLog({ id: 20 }),
                createLog({ id: 10 }),
            ]);

            const first = await ctx.service.listClientHistoryPage(branchId, clientId, 2);

            expect(first.items.map((item) => item.id)).toEqual([30, 20]);
            expect(first.page.hasMore).toBe(true);
            const decoded = JSON.parse(Buffer.from(first.page.nextCursor!, "base64url").toString("utf8"));
            expect(decoded).toMatchObject({ branchId, clientId, source: "log", nativeId: "20" });

            ctx.messageLogRepository.findClientHistoryPageByBranch.mockResolvedValue([createLog({ id: 10 })]);
            const second = await ctx.service.listClientHistoryPage(branchId, clientId, 2, first.page.nextCursor!);

            expect(second.items.map((item) => item.id)).toEqual([10]);
            expect(second.page.hasMore).toBe(false);
            expect(second.page.nextCursor).toBeNull();
            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).toHaveBeenLastCalledWith(
                branchId,
                { clientId, phoneKey: "01012345678" },
                expect.objectContaining({
                    after: { source: "log", nativeId: "20" },
                    snapshotAt: new Date(first.page.snapshotAt),
                    limit: 3,
                }),
            );
        });

        it("fills the rest of a page with the client's terminal jobs that never produced a log", async () => {
            const ctx = withClient(createService());
            ctx.messageLogRepository.findClientHistoryPageByBranch.mockResolvedValue([createLog({ id: 40 })]);
            ctx.jobRepository.findClientHistoryPageByBranch.mockResolvedValue([
                createJob({ id: "00000000-0000-4000-8000-0000000000f0", status: "failed", clientId }),
            ]);

            const result = await ctx.service.listClientHistoryPage(branchId, clientId, 5);

            expect(result.items.map((item) => item.id)).toEqual([40, "job:00000000-0000-4000-8000-0000000000f0"]);
            expect(ctx.jobRepository.findClientHistoryPageByBranch).toHaveBeenCalledWith(
                branchId,
                { clientId, phoneKey: "01012345678" },
                expect.objectContaining({ limit: 5 }),
            );
        });

        it("refuses a cursor minted for another client, another branch, or the branch-wide endpoint's shape", async () => {
            const ctx = withClient(createService());
            const mint = (overrides: Record<string, unknown>) => Buffer.from(JSON.stringify({
                v: 1,
                branchId,
                clientId,
                snapshotAt: new Date(Date.now() - 60_000).toISOString(),
                source: "log",
                nativeId: "20",
                ...overrides,
            })).toString("base64url");

            for (const cursor of [
                mint({ clientId: clientId + 1 }),
                mint({ branchId: "other-branch" }),
                mint({ clientId: undefined }),
                "not-a-cursor",
            ]) {
                await expect(ctx.service.listClientHistoryPage(branchId, clientId, 2, cursor)).rejects.toThrow(
                    "메시지 발송 기록 페이지 커서가 올바르지 않습니다.",
                );
            }
            expect(ctx.messageLogRepository.findClientHistoryPageByBranch).not.toHaveBeenCalled();
        });

        it("rejects invalid client ids and page sizes before any lookup", async () => {
            const ctx = withClient(createService());

            await expect(ctx.service.listClientHistoryPage(branchId, 0)).rejects.toBeInstanceOf(BadRequestException);
            await expect(ctx.service.listClientHistoryPage(branchId, 1.5)).rejects.toBeInstanceOf(BadRequestException);
            await expect(ctx.service.listClientHistoryPage(branchId, clientId, 0)).rejects.toBeInstanceOf(BadRequestException);
            await expect(ctx.service.listClientHistoryPage(branchId, clientId, 101)).rejects.toBeInstanceOf(BadRequestException);
            expect(ctx.prisma.client.findFirst).not.toHaveBeenCalled();
        });
    });
});
