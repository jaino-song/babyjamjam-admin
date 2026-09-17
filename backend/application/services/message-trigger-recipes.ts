import { createHash } from "node:crypto";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { buildSmsClientVariables } from "./sms-client-variables";
import { PAST_OCCURRENCE_GRACE_MS } from "domain/constants/message-automation-policy";

/** Pure recipe input shared by preview and the existing delivery-job materializer. */
export type MessageTriggerJobRecipe = Parameters<typeof MessageTriggerJobEntity.create>[0];

/** The ordinary materializer and task preview must apply the same live/past gate. */
export function isMessageRecipeWithinMaterializationWindow(
    job: Pick<MessageTriggerJobRecipe, "scheduledFor">,
    rule: Pick<MessageTriggerRuleEntity, "offsetType">,
    includePast: boolean,
    now: Date,
): boolean {
    if (includePast) return true;
    const scheduledFor = job.scheduledFor.getTime();
    return scheduledFor >= now.getTime() - PAST_OCCURRENCE_GRACE_MS
        && !(rule.offsetType === MessageTriggerOffsetType.IMMEDIATE && scheduledFor <= now.getTime());
}

export interface ClientTriggerSource {
    id: number;
    name: string;
    phone: string | null;
    type: string | null;
    startDate: Date | null;
    endDate: Date | null;
    serviceEndNoticeSentAt: Date | null;
    createdAt?: Date | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}

export interface EmployeeAssignmentScheduleSource {
    id: number;
    branchId: string | null;
    clientId: number;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    /**
     * Deliberately absent from the fingerprint Pick below. Termination is checked
     * explicitly in the pre-send fence instead, because widening the fingerprint
     * would change every schedule's hash at once and cancel every already-pending
     * assignment job on its next dispatch.
     */
    terminatedAt: Date | null;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    client: { id: number; name: string };
    primaryEmployee: { id: number; name: string; phone: string } | null;
    secondaryEmployee: { id: number; name: string; phone: string } | null;
}

type EmployeeAssignmentScheduleFingerprintSource = Pick<
    EmployeeAssignmentScheduleSource,
    | "id"
    | "branchId"
    | "clientId"
    | "workAddress"
    | "startDate"
    | "endDate"
    | "replaced"
    | "primaryEmployeeId"
    | "secondaryEmployeeId"
> & Partial<Pick<EmployeeAssignmentScheduleSource, "client" | "primaryEmployee" | "secondaryEmployee">>;

function employeeAssignmentEmployeeFingerprint(
    employee: EmployeeAssignmentScheduleSource["primaryEmployee"] | undefined,
): { id: number; name: string; phone: string } | null {
    if (!employee) return null;
    return { id: employee.id, name: employee.name, phone: employee.phone };
}

/**
 * A schedule has no version column. Persisting this opaque source fingerprint
 * in the assignment job lets the dispatcher reject a claimed job built from
 * any older schedule/assignment generation without copying address data into
 * the provider payload.
 */
export function employeeAssignmentScheduleFingerprint(
    schedule: EmployeeAssignmentScheduleFingerprintSource,
    recipientType: MessageTriggerRecipientType,
): string {
    return createHash("sha256").update(JSON.stringify({
        version: "employee-assignment-source-v1",
        recipientType,
        id: schedule.id,
        branchId: schedule.branchId,
        clientId: schedule.clientId,
        client: schedule.client
            ? { id: schedule.client.id, name: schedule.client.name }
            : null,
        workAddress: schedule.workAddress,
        startDate: schedule.startDate.toISOString(),
        endDate: schedule.endDate.toISOString(),
        replaced: schedule.replaced,
        primaryEmployeeId: schedule.primaryEmployeeId,
        secondaryEmployeeId: schedule.secondaryEmployeeId,
        primaryEmployee: employeeAssignmentEmployeeFingerprint(schedule.primaryEmployee),
        secondaryEmployee: employeeAssignmentEmployeeFingerprint(schedule.secondaryEmployee),
    })).digest("hex");
}

export function buildClientMessageRecipe(
    rule: MessageTriggerRuleEntity,
    client: ClientTriggerSource,
    now: Date,
): MessageTriggerJobRecipe | null {
    if (!client.phone) return null;
    if (
        rule.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE
        && client.serviceEndNoticeSentAt !== null
    ) {
        return null;
    }

    const anchorDate = getClientAnchorDate(rule.eventType, client);
    if (!anchorDate) return null;

    const scheduledFor = computeScheduledFor(anchorDate, rule, now);
    const payload = {
        clientId: client.id,
        clientName: client.name,
        memberId: client.id.toString(),
        recipientName: client.name,
        recipientPhone: client.phone,
        templateVariables: buildClientTemplateVariables(rule, client),
    };

    return {
        branchId: rule.branchId ?? undefined,
        ruleId: rule.id,
        scheduledFor,
        clientId: client.id,
        recipientType: rule.recipientType,
        recipientPhone: client.phone,
        templateKey: rule.templateKey,
        dedupeKey: buildMessageRecipeDedupeKey(rule.id, `client:${client.id}`, scheduledFor, rule.recipientType),
        payload,
    };
}

