import { isRecordLinkGroup, recordLinkHash, resolveRecordLinkGroup } from "application/services/service-record-link-group-source";
import type { MessageTriggerJobPayload } from "domain/entities/message-trigger-job.entity";
import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { message_log, message_trigger_job } from "@prisma/client";
import { normalizePhone } from "domain/utils/normalize-phone";
import { SMS_TEMPLATE_DELIVERY } from "domain/constants/sms-template-delivery";
import { MessageTriggerRecipientType, MANUAL_SMS_TEMPLATE_KEY } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { occurrenceLevels } from "domain/entities/message-occurrence";
import type { MessageOccurrence, OccurrenceAdmission, SmsTemplateReference } from "domain/entities/message-occurrence";

type Tx = Prisma.TransactionClient;
type Level = ReturnType<typeof occurrenceLevels>[number];
type OccurrenceTarget = { occurrence: MessageOccurrence; manual: boolean };
const manualRefField = "verifiedSmsTemplateRef";
const contextField = "smsOccurrenceContext";
const logger = new Logger("MessageOccurrenceLedger");

function record(value: Prisma.JsonValue) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function manualTemplateVariables(template: SmsTemplateReference | undefined): Record<string, string> {
    return template ? { [manualRefField]: JSON.stringify(template) } : {};
}

function manualReference(log: message_log): SmsTemplateReference | undefined {
    const value = record(log.variables)[manualRefField];
    return typeof value === "string" ? JSON.parse(value) : undefined;
}

export function storedOccurrence(log: Pick<message_log, "variables">): OccurrenceTarget | undefined {
    const value = record(log.variables)[contextField];
    return typeof value === "string" ? JSON.parse(value) : undefined;
}

export function occurrenceVariables(target: OccurrenceTarget) {
    return { [contextField]: JSON.stringify(target) };
}

function jobTemplate(job: Pick<message_trigger_job, "templateKey" | "payload">): string | undefined {
    if (record(record(job.payload)["templateVariables"] ?? null)["triggerType"] === "agent_scheduled") return undefined;
    const config = SMS_TEMPLATE_DELIVERY[job.templateKey as keyof typeof SMS_TEMPLATE_DELIVERY];
    return config?.usePayloadMessage ? undefined : config?.systemTemplateKey;
}

function serviceRecordLinkPath(payload: Prisma.JsonValue): string | undefined {
    const url = record(payload)["buttonUrl"];
    if (typeof url !== "string") return undefined;
    try { return new URL(url).pathname; } catch { return undefined; }
}

