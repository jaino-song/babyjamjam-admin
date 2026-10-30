import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AligoDefaultSenderPolicyService } from "application/services/aligo-default-sender-policy.service";
import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import type { SmsTriggerDeliveryPreparation } from "application/services/sms-trigger-delivery.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import type { IMessageTriggerRuleBranchOverrideRepository } from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

import type { IntegrityPrisma } from "../helpers/real-db";

/**
 * Local (area-owned) wiring helpers for the SMS integrity specs.
 *
 * The merged harness owns `helpers/**`; anything the SMS area needs beyond the
 * factories and the tracker lives here. Nothing in this file may be imported by
 * another area.
 */

/** Minimal stand-ins for collaborators the dispatch paths never reach. */
const noopOverrideRepository: IMessageTriggerRuleBranchOverrideRepository = {
    findAllByBranch: async () => [],
    findOne: async () => null,
    upsert: async () => {
        throw new Error("override mutations are not wired in the SMS integrity specs");
    },
    cancelJobsForBranchRule: async () => undefined,
};

/** Sender-approval stand-in: the audited branch is always approved. */
export function noopApprovalStub(): {
    getApprovedBranchIds: (branchIds: string[]) => Promise<Set<string>>;
    getApprovedBranches: (branchIds: string[]) => Promise<Map<string, Date>>;
    isApproved: (branchId: string) => Promise<boolean>;
    ensureApproved: (branchId: string) => Promise<void>;
} {
    return {
        getApprovedBranchIds: async (branchIds) => new Set(branchIds),
        getApprovedBranches: async (branchIds) => new Map(branchIds.map((id) => [id, new Date()])),
        isApproved: async () => true,
        ensureApproved: async () => undefined,
    };
}

function stubCollaborators(branchId: string) {
    return {
        messageSenderApprovalService: {
            getApprovedBranchIds: async (): Promise<Set<string>> => new Set([branchId]),
            getApprovedBranches: async (): Promise<Map<string, Date>> => new Map([[branchId, new Date()]]),
            isApproved: async (): Promise<boolean> => true,
            ensureApproved: async (): Promise<void> => undefined,
        },
        systemTemplateService: {
            getByKeyForBranch: async (): Promise<never> => {
                throw new Error("system templates are not wired in the SMS integrity specs");
            },
        },
        templateAutomationLock: {},
    };
}

/**
 * A delivery-service double that records provider crossings. It exposes
 * `prepareJob`/`sendPreparedJob` (so the production two-step prepared path is
 * taken) but never touches the network, the message_log table, or the system
 * template service: the delivery snapshot is resolved from the job's own
 * payload message (`triggerType: "agent_scheduled"`), exactly like the real
 * resolver does for payload-message jobs.
 */
export class RecordingDeliveryStub {
    readonly providerCalls: Array<{ jobId: string; receiver: string; message: string }> = [];

    private readonly gate: AgentAutomationDeliveryGateService;

    constructor(
        database: PrismaService,
        lock: MessageAutomationBranchLockService,
        authority: AgentAutomationJobAuthorityService,
    ) {
        this.gate = new AgentAutomationDeliveryGateService(database, lock, authority);
    }

    /** Same contract as the real service, minus rendering and log writes. */
    async resolveCanonicalDeliverySnapshot(job: MessageTriggerJobEntity): Promise<Record<string, unknown>> {
        return {
            templateKey: job.templateKey,
            receiver: job.payload.recipientPhone ?? "",
            message: job.payload.messageBody ?? "",
        };
    }

    async prepareJob(job: MessageTriggerJobEntity): Promise<SmsTriggerDeliveryPreparation | null> {
        if (!await this.gate.consumePreparation(job)) {
            job.cancel("문자 동의 또는 발송 대상 확인이 필요합니다");
            return null;
        }
        const serializedSnapshot = JSON.stringify({ templateKey: job.templateKey, receiver: job.payload.recipientPhone });
        job.payload.templateVariables["smsDeliverySnapshot"] = serializedSnapshot;
        return Object.freeze({
            snapshot: { templateKey: job.templateKey, receiver: job.payload.recipientPhone ?? "" },
            serializedSnapshot,
        } as unknown as SmsTriggerDeliveryPreparation);
    }

    async sendPreparedJob(job: MessageTriggerJobEntity, preparation: SmsTriggerDeliveryPreparation): Promise<boolean> {
        await this.gate.consumeDispatch(job, preparation);
        this.providerCalls.push({
            jobId: job.id,
            receiver: job.payload.recipientPhone ?? "",
            message: job.payload.messageBody ?? "",
        });
        return true;
    }
}

export interface WiredMessageTriggerService {
    service: MessageTriggerService;
    delivery: RecordingDeliveryStub;
    jobRepository: SbMessageTriggerJobRepository;
    ruleRepository: SbMessageTriggerRuleRepository;
    logRepository: SbMessageLogRepository;
}

/**
 * Wires the real `MessageTriggerService` over the real database: real job/rule/
 * log repositories, real safeguard, activation, branch lock and delivery gate;
 * only the provider boundary (delivery stub) and the sender-approval/system-
 * template collaborators are stubbed. `branchId` only feeds the approval stub.
 */
