import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationCoverageScope, AgentAutomationGrandfatheredScope, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { AGENT_AUTOMATION_RECORD_CANCEL_REASON, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY, AGENT_AUTOMATION_TASK_SCOPE_CANCEL_REASON } from "domain/constants/agent-automation-storage";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import type { AgentContext } from "./agent-context";
import { recordAgentActionEffect, readAgentActionEffect, type AgentActionEffectReceipt } from "./agent-action-effect-receipt";
import { parseTaskAutomationArtifact, TASK_AUTOMATION_ARTIFACT_KEY, type AgentTaskAutomationArtifact } from "./agent-task-automation-artifact";
import { agentAutomationEffectDigest, agentAutomationRecordDigest, agentAutomationScheduleIdentity } from "./agent-automation-consent";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope, canonicalAgentAutomationGrandfatheredScopes } from "./agent-automation-coverage";
import { AgentAutomationCoverageScopeStorageSchema, AgentAutomationReceiptMetadataSchema, AgentAutomationScopeStorageSchema } from "./agent-automation-storage.schema";
import { agentAutomationRecordKey, agentAutomationRecordPrefix, createAgentAutomationTerminalRecord, decodeAgentAutomationTerminalRow,
    isCoverage, type AgentAutomationStoredRecord, type AgentAutomationTerminalRecord } from "./agent-automation-terminal-record";

const MAX_CHAIN = 4096;
const MAX_AFFECTED_JOBS = 500;

type AgentAutomationAffectedJobRow = {
    id: string;
    branchId: string | null;
    ruleId: string;
    status: string;
    scheduledFor: Date;
    recipientPhone: string | null;
    payload: Prisma.JsonValue;
    updatedAt: Date;
    claimToken: string | null;
    dedupeKey: string;
    canceledByUser: boolean;
};

function affectedJobVersion(job: AgentAutomationAffectedJobRow): string {
    return agentBindingHash(JSON.parse(JSON.stringify({
        id: job.id,
        branchId: job.branchId,
        ruleId: job.ruleId,
        status: job.status,
        scheduledFor: job.scheduledFor,
        recipientPhone: job.recipientPhone,
        payload: job.payload,
        updatedAt: job.updatedAt,
        claimToken: job.claimToken,
        dedupeKey: job.dedupeKey,
        canceledByUser: job.canceledByUser,
    })) as unknown);
}

export class AgentAutomationRecordRefusedError extends Error {
    constructor() {
        super("Automation record transaction refused");
        this.name = AgentAutomationRecordRefusedError.name;
    }
}

function refuse(): never { throw new AgentAutomationRecordRefusedError(); }

export interface AgentAutomationTaskMutation {
    clientId: number;
    result: Record<string, unknown>;
    /** Derived by the trusted source owner under this transaction, never request JSON. */
    coverages: Array<{ scope: AgentAutomationCoverageScope; grandfatheredScopes: AgentAutomationGrandfatheredScope[] }>;
    /** Mutable source jobs inspected by the planner and fenced by id/version. */
    affectedJobs: Array<{ id: string; version: string }>;
}
export interface AgentAutomationCommittedBatch {
    authorities: AgentAutomationAuthority[];
    coverages: AgentAutomationCoverage[];
}
export interface AgentAutomationLineageEvidence {
    batch: AgentAutomationCommittedBatch;
    /** Logical create subjects are established by the physical commit, never by job JSON. */
    creationSubjects: Array<{ authorityId: string; taskId: string }>;
}

/**
 * Owns the terminal namespace. It exposes no generic append/update/delete operation.
 * The trusted capability must replan/CAS and save its customer in prepare, then
 * stage its intent/cancellations in stage. Every callback uses this same branch
 * transaction; no provider or model work is permitted inside either callback.
 * This store alone is not a materialization or dispatch permission resolver.
 */
