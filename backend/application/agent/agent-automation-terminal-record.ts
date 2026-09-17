import { z } from "zod";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationScope, AgentAutomationCoverageScope } from "domain/entities/agent-automation-consent";
import { AGENT_AUTOMATION_RECORD_CANCEL_REASON, AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { AgentAutomationAuthorityStorageSchema, AgentAutomationCoverageStorageSchema } from "./agent-automation-storage.schema";
import { agentAutomationLineageKey } from "./agent-automation-consent";
import { agentAutomationCoverageLineageKey } from "./agent-automation-coverage";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const taskCommitSchema = z.object({
    version: z.literal(1), kind: z.literal("task"), actionId: z.uuid(), userId: z.uuid(), taskId: z.uuid(),
    taskRevision: z.number().int().positive(), questionRef: z.uuid(), inputHash: digest,
    capability: z.enum(["clients.create", "clients.update"]), resourceId: z.number().int().positive(),
    receiptDigest: digest, recordedAt: z.iso.datetime(),
}).strict();
const terminalSchema = z.object({
    version: z.literal(1), record: z.union([AgentAutomationAuthorityStorageSchema, AgentAutomationCoverageStorageSchema]),
    commit: taskCommitSchema, commitDigest: digest,
}).strict();
const payloadSchema = z.object({ [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: terminalSchema }).strict();
export type AgentAutomationTaskCommit = z.infer<typeof taskCommitSchema>;
export type AgentAutomationTerminalRecord = z.infer<typeof terminalSchema>;
export type AgentAutomationStoredRecord = AgentAutomationAuthority | AgentAutomationCoverage;

export function isCoverage(record: AgentAutomationStoredRecord): record is AgentAutomationCoverage {
    return "kind" in record && record.kind === "coverage";
}
export function agentAutomationRecordPrefix(kind: "authority" | "coverage", scope: AgentAutomationScope | AgentAutomationCoverageScope): string {
    const key = kind === "coverage" ? agentAutomationCoverageLineageKey(scope) : agentAutomationLineageKey(scope as AgentAutomationScope);
    return `${AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX}${kind}:${key}:`;
}
export function agentAutomationRecordKey(record: AgentAutomationStoredRecord): string {
    return `${agentAutomationRecordPrefix(isCoverage(record) ? "coverage" : "authority", record.scope)}${record.sequence}`;
}
export function createAgentAutomationTerminalRecord(record: AgentAutomationStoredRecord, commit: AgentAutomationTaskCommit): AgentAutomationTerminalRecord {
    const value = terminalSchema.parse({ version: 1, record, commit,
        commitDigest: agentBindingHash({ recordDigest: record.recordDigest, commit }) });
    if (!hasTaskCommitBinding(value)) throw new Error("Invalid committed automation record");
    return value;
}
function hasTaskCommitBinding(value: AgentAutomationTerminalRecord): boolean {
    const { record, commit } = value;
    const origin = record.origin;
    return origin.kind === "task" && origin.actionId === commit.actionId && origin.userId === commit.userId
        && origin.taskId === commit.taskId && origin.taskRevision === commit.taskRevision
        && record.scope.clientId === commit.resourceId && record.recordedAt === commit.recordedAt
        && value.commitDigest === agentBindingHash({ recordDigest: record.recordDigest, commit });
}

/** Physical writer provenance survives deletion of temporary task/session/action rows. */
export function decodeAgentAutomationTerminalRow(row: {
    id: string; branchId: string | null; ruleId: string; dedupeKey: string; status: string;
    cancelReason: string | null; canceledAt: Date | null; sentAt: Date | null; scheduledFor: Date;
    clientId: number | null; employeeScheduleId: number | null; recipientPhone: string | null;
    recipientType: string; templateKey: string; nextAttemptAt: Date | null; attempts: number;
    claimToken: string | null; canceledByUser: boolean; payload: unknown;
}): AgentAutomationTerminalRecord | null {
    const parsed = payloadSchema.safeParse(row.payload);
    if (!parsed.success) return null;
    const value = parsed.data[AGENT_AUTOMATION_RECORD_PAYLOAD_KEY];
    const { record } = value;
    const recordedAt = new Date(record.recordedAt).getTime();
    return hasTaskCommitBinding(value) && row.id === record.id && row.branchId === record.scope.branchId
        && row.ruleId === MESSAGE_AUTOMATION_INTENT_RULE_ID && row.dedupeKey === agentAutomationRecordKey(record)
        && row.status === "canceled" && row.cancelReason === AGENT_AUTOMATION_RECORD_CANCEL_REASON
        && row.canceledAt?.getTime() === recordedAt && row.scheduledFor.getTime() === recordedAt && row.sentAt === null
        && row.clientId === null && row.employeeScheduleId === null && row.recipientPhone === null
        && row.recipientType === MessageTriggerRecipientType.CLIENT && row.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING
        && row.nextAttemptAt === null && row.attempts === 0 && row.claimToken === null && !row.canceledByUser ? value : null;
}
