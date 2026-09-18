import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";

type BoundJob = Pick<MessageTriggerJobEntity, "id" | "branchId" | "ruleId" | "clientId" | "employeeScheduleId"
    | "scheduledFor" | "dedupeKey" | "recipientPhone"> & { payload: unknown; recipientType: string; templateKey: string };

/** All source payload fields are bound, including unused variables and catch-up metadata. */
export function agentAutomationSourcePayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid automation payload");
    const source = { ...payload as Record<string, unknown> };
    delete source[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY];
    const variables = source["templateVariables"];
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new Error("Invalid automation variables");
    source["templateVariables"] = { ...variables as Record<string, unknown> };
    delete (source["templateVariables"] as Record<string, unknown>)[SMS_DELIVERY_SNAPSHOT_VARIABLE];
    return source;
}

/**
 * Stamp only the persisted UUID after final scheduling/catch-up construction.
 * Claim/status/attempt/timestamps are lifecycle state, not source identity. The
 * seal itself and prepared snapshot are the ONLY excluded payload fields. The
 * snapshot has a separate provider hash and claim fence; enrichment may not
 * silently change any other bound field.
 */
export function agentAutomationConcreteJobDigest(job: BoundJob): string {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(job.id)) {
        throw new Error("Automation job requires a persisted identity");
    }
    return agentBindingHash({ version: "agent-concrete-job-v1", id: job.id, branchId: job.branchId,
        ruleId: job.ruleId, clientId: job.clientId, employeeScheduleId: job.employeeScheduleId,
        scheduledFor: job.scheduledFor.toISOString(), dedupeKey: job.dedupeKey,
        recipientType: job.recipientType, recipientPhone: job.recipientPhone, templateKey: job.templateKey,
        payload: agentAutomationSourcePayload(job.payload) });
}