async function resolveJobOccurrence(
    tx: Tx,
    job: Pick<message_trigger_job, "branchId" | "ruleId" | "clientId" | "employeeScheduleId" | "recipientType" | "templateKey" | "payload" | "dedupeKey">
        & Partial<Pick<message_trigger_job, "id" | "recipientEmployeeId" | "recipientPhone">>,
    receiver?: string,
    requireLinkProof = false,
): Promise<OccurrenceTarget | undefined> {
    const templateKey = jobTemplate(job);
    if (!templateKey) return undefined;
    const { branchId, clientId, employeeScheduleId } = job;
    if (!branchId || clientId === null) throw new StaleMessageOccurrenceRecipient();
    const [client, rule] = await Promise.all([
        tx.client.findFirst({ where: { id: clientId, branchId, deletedAt: null }, select: { phone: true } }),
        tx.message_trigger_rule.findFirst({
            where: { id: job.ruleId, OR: [{ branchId }, { branchId: null }], templateKey: job.templateKey },
            select: { id: true, groupId: true, eventType: true, branchId: true },
        }),
    ]);
    if (!client || !rule) throw new StaleMessageOccurrenceRecipient();
    const manual = isManualMessageTriggerJob(job);
    const slot = rule.groupId ? `group:${rule.groupId}` : `rule:${rule.id}`;
    const occurrence: MessageOccurrence = {
        branchId, serviceClientId: clientId, recipientKind: "client", recipientId: clientId,
        template: { kind: "system", key: templateKey }, event: rule.eventType, slot,
    };
    if (isRecordLinkGroup(job)) {
        const payload = record(job.payload) as unknown as MessageTriggerJobPayload;
        if (!job.id || !job.recipientPhone || templateKey !== "SERVICE_RECORD_LINK"
            || (receiver !== undefined && normalizePhone(receiver) !== job.recipientPhone)) {
            throw new StaleMessageOccurrenceRecipient();
        }
        const membership = await resolveRecordLinkGroup(tx, { ...job, id: job.id, recipientPhone: job.recipientPhone, payload });
        if (!membership) throw new StaleMessageOccurrenceRecipient();
        occurrence.recipientKind = "employee";
        occurrence.recipientId = membership.employeeId;
        occurrence.slot = `schedule:${employeeScheduleId}:group:${recordLinkHash(JSON.stringify(payload.recordLinkGroup?.members))}`;
        return { occurrence, manual };
    }
    if (job.recipientType === MessageTriggerRecipientType.CLIENT) {
        if (receiver !== undefined && (!normalizePhone(receiver) || normalizePhone(client.phone) !== normalizePhone(receiver))) throw new StaleMessageOccurrenceRecipient();
        if (job.ruleId === SERVICE_END_NOTICE_RULE_ID) delete occurrence.slot;
    } else {
        const primary = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE;
        if (!primary && job.recipientType !== MessageTriggerRecipientType.SECONDARY_EMPLOYEE) throw new StaleMessageOccurrenceRecipient();
        const schedule = employeeScheduleId && await tx.employee_schedule.findFirst({
            where: { id: employeeScheduleId, clientId, branchId, replaced: false, terminatedAt: null },
            select: { id: true, primaryEmployeeId: true, secondaryEmployeeId: true },
        });
        const employeeId = schedule ? (primary ? schedule.primaryEmployeeId : schedule.secondaryEmployeeId) : null;
        if (!schedule || !employeeId || employeeId !== record(job.payload)["employeeId"]) throw new StaleMessageOccurrenceRecipient();
        const employee = await tx.employee.findFirst({ where: { id: employeeId, branchId, deletedAt: null }, select: { phone: true } });
        if (!employee || (receiver !== undefined && (!normalizePhone(receiver) || normalizePhone(employee.phone) !== normalizePhone(receiver)))) throw new StaleMessageOccurrenceRecipient();
        occurrence.recipientKind = "employee";
        occurrence.recipientId = employeeId;
        occurrence.slot = `schedule:${schedule.id}:${job.recipientType}:${slot}`;
        if (job.ruleId === SERVICE_RECORD_LINK_RULE_ID) {
            const tokens = await tx.service_record_token.findMany({ where: {
                branchId, scheduleId: schedule.id, employeeId, active: true, revokedAt: null,
            }, select: { id: true, linkTokenHash: true }, take: 2 });
            if (tokens.length !== 1) throw new StaleMessageOccurrenceRecipient();
            const token = tokens[0]!;
            if ((requireLinkProof || receiver !== undefined)
                && serviceRecordLinkPath(job.payload) !== `/service-record/${token.linkTokenHash}`) {
                throw new StaleMessageOccurrenceRecipient();
            }
            occurrence.slot = `schedule:${schedule.id}:gen:${token.id}`;
        }
    }
    return { occurrence, manual };
}

export class StaleMessageOccurrenceRecipient extends Error {
    constructor() { super("SMS occurrence source or recipient changed"); }
}