export function buildEmployeeAssignmentMessageRecipe(
    rule: MessageTriggerRuleEntity,
    schedule: EmployeeAssignmentScheduleSource,
    now: Date,
): MessageTriggerJobRecipe | null {
    const employee =
        rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            ? schedule.primaryEmployee
            : schedule.secondaryEmployee;
    if (!employee?.phone) return null;

    const scheduledFor = new Date(now);
    const memberId = `employee:${employee.id}`;
    return {
        branchId: rule.branchId ?? undefined,
        ruleId: rule.id,
        scheduledFor,
        clientId: schedule.clientId,
        employeeScheduleId: schedule.id,
        recipientType: rule.recipientType,
        recipientPhone: employee.phone,
        templateKey: rule.templateKey,
        dedupeKey: `${rule.id}:schedule:${schedule.id}:employee:${employee.id}:${rule.recipientType}`,
        payload: {
            clientId: schedule.clientId,
            clientName: schedule.client.name,
            employeeId: employee.id,
            employeeName: employee.name,
            employeeScheduleFingerprint: employeeAssignmentScheduleFingerprint(schedule, rule.recipientType),
            memberId,
            recipientName: employee.name,
            recipientPhone: employee.phone,
            templateVariables: {
                employeeName: employee.name,
                clientName: schedule.client.name,
                serviceStartDate: formatMessageRecipeDate(schedule.startDate),
            },
        },
    };
}

export function buildClientTemplateVariables(
    rule: MessageTriggerRuleEntity,
    client: Omit<ClientTriggerSource, "id" | "serviceEndNoticeSentAt">,
): Record<string, string> {
    switch (rule.templateKey) {
        case MessageTriggerTemplateKey.PRICE_INFO:
            // PRICE_INFO is the only SMS template that renders price/bank fields,
            // so it is the only one that carries them into the job payload (data minimization).
            return buildSmsClientVariables(client);
        case MessageTriggerTemplateKey.SERVICE_INFO:
        case MessageTriggerTemplateKey.CLIENT_GREETING:
        case MessageTriggerTemplateKey.REMINDER:
        case MessageTriggerTemplateKey.THANKS:
        case MessageTriggerTemplateKey.SURVEY:
        case MessageTriggerTemplateKey.INFO:
        case MessageTriggerTemplateKey.SERVICE_END_NOTICE:
            return { name: client.name, clientName: client.name, phone: client.phone ?? "" };
        default:
            return {};
    }
}

function getClientAnchorDate(
    eventType: MessageTriggerEventType,
    client: Pick<ClientTriggerSource, "createdAt" | "startDate" | "endDate">,
): Date | null {
    switch (eventType) {
        case MessageTriggerEventType.CLIENT_CREATED:
            return client.createdAt ?? null;
        case MessageTriggerEventType.SERVICE_START:
            return client.startDate;
        case MessageTriggerEventType.SERVICE_END:
            return client.endDate;
        default:
            return null;
    }
}

function computeScheduledFor(anchorDate: Date, rule: MessageTriggerRuleEntity, now: Date): Date {
    if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) {
        return new Date(now);
    }

    let offsetDays = 0;
    if (rule.offsetType === MessageTriggerOffsetType.BEFORE_DAYS) {
        offsetDays = -rule.offsetDays;
    } else if (rule.offsetType === MessageTriggerOffsetType.AFTER_DAYS) {
        offsetDays = rule.offsetDays;
    }

    const targetDate = getKstCalendarDate(anchorDate, offsetDays);
    return new Date(`${targetDate}T${rule.sendTime}:00+09:00`);
}

export function getKstCalendarDate(referenceDate: Date, offsetDays: number): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = new Map(
        formatter.formatToParts(referenceDate).map((part) => [part.type, part.value]),
    );
    const year = Number(parts.get("year"));
    const month = Number(parts.get("month"));
    const day = Number(parts.get("day"));
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
}

export function buildMessageRecipeDedupeKey(
    ruleId: string,
    sourceKey: string,
    scheduledFor: Date,
    recipientType: MessageTriggerRecipientType,
): string {
    return `${ruleId}:${sourceKey}:${recipientType}:${scheduledFor.toISOString()}`;
}

export function formatMessageRecipeDate(date: Date | null): string {
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
