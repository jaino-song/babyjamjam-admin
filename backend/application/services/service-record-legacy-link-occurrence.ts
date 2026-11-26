import { Prisma } from "@prisma/client";

import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_RECORD_LINK_RULE_ID, SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY } from "domain/constants/service-record-link-message";
import type { MessageLogEntity } from "domain/entities/message-log.entity";

export const RECORD_LINK_GROUP_LOG_MARKER = "recordLinkGroupVersion";

interface LegacyLinkOccurrence {
    branchId: string;
    clientId: number;
    scheduleId: number;
    incarnationId: string;
    employeeId: number;
    phone: string;
}

function recordLinkCredential(text: string): string | null {
    const tokens = new Set(Array.from(text.matchAll(/https?:\/\/[^\s/]+\/service-record\/(efl_[\w-]+)(?=[\s?#]|$)/g), match => match[1]!));
    return tokens.size === 1 ? [...tokens][0]! : null;
}

/** An earlier refusal can retain the marker written when its retry outcome was unknown. */
export function hasReconciledLegacyLinkRetry(log: MessageLogEntity, family: readonly MessageLogEntity[]): boolean {
    return log.templateKey === SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY && log.status === "failed"
        && log.providerAcceptanceState === "rejected" && log.variables["retrySafety"] === "uncertain"
        && !Object.prototype.hasOwnProperty.call(log.variables, RECORD_LINK_GROUP_LOG_MARKER)
        && family.some(child => child.variables["retryOfLogId"] === String(log.id)
            && child.templateKey === log.templateKey && child.provider === log.provider && child.branchId === log.branchId
            && child.clientId === log.clientId && child.triggerJobId === log.triggerJobId && child.receiver === log.receiver
            && child.providerAcceptanceState === "reconciled_not_delivered");
}

/** Normalize legacy attempts and their descendants without changing historical evidence. */
export async function readLegacyLinkOccurrence(tx: Prisma.TransactionClient, occurrence: LegacyLinkOccurrence) {
    const { branchId, clientId, scheduleId, incarnationId, employeeId, phone } = occurrence;
    const jobs = await tx.$queryRaw<Array<{ id: string; status: string; canceledByUser: boolean }>>(Prisma.sql`
        SELECT id, status, canceled_by_user AS "canceledByUser"
        FROM message_trigger_job
        WHERE branch_id = ${branchId}::uuid AND client_id = ${clientId} AND employee_schedule_id = ${scheduleId}
          AND rule_id = ${SERVICE_RECORD_LINK_RULE_ID} AND template_key = ${MessageTriggerTemplateKey.SERVICE_RECORD_LINK}
          AND recipient_employee_id IS NULL AND NOT (payload ? 'recordLinkGroup')
          AND payload->>'employeeId' = ${String(employeeId)}
          AND COALESCE(payload->>'scheduleId', ${String(scheduleId)}) = ${String(scheduleId)}
          AND COALESCE(payload->>'scheduleIncarnationId', ${incarnationId}) = ${incarnationId}
          AND regexp_replace(COALESCE(recipient_phone, payload->>'recipientPhone'), '[^0-9]', '', 'g') = ${phone}
    `);
    const ids = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        WITH RECURSIVE attempts AS (
            SELECT log.id
            FROM message_log log
            WHERE log.branch_id = ${branchId}::uuid AND log.provider = 'aligo_sms'
              AND log.template_key = ${SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY}
              AND (log.client_id IS NULL OR log.client_id = ${clientId})
              AND regexp_replace(log.receiver, '[^0-9]', '', 'g') = ${phone}
              AND NOT (log.variables ? ${RECORD_LINK_GROUP_LOG_MARKER})
              AND (
                ${jobs.length ? Prisma.sql`log.trigger_job_id IN (${Prisma.join(jobs.map(job => job.id))}) OR` : Prisma.empty}
                (log.trigger_job_id IS NULL AND log.client_id = ${clientId}
                 AND log.variables->>'scheduleId' = ${String(scheduleId)}
                 AND log.variables->>'employeeId' = ${String(employeeId)}
                 AND COALESCE(log.variables->>'scheduleIncarnationId', ${incarnationId}) = ${incarnationId})
              )
            UNION
            SELECT child.id
            FROM message_log child
            JOIN attempts parent ON child.variables->>'retryOfLogId' = parent.id::text
            WHERE child.branch_id = ${branchId}::uuid AND child.provider = 'aligo_sms'
              AND child.template_key = ${SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY}
              AND (child.client_id IS NULL OR child.client_id = ${clientId})
              AND regexp_replace(child.receiver, '[^0-9]', '', 'g') = ${phone}
        )
        SELECT id FROM attempts
    `);
    const logs = ids.length ? await tx.message_log.findMany({
        where: { branchId, id: { in: ids.map(({ id }) => id) } },
        select: { id: true, status: true, variables: true, messageBody: true, aligoMid: true,
            providerAcceptanceState: true, providerAcceptedAt: true, providerCallStartedAt: true, carrierResultState: true,
            occurrenceClaimsAccepted: { where: { branchId, state: "accepted" }, take: 1, select: { occurrenceKey: true } } },
    }) : [];
    const reconciledParents = new Set(logs.filter(log => log.providerAcceptanceState === "reconciled_not_delivered")
        .map(log => (log.variables as Prisma.JsonObject | null)?.["retryOfLogId"]));
    const rejected = [];
    let blocked = jobs.some(job => job.status === "sent" || job.status === "dispatching");
    for (const log of logs) {
        const safety = (log.variables as Prisma.JsonObject | null)?.["retrySafety"];
        if (log.status === "sent" || log.providerAcceptedAt || log.occurrenceClaimsAccepted.length
            || ["delivered", "failed"].includes(log.carrierResultState ?? "")
            || ["accepted", "reconciled_delivered"].includes(log.providerAcceptanceState)
            || safety === "partial" || safety === "delivered" || safety === "accepted") {
            blocked = true;
        } else if (log.status === "failed" && ["rejected", "reconciled_not_delivered"].includes(log.providerAcceptanceState)) {
            if (safety === "uncertain" && !reconciledParents.has(String(log.id))) {
                blocked = true;
            }
            rejected.push({ id: log.id, messageBody: log.messageBody, credential: recordLinkCredential(log.messageBody) });
        } else if (log.providerAcceptanceState !== "prepared" || log.providerCallStartedAt || log.aligoMid) {
            blocked = true;
        }
    }
    return { jobs, blocked, rejected };
}