export async function resolveLogOccurrence(tx: Tx, log: message_log): Promise<OccurrenceTarget | undefined> {
    if (!log.branchId || log.provider !== "aligo_sms") return undefined;
    const variables = record(log.variables);
    if (variables["testMode"] === "true") return undefined;
    const inherited = storedOccurrence(log);
    const job = log.triggerJobId && await tx.message_trigger_job.findFirst({ where: { id: log.triggerJobId, branchId: log.branchId } });
    const template = manualReference(log);
    let target;
    if (template) {
        if (job && (!isManualMessageTriggerJob(job) || job.templateKey !== MANUAL_SMS_TEMPLATE_KEY)) throw new StaleMessageOccurrenceRecipient();
        if (log.clientId === null) return undefined;
        const client = await tx.client.findFirst({ where: { id: log.clientId, branchId: log.branchId, deletedAt: null }, select: { phone: true } });
        if (!client || !normalizePhone(log.receiver) || normalizePhone(client.phone) !== normalizePhone(log.receiver)) throw new StaleMessageOccurrenceRecipient();
        target = { manual: true, occurrence: {
            branchId: log.branchId, serviceClientId: log.clientId, recipientKind: "client" as const, recipientId: log.clientId, template,
        } };
    } else if (job) {
        if (job.clientId !== log.clientId) throw new StaleMessageOccurrenceRecipient();
        target = await resolveJobOccurrence(tx, job, log.receiver);
    }
    if (inherited) {
        if (!target || inherited.occurrence.branchId !== log.branchId
            || occurrenceLevels(target.occurrence).at(-1)?.occurrenceKey !== occurrenceLevels(inherited.occurrence).at(-1)?.occurrenceKey) {
            throw new StaleMessageOccurrenceRecipient();
        }
        return { ...inherited, manual: inherited.manual || variables["retryInvocation"] === "manual" };
    }
    return target ? { ...target, manual: target.manual || variables["retryInvocation"] === "manual" } : undefined;
}