@Injectable()
export class AgentAutomationRecordStoreService {
    constructor(private readonly branchLocks: MessageAutomationBranchLockService) {}

    async runTaskMutation(
        context: AgentContext,
        inputArtifact: AgentTaskAutomationArtifact,
        prepare: (transaction: Prisma.TransactionClient) => Promise<AgentAutomationTaskMutation>,
        stage: (transaction: Prisma.TransactionClient, batch: AgentAutomationCommittedBatch) => Promise<void>,
        transaction?: Prisma.TransactionClient,
    ): Promise<AgentActionEffectReceipt> {
        const artifact = parseTaskAutomationArtifact(inputArtifact);
        if (!artifact || context.actionId !== artifact.actionId || context.sessionId !== artifact.sessionId
            || context.principal.userId !== artifact.userId || context.principal.branchId !== artifact.branchId) refuse();
        return this.branchLocks.runExclusive(artifact.branchId, async (tx) => {
            const action = await tx.agent_action.findFirst({ where: { id: artifact.actionId, userId: artifact.userId,
                branchId: artifact.branchId, sessionId: artifact.sessionId, taskId: artifact.taskId, taskRevision: artifact.taskRevision,
                capability: artifact.capability, inputHash: artifact.inputHash }, select: { status: true, proposal: true, effectReceipt: true } });
            const proposal = action?.proposal as Record<string, unknown> | undefined;
            if (!action || agentBindingHash(proposal?.[TASK_AUTOMATION_ARTIFACT_KEY]) !== agentBindingHash(artifact)) refuse();
            if (action.effectReceipt !== null) {
                const receipt = await readAgentActionEffect(tx, context, artifact.capability);
                if (!receipt) refuse();
                await this.verifyReplay(tx, artifact, receipt);
                return receipt;
            }
            if (action.status !== "executing") refuse();
            const mutation = await prepare(tx);
            if (!Number.isSafeInteger(mutation.clientId) || mutation.clientId < 1 || mutation.coverages.length > 500
                || (artifact.targetClientId !== null && mutation.clientId !== artifact.targetClientId)) refuse();
            await this.cancelAffectedJobs(tx, artifact.branchId, mutation.affectedJobs);
            const client = await tx.client.findFirst({ where: { id: mutation.clientId, branchId: artifact.branchId }, select: { id: true, createdAt: true } });
            if (!client?.createdAt) refuse();
            const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: client.createdAt.toISOString() });
            if (artifact.impact.clientIdentity !== null && clientIdentity !== artifact.impact.clientIdentity) refuse();
            const recordedAt = new Date().toISOString();
            const origin = { kind: "task" as const, actionId: artifact.actionId, userId: artifact.userId,
                taskId: artifact.taskId, taskRevision: artifact.taskRevision, consentEventId: artifact.consent.binding?.consentEventId ?? null };
            const mutationDigest = agentBindingHash({ actionId: artifact.actionId, inputHash: artifact.inputHash,
                clientId: client.id, clientIdentity, sourceGuard: artifact.impact.sourceGuard });
            const batch: AgentAutomationCommittedBatch = { authorities: [], coverages: [] };
            const coverageKeys = new Set<string>();
            const candidates = [...mutation.coverages].sort((a, b) => agentAutomationRecordPrefix("coverage", a.scope).localeCompare(agentAutomationRecordPrefix("coverage", b.scope)));
            for (const candidate of candidates) {
                const scope = AgentAutomationCoverageScopeStorageSchema.parse(candidate.scope);
                await this.verifyResource(tx, scope, artifact.branchId, client.id, clientIdentity);
                const key = agentAutomationRecordPrefix("coverage", scope);
                if (coverageKeys.has(key)) refuse();
                coverageKeys.add(key);
                const existing = await this.load(tx, "coverage", scope);
                const head = this.head(existing, scope);
                const record: AgentAutomationCoverage = { kind: "coverage", version: 1, id: randomUUID(), scope,
                    sequence: (head?.record.sequence ?? 0) + 1, previousId: head?.record.id ?? null, origin, mutationDigest,
                    grandfatheredScopes: canonicalAgentAutomationGrandfatheredScopes(scope, candidate.grandfatheredScopes), recordedAt, recordDigest: "" };
                record.recordDigest = agentAutomationCoverageRecordDigest(record);
                batch.coverages.push(record);
            }
            if (artifact.capability === "clients.create" && (!batch.coverages.some(({ scope }) => scope.kind === "client-rule")
                || batch.coverages.some(({ grandfatheredScopes }) => grandfatheredScopes.length > 0))) refuse();
            for (const effect of artifact.impact.effects) {
                const schedule = effect.scheduleId === null ? null : await tx.employee_schedule.findFirst({
                    where: { id: effect.scheduleId, branchId: artifact.branchId, clientId: client.id }, select: { incarnationId: true } });
                if (effect.scheduleId !== null && !schedule) refuse();
                const scope = AgentAutomationScopeStorageSchema.parse({ branchId: artifact.branchId, clientId: client.id, clientIdentity,
                    kind: effect.kind, ruleId: effect.ruleId, scheduleId: effect.scheduleId,
                    scheduleIdentity: schedule ? agentAutomationScheduleIdentity(schedule.incarnationId) : null, recipientType: effect.recipientType });
                if (!coverageKeys.has(agentAutomationRecordPrefix("coverage", agentAutomationCoverageScope(scope)))) refuse();
                const existing = await this.load(tx, "authority", scope);
                const head = this.head(existing, scope);
                const record: AgentAutomationAuthority = { version: 1, id: randomUUID(), scope, origin,
                    sequence: (head?.record.sequence ?? 0) + 1, previousId: head?.record.id ?? null,
                    decision: artifact.consent.choice === "yes" && !artifact.noSend ? "allow" : "deny", noSend: artifact.noSend,
                    effects: [effect], scopeEffectDigest: agentAutomationEffectDigest([effect]), reviewedEffectDigest: artifact.question.effectDigest,
                    reviewedPolicyDigest: artifact.question.policyDigest, recordedAt, recordDigest: "" };
                record.recordDigest = agentAutomationRecordDigest(record);
                batch.authorities.push(record);
            }
            const records: AgentAutomationStoredRecord[] = [...batch.coverages, ...batch.authorities];
            const reference = (record: AgentAutomationStoredRecord) => ({ id: record.id, recordDigest: record.recordDigest, scopeDigest: agentBindingHash(record.scope) });
            const metadata = records.length ? { automation: AgentAutomationReceiptMetadataSchema.parse({ version: 1,
                taskId: artifact.taskId, taskRevision: artifact.taskRevision, questionRef: artifact.question.questionRef,
                reviewedEffectDigest: artifact.question.effectDigest, reviewedPolicyDigest: artifact.question.policyDigest,
                authorities: batch.authorities.map(reference), coverages: batch.coverages.map(reference) }) } : undefined;
            await stage(tx, structuredClone(batch));
            const receipt = await recordAgentActionEffect(tx, context, artifact.capability, "client", client.id, mutation.result, metadata);
            if (records.length) await this.ensureInternalRule(tx);
            for (const record of records) {
                const terminal = createAgentAutomationTerminalRecord(record, { version: 1, kind: "task", actionId: artifact.actionId,
                    userId: artifact.userId, taskId: artifact.taskId, taskRevision: artifact.taskRevision, questionRef: artifact.question.questionRef,
                    inputHash: artifact.inputHash, capability: artifact.capability, resourceId: client.id,
                    receiptDigest: agentBindingHash(receipt), recordedAt });
                await tx.message_trigger_job.create({ data: { id: record.id, branchId: artifact.branchId, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    dedupeKey: agentAutomationRecordKey(record), status: "canceled", scheduledFor: new Date(recordedAt), canceledAt: new Date(recordedAt),
                    cancelReason: AGENT_AUTOMATION_RECORD_CANCEL_REASON, clientId: null, employeeScheduleId: null, recipientPhone: null,
                    recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                    nextAttemptAt: null, claimToken: null, attempts: 0, canceledByUser: false,
                    payload: { [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: terminal } as unknown as Prisma.InputJsonValue } });
            }
            return receipt;
        }, transaction);
    }

    /** Call from the current branch transaction; strict physical decoding precedes any resolver. */
    async readLineages(transaction: Prisma.TransactionClient, scope: AgentAutomationScope): Promise<AgentAutomationCommittedBatch> {
        return (await this.readLineageEvidence(transaction, scope)).batch;
    }

    async readLineageEvidence(transaction: Prisma.TransactionClient, scope: AgentAutomationScope): Promise<AgentAutomationLineageEvidence> {
        const valid = AgentAutomationScopeStorageSchema.parse(scope);
        const coverages = await this.load(transaction, "coverage", agentAutomationCoverageScope(valid));
        const authorities = await this.load(transaction, "authority", valid);
        this.head(coverages, agentAutomationCoverageScope(valid));
        this.head(authorities, valid);
        return { batch: { coverages: coverages.map(({ record }) => record as AgentAutomationCoverage),
            authorities: authorities.map(({ record }) => record as AgentAutomationAuthority) },
            creationSubjects: authorities.filter(({ commit }) => commit.capability === "clients.create")
                .map(({ record, commit }) => ({ authorityId: record.id, taskId: commit.taskId })) };
    }

    private async load(tx: Prisma.TransactionClient, kind: "coverage" | "authority", scope: AgentAutomationScope | AgentAutomationCoverageScope) {
        const rows = await tx.message_trigger_job.findMany({ where: { branchId: scope.branchId,
            dedupeKey: { startsWith: agentAutomationRecordPrefix(kind, scope) } }, orderBy: { id: "asc" }, take: MAX_CHAIN + 1 });
        if (rows.length > MAX_CHAIN) refuse();
        return rows.map((row) => { const decoded = decodeAgentAutomationTerminalRow(row);
            if (!decoded || isCoverage(decoded.record) !== (kind === "coverage")) refuse(); return decoded; });
    }

    private head(records: AgentAutomationTerminalRecord[], scope: AgentAutomationScope | AgentAutomationCoverageScope) {
        records.sort((a, b) => a.record.sequence - b.record.sequence);
        for (const [index, value] of records.entries()) {
            if (agentBindingHash(value.record.scope) !== agentBindingHash(scope) || value.record.sequence !== index + 1
                || value.record.previousId !== (index === 0 ? null : records[index - 1]!.record.id)) refuse();
        }
        return records.at(-1);
    }

    private async verifyResource(tx: Prisma.TransactionClient, scope: AgentAutomationCoverageScope, branchId: string, clientId: number, clientIdentity: string) {
        if (scope.branchId !== branchId || scope.clientId !== clientId || scope.clientIdentity !== clientIdentity) refuse();
        if (scope.scheduleId !== null) {
            const schedule = await tx.employee_schedule.findFirst({ where: { id: scope.scheduleId, branchId, clientId }, select: { incarnationId: true } });
            if (!schedule || scope.scheduleIdentity !== agentAutomationScheduleIdentity(schedule.incarnationId)) refuse();
        }
    }

    /**
     * Consume the planner's mutable source-job snapshot inside the same
     * transaction as the customer write and terminal evidence. A changed,
     * terminal, user-canceled, cross-branch, or missing row refuses the whole
     * mutation so a stale task cannot leave an active successor behind.
     */
    private async cancelAffectedJobs(
        tx: Prisma.TransactionClient,
        branchId: string,
        affectedJobs: Array<{ id: string; version: string }>,
    ): Promise<void> {
        if (!Array.isArray(affectedJobs) || affectedJobs.length > MAX_AFFECTED_JOBS) refuse();
        const ids = affectedJobs.map(({ id }) => id);
        if (new Set(ids).size !== ids.length || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) refuse();
        if (affectedJobs.some(({ version }) => !/^[a-f0-9]{64}$/.test(version))) refuse();
        if (affectedJobs.length === 0) return;

        const rows = await tx.message_trigger_job.findMany({
            where: { branchId, id: { in: ids } },
            select: {
                id: true, branchId: true, ruleId: true, status: true, scheduledFor: true,
                recipientPhone: true, payload: true, updatedAt: true, claimToken: true,
                dedupeKey: true, canceledByUser: true,
            },
        }) as AgentAutomationAffectedJobRow[];
        if (rows.length !== affectedJobs.length) refuse();
        const byId = new Map(rows.map((row) => [row.id, row]));
        const checked: AgentAutomationAffectedJobRow[] = [];
        for (const expected of affectedJobs) {
            const row = byId.get(expected.id);
            if (!row || row.branchId !== branchId || !["pending", "processing"].includes(row.status)
                || row.canceledByUser || affectedJobVersion(row) !== expected.version) refuse();
            checked.push(row);
        }

        const canceledAt = new Date();
        for (const row of checked) {
            const result = await tx.message_trigger_job.updateMany({
                where: { id: row.id, branchId, status: row.status, updatedAt: row.updatedAt, canceledByUser: false },
                data: {
                    status: "canceled",
                    canceledAt,
                    cancelReason: AGENT_AUTOMATION_TASK_SCOPE_CANCEL_REASON,
                    nextAttemptAt: null,
                    claimToken: null,
                },
            });
            if (result.count !== 1) refuse();
        }
    }

    private async verifyReplay(tx: Prisma.TransactionClient, artifact: AgentTaskAutomationArtifact, receipt: AgentActionEffectReceipt) {
        if (receipt.actionId !== artifact.actionId || receipt.capability !== artifact.capability
            || receipt.resourceType !== "client" || typeof receipt.resourceId !== "number"
            || (artifact.targetClientId !== null && receipt.resourceId !== artifact.targetClientId)) refuse();
        const metadata = receipt.metadata?.automation;
        if (!metadata) { if (artifact.capability === "clients.create" || artifact.impact.effects.length) refuse(); return; }
        if (metadata.taskId !== artifact.taskId || metadata.taskRevision !== artifact.taskRevision
            || metadata.questionRef !== artifact.question.questionRef || metadata.reviewedEffectDigest !== artifact.question.effectDigest
            || metadata.reviewedPolicyDigest !== artifact.question.policyDigest) refuse();
        const refs = [...(metadata.coverages ?? []), ...metadata.authorities];
        const rows = await tx.message_trigger_job.findMany({ where: { branchId: artifact.branchId, id: { in: refs.map(({ id }) => id) } } });
        if (rows.length !== refs.length) refuse();
        for (const row of rows) {
            const terminal = decodeAgentAutomationTerminalRow(row);
            const ref = refs.find(({ id }) => id === row.id)!;
            if (!terminal || terminal.commit.receiptDigest !== agentBindingHash(receipt) || terminal.commit.actionId !== artifact.actionId
                || terminal.record.recordDigest !== ref.recordDigest || agentBindingHash(terminal.record.scope) !== ref.scopeDigest) refuse();
        }
    }

    private async ensureInternalRule(tx: Prisma.TransactionClient) {
        await tx.message_trigger_rule.upsert({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID }, update: {}, create: {
            id: MESSAGE_AUTOMATION_INTENT_RULE_ID, branchId: null, name: "메시지 자동화 생성 복구 표식", isActive: false,
            eventType: MessageTriggerEventType.CLIENT_CREATED, offsetType: MessageTriggerOffsetType.IMMEDIATE, offsetDays: 0,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING, isDefault: false, jobsStale: false,
        } });
    }
}