export function wireMessageTriggerService(handle: IntegrityPrisma, branchId: string): WiredMessageTriggerService {
    const service = handle.service;
    const jobRepository = new SbMessageTriggerJobRepository(service);
    const ruleRepository = new SbMessageTriggerRuleRepository(service);
    const logRepository = new SbMessageLogRepository(service);

    const branchLock = new MessageAutomationBranchLockService(service);
    const auditWriter = new AdminAuditEventWriter(service);
    const activation = new MessageAutomationActivationService(service, branchLock, auditWriter);
    const safeguard = new SmsAutomationSafeguardService(service, activation);
    const stubs = stubCollaborators(branchId);
    const sourceReader = new ClientAutomationSourceReader(
        service,
        ruleRepository,
        noopOverrideRepository,
        stubs.messageSenderApprovalService as unknown as ConstructorParameters<typeof ClientAutomationSourceReader>[3],
        undefined,
        activation,
    );
    const authority = new AgentAutomationJobAuthorityService(
        new AgentAutomationAuthorityService(new AgentAutomationRecordStoreService(branchLock)),
        sourceReader,
        new AligoDefaultSenderPolicyService({
            getDefaultSenderPolicy: () => ({ availability: "unavailable" }),
        } as unknown as ConstructorParameters<typeof AligoDefaultSenderPolicyService>[0]),
    );
    const delivery = new RecordingDeliveryStub(service, branchLock, authority);

    const triggerService = new MessageTriggerService(
        service,
        delivery as unknown as ConstructorParameters<typeof MessageTriggerService>[1],
        stubs.messageSenderApprovalService as unknown as ConstructorParameters<typeof MessageTriggerService>[2],
        ruleRepository,
        jobRepository,
        logRepository,
        stubs.systemTemplateService as unknown as ConstructorParameters<typeof MessageTriggerService>[6],
        stubs.templateAutomationLock as unknown as ConstructorParameters<typeof MessageTriggerService>[7],
        undefined,
        undefined,
        activation,
        branchLock,
        sourceReader,
        new AgentAutomationDeliveryGateService(service, branchLock, authority),
        undefined,
        safeguard,
    );
    return { service: triggerService, delivery, jobRepository, ruleRepository, logRepository };
}

/** Real acceptance boundary over the real log repository. */
export function wireSmsProviderAcceptanceService(handle: IntegrityPrisma): SmsProviderAcceptanceService {
    return new SmsProviderAcceptanceService(new SbMessageLogRepository(handle.service));
}

/**
 * The exact reclaim reason `reclaimStaleProcessingJobs` writes for a
 * `dispatching` job (the constant is module-private in
 * application/services/message-trigger.service.ts).
 */
export const SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";

/**
 * The family advisory-lock key `startRetryAttempt` takes for a manual retry.
 * Exported so a spec can hold it on a separate connection to force the exact
 * interleaving instead of hoping two promises race.
 */
export function smsRetryFamilyLockKey(branchId: string, rootLogId: number): string {
    return `sms_retry_family:${branchId}:${rootLogId}`;
}

/**
 * Proves, from `pg_stat_activity`, that another backend is queued on a lock in
 * a statement matching `statement` (the same evidence pattern the merged
 * eformsign void-fences spec uses). Bounded, so a deadlock fails the test
 * instead of hanging it.
 */
export async function waitUntilBlocked(
    raw: PrismaClient,
    statement: RegExp,
    timeoutMs = 5_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let waiting: string[] = [];
    for (;;) {
        const rows = await raw.$queryRaw<Array<{ query: string }>>(Prisma.sql`
            SELECT query
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
        `);
        waiting = rows.map((row) => row.query);
        if (waiting.some((query) => statement.test(query))) return;
        if (Date.now() > deadline) {
            throw new Error(`no backend was blocked on ${statement}; waiting statements: ${JSON.stringify(waiting)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

/** Rejects (and clears its timer) instead of waiting forever for `promise`. */
export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Deletes rows the specs (or the code under test) created in tables the shared
 * tracker does not sweep. `message_log` / `message_trigger_job` app rows are
 * swept by the tracker itself (by tracked branch); this helper additionally
 * removes any job rows pinned by a rule the tracker will delete and any
 * `message_template` rows the area created (that table is NOT swept).
 */
export async function deleteAreaRowsByBranch(raw: PrismaClient, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    await raw.message_log.deleteMany({ where: { branchId: { in: branchIds } } });
    // Jobs the tracker does not know about (e.g. raw-SQL inserts) that pin a
    // tracked rule through its Cascade FK, or a tracked branch through NoAction.
    await raw.message_trigger_job.deleteMany({
        where: { OR: [{ branchId: { in: branchIds } }, { rule: { is: { branchId: { in: branchIds } } } }] },
    });
    // `message_template` is NOT swept by the shared tracker.
    await raw.message_template.deleteMany({ where: { branchId: { in: branchIds } } });
    // Branch-parent policy keys written by the activation service.
    for (const branchId of branchIds) {
        await raw.system_setting.deleteMany({ where: { key: { startsWith: `branch:${branchId}:` } } });
    }
}