async function lockLevels(tx: Tx, levels: Level[]) {
    const rows: Array<{ occurrence_key: string; state: string; holder_log_id: number | null }> = [];
    for (const level of levels) {
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO message_occurrence_claim
                (branch_id, occurrence_key, template_key, event_type, lifecycle_id, recipient_kind, recipient_id, slot)
            VALUES (${level.branchId}::uuid, ${level.occurrenceKey}, ${level.templateKey}, ${level.eventType},
                ${level.lifecycleId}, ${level.recipientKind}, ${level.recipientId}, ${level.slot})
            ON CONFLICT (branch_id, occurrence_key) DO NOTHING
        `);
        const [row] = await tx.$queryRaw<typeof rows>(Prisma.sql`
            SELECT occurrence_key, state, holder_log_id FROM message_occurrence_claim
            WHERE branch_id = ${level.branchId}::uuid AND occurrence_key = ${level.occurrenceKey}
            FOR UPDATE
        `);
        if (!row) throw new Error("Missing locked message occurrence");
        rows.push(row);
    }
    return rows;
}

async function historicalProof(tx: Tx, target: MessageOccurrence, logTemplate?: string) {
    const { branchId, serviceClientId, template, recipientKind, event, slot } = target;
    if (template.kind !== "system" || !event) return undefined;
    const isEndNotice = recipientKind === "client" && template.key === "SERVICE_END_NOTICE" && event === "SERVICE_END";
    const key = logTemplate ?? Object.values(SMS_TEMPLATE_DELIVERY).find(config => config.systemTemplateKey === template.key)?.smsLogTemplateKey;
    if (!key) return undefined;
    const rows = await tx.message_log.findMany({
        where: {
            branchId, clientId: serviceClientId, provider: "aligo_sms", templateKey: key,
            OR: [{ providerAcceptanceState: { in: ["accepted", "reconciled_delivered"] }, providerAcceptedAt: { not: null } },
                { providerAcceptanceState: "legacy", status: "sent" }],
        },
        include: { triggerJob: { include: { rule: true } } },
        orderBy: { id: "asc" },
    });
    const stamp = isEndNotice ? (await tx.client.findFirst({
        where: { id: serviceClientId, branchId }, select: { serviceEndNoticeSentAt: true },
    }))?.serviceEndNoticeSentAt : null;
    const stamped = stamp && rows.filter(row => row.providerAcceptedAt?.getTime() === stamp.getTime());
    const stampHasLog = stamp && await tx.message_log.count({
        where: { branchId, clientId: serviceClientId, templateKey: key, provider: "aligo_sms", providerAcceptedAt: stamp },
    });
    const levels = occurrenceLevels(target);
    let unprovable = false;
    for (const row of rows) {
        // A new occurrence already carries its immutable proof in the ledger.
        if (storedOccurrence(row) || record(row.variables)["testMode"] === "true") continue;
        const job = row.triggerJob;
        if (!job || job.branchId !== branchId || job.clientId !== serviceClientId || jobTemplate(job) !== template.key
            || job.rule.templateKey !== job.templateKey || (job.rule.branchId !== null && job.rule.branchId !== branchId)) {
            unprovable = true;
            continue;
        }
        if (job.rule.eventType !== event) continue;
        if (recipientKind === "employee") {
            if (record(job.payload)["employeeId"] !== target.recipientId || job.employeeScheduleId === null) continue;
            const historical = await resolveJobOccurrence(tx, job, undefined, true).catch(error => {
                if (error instanceof StaleMessageOccurrenceRecipient) return undefined;
                throw error;
            });
            if (historical && occurrenceLevels(historical.occurrence).at(-1)?.occurrenceKey === levels.at(-1)?.occurrenceKey) {
                return { level: levels.at(-1)!, logId: row.id, via: historical.manual ? "manual" : "automatic", proof: "historical" };
            }
            unprovable ||= !historical;
            continue;
        }
        if (job.employeeScheduleId !== null || job.recipientType !== MessageTriggerRecipientType.CLIENT) continue;
        if (job.ruleId === SERVICE_END_NOTICE_RULE_ID) {
            return { level: levels[1]!, logId: row.id, via: "manual", proof: "historical" };
        }
        const historicalSlot = job.rule.groupId ? `group:${job.rule.groupId}` : `rule:${job.ruleId}`;
        if (slot === historicalSlot) return { level: levels.at(-1)!, logId: row.id,
            via: isManualMessageTriggerJob(job) ? "manual" : "automatic", proof: "historical" };
    }
    if (stamp && stampHasLog === 0) return { level: levels[1]!, logId: null, via: null, proof: "legacy_stamp" };
    if (stamped && stamped.length === 1) {
        const row = stamped[0]!;
        // A detached job may have been an independent recurring slot. Without an
        // explicit manual/system origin it cannot prove wildcard acceptance.
        if (!storedOccurrence(row) && record(row.variables)["testMode"] !== "true"
            && (row.triggerJob?.ruleId === SERVICE_END_NOTICE_RULE_ID
                || (!row.triggerJob && record(row.variables)["origin"] === "ADMIN_DIRECT"))) {
            return { level: levels[1]!, logId: row.id, via: "manual", proof: "legacy_stamp" };
        }
    }
    if (unprovable) logger.debug("historical_unprovable");
    return undefined;
}

export async function hasAcceptedJobOccurrence(tx: Tx, job: Parameters<typeof resolveJobOccurrence>[1]): Promise<boolean> {
    const target = await resolveJobOccurrence(tx, job).catch(error => {
        if (error instanceof StaleMessageOccurrenceRecipient) return undefined;
        throw error;
    });
    if (!target || target.manual) return false;
    const keys = occurrenceLevels(target.occurrence).map(level => level.occurrenceKey);
    const accepted = await tx.message_occurrence_claim.findFirst({
        where: { branchId: target.occurrence.branchId, occurrenceKey: { in: keys }, state: "accepted" },
        select: { occurrenceKey: true },
    });
    return accepted !== null || Boolean(await historicalProof(tx, target.occurrence));
}

export async function admitOccurrence(tx: Tx, logId: number, target: OccurrenceTarget, logTemplate?: string): Promise<OccurrenceAdmission> {
    const levels = occurrenceLevels(target.occurrence);
    const rows = await lockLevels(tx, levels);
    const last = levels.at(-1)!;
    const { branchId, occurrenceKey } = last;
    if (target.manual) {
        await tx.message_occurrence_manual_attempt.create({ data: { branchId, occurrenceKey, logId, state: "in_flight" } });
        return "admitted";
    }
    if (rows.some(row => row.state === "accepted")) return "accepted";
    if (rows.some(row => row.state !== "released")) return "held";
    const manual = await tx.message_occurrence_manual_attempt.findFirst({ where: {
        branchId, occurrenceKey: { in: levels.map(level => level.occurrenceKey) }, state: { in: ["in_flight", "uncertain"] },
    }, select: { logId: true } });
    if (manual) return "held";
    const history = await historicalProof(tx, target.occurrence, logTemplate);
    if (history) {
        await tx.message_occurrence_claim.update({ where: { branchId_occurrenceKey: {
            branchId, occurrenceKey: history.level.occurrenceKey,
        } }, data: {
            state: "accepted", acceptedLogId: history.logId, acceptedVia: history.via, proofSource: history.proof, updatedAt: new Date(),
        } });
        return "accepted";
    }
    await tx.message_occurrence_claim.update({ where: { branchId_occurrenceKey: { branchId, occurrenceKey } },
        data: { state: "in_flight", holderLogId: logId, updatedAt: new Date() } });
    return "admitted";
}

/** Carry a released root's holder forward without admitting the retry. */
export async function transferReleasedOccurrenceHolder(
    tx: Tx, target: OccurrenceTarget, sourceLogId: number, retryLogId: number,
): Promise<void> {
    if (target.manual) return;
    const levels = occurrenceLevels(target.occurrence);
    const { branchId, occurrenceKey } = levels.at(-1)!;
    await lockLevels(tx, levels);
    await tx.message_occurrence_claim.updateMany({
        where: { branchId, occurrenceKey, holderLogId: sourceLogId, state: "released" },
        data: { holderLogId: retryLogId, updatedAt: new Date() },
    });
}

export async function settleOccurrence(tx: Tx, log: message_log, target = storedOccurrence(log)): Promise<void> {
    if (!target || log.branchId !== target.occurrence.branchId) return;
    const providerState = log.providerAcceptanceState;
    const state = providerState === "accepted" || providerState === "reconciled_delivered" ? "accepted"
        : providerState === "rejected" || providerState === "reconciled_not_delivered" ? "released"
        : providerState === "uncertain" ? "uncertain" : undefined;
    if (!state) return;
    const levels = occurrenceLevels(target.occurrence);
    await lockLevels(tx, levels);
    const { branchId, occurrenceKey } = levels.at(-1)!;
    const now = new Date();
    const active = { in: ["in_flight", "uncertain"] };
    if (target.manual) {
        const moved = await tx.message_occurrence_manual_attempt.updateMany({
            where: { branchId, occurrenceKey, logId: log.id, state: active }, data: { state, updatedAt: now },
        });
        if (moved.count && state === "accepted") await tx.message_occurrence_claim.updateMany({
            where: { branchId, occurrenceKey, state: { not: "accepted" } },
            data: { state, acceptedVia: "manual", acceptedLogId: log.id, proofSource: "provider", updatedAt: now },
        });
        return;
    }
    await tx.message_occurrence_claim.updateMany({
        where: { branchId, occurrenceKey, holderLogId: log.id, state: active },
        data: { state, updatedAt: now,
            ...(state === "released" ? { epoch: { increment: 1 } } : {}),
            ...(state === "accepted" ? { acceptedVia: "automatic", acceptedLogId: log.id, proofSource: "provider" } : {}) },
    });
}
