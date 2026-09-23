import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY,
    SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE,
} from "domain/constants/service-end-notice-message";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";

type BoundJob = Pick<MessageTriggerJobEntity, "id" | "branchId" | "ruleId" | "clientId" | "employeeScheduleId"
    | "scheduledFor" | "dedupeKey" | "recipientPhone"> & { payload: unknown; recipientType: string; templateKey: string };

/**
 * All source payload fields are bound, including unused variables and catch-up
 * metadata, EXCEPT: the seal (always), the SMS delivery snapshot variable
 * (always), and — for SERVICE_END_NOTICE jobs only — the enricher-owned
 * receipt-link fields (`templateVariables.receiptUrl` and `buttonUrl`).
 * `ReceiptLinkDeliveryEnricher` refreshes those at delivery time to a new
 * server-derived link; excluding them keeps the pre- and post-enrichment
 * digest identical for this template. The rendered message text (which
 * embeds the link) is still covered by the delivery snapshot/provider hash
 * at send time, so the link's content is not left unbound. No other
 * template gets this exclusion.
 */
export function agentAutomationSourcePayload(payload: unknown, templateKey?: string): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid automation payload");
    const source = { ...payload as Record<string, unknown> };
    delete source[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY];
    const variables = source["templateVariables"];
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new Error("Invalid automation variables");
    source["templateVariables"] = { ...variables as Record<string, unknown> };
    delete (source["templateVariables"] as Record<string, unknown>)[SMS_DELIVERY_SNAPSHOT_VARIABLE];
    if (templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE) {
        delete (source["templateVariables"] as Record<string, unknown>)[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE];
        delete source[SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY];
    }
    return source;
}

/**
 * Stamp only the persisted UUID after final scheduling/catch-up construction.
 * Claim/status/attempt/timestamps are lifecycle state, not source identity.
 * The seal, the prepared snapshot, and (for SERVICE_END_NOTICE only) the
 * enricher-owned receipt-link fields are the ONLY excluded payload fields —
 * see `agentAutomationSourcePayload`. The snapshot has a separate provider
 * hash and claim fence; enrichment may not silently change any other bound
 * field.
 */
export function agentAutomationConcreteJobDigest(job: BoundJob): string {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(job.id)) {
        throw new Error("Automation job requires a persisted identity");
    }
    return agentBindingHash({ version: "agent-concrete-job-v1", id: job.id, branchId: job.branchId,
        ruleId: job.ruleId, clientId: job.clientId, employeeScheduleId: job.employeeScheduleId,
        scheduledFor: job.scheduledFor.toISOString(), dedupeKey: job.dedupeKey,
        recipientType: job.recipientType, recipientPhone: job.recipientPhone, templateKey: job.templateKey,
        payload: agentAutomationSourcePayload(job.payload, job.templateKey) });
}
