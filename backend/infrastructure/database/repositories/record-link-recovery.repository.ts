import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { Prisma } from "@prisma/client";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordLinkScheduledFor,
    getServiceRecordServiceEndedAt,
    SERVICE_RECORD_LINK_ENDED_REASON,
    SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
} from "domain/constants/service-record-link-message";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import { SERVICE_STATUS, type ServiceStatusType } from "domain/value-objects/service-status.vo";

export const RECORD_LINK_RECOVERY_REASON = "record_link_pre_booking";
export const RECORD_LINK_RECOVERY_PREFIX = "record-retry:";
export const RECORD_LINK_RECOVERY_REFUSED = "예약 전 제공기록지 링크 재시도 조건을 충족하지 않습니다";

export type RecordLinkStatusInputs = Parameters<typeof recordLinkClientStatus>[0];
export function recordLinkClientStatus(client: {
    serviceStatus?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    bookingConfirmedAt?: Date | null;
}, now: Date): ServiceStatusType {
    return getEffectiveClientServiceStatus(client.serviceStatus ?? null, client.startDate ?? null,
        client.endDate ?? null, client.bookingConfirmedAt ?? null, now);
}

export function permitsRecordLinkRecovery(status: ServiceStatusType): boolean {
    return status === SERVICE_STATUS.WAITING || status === SERVICE_STATUS.ACTIVE;
}

const recoveryIdentity = {
    ruleId: SERVICE_RECORD_LINK_RULE_ID,
    templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
    recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
} as const;

export const recordLinkAssignmentInclude = {
    client: true,
    primaryEmployee: true,
} as const;

export type RecordLinkAssignment = Prisma.employee_scheduleGetPayload<{ include: typeof recordLinkAssignmentInclude }>;

export function recordLinkAssignmentMatches(
    schedule: RecordLinkAssignment | null,
    branchId: string,
    clientId: number,
    now: Date,
): schedule is RecordLinkAssignment {
    return !!schedule && schedule.branchId === branchId && schedule.clientId === clientId
        && schedule.client.branchId === branchId && !schedule.client.deletedAt
        && schedule.primaryEmployee.branchId === branchId && !schedule.primaryEmployee.deletedAt
        && !schedule.replaced && !schedule.terminatedAt && getServiceRecordServiceEndedAt(schedule.endDate) > now;
}

export async function readRecordLinkAssignment(
    tx: Prisma.TransactionClient, branchId: string, scheduleId: number,
): Promise<RecordLinkAssignment | null> {
    return tx.employee_schedule.findFirst({
        where: { id: scheduleId, branchId },
        include: recordLinkAssignmentInclude,
    });
}

export async function readRecordLinkEpoch(tx: Prisma.TransactionClient, branchId: string): Promise<Date | null> {
    const override = await tx.message_trigger_rule_branch_override.findUnique({
        where: { branchId_ruleId: { branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID } },
        select: { canceledRetryEnabledAt: true, isActive: true },
    });
    return override?.isActive === false ? null : override?.canceledRetryEnabledAt ?? null;
}

export async function hasApprovedRecordLinkSender(tx: Prisma.TransactionClient, branchId: string): Promise<boolean> {
    // Sender approval writers take a branch row lock. Keep that state stable
    // through the attempt or admission even when they do not take the advisory lock.
    const [branch] = await tx.$queryRaw<Array<{ approved: boolean }>>(Prisma.sql`
        SELECT sms_sender_approval_status = 'approved' AS approved
        FROM branch WHERE id = ${branchId}::uuid FOR SHARE
    `);
    return branch?.approved === true;
}

export async function lockRecordLinkSchedule(tx: Prisma.TransactionClient, scheduleId: number): Promise<void> {
    // Shared with manual send, token revocation and automatic claim promotion.
    await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`message-trigger-job-replace:${SERVICE_RECORD_LINK_RULE_ID}:${scheduleId}`}, 0))
    `);
}

async function ensureRecordLinkRuleForObservation(tx: Prisma.TransactionClient): Promise<void> {
    // The one fixed branchless rule may not exist before the first assignment.
    // Use a parameterized insert so this scoped customer write need not widen
    // its tenant context or initialize the template/issuer.
    await tx.$executeRaw(Prisma.sql`
        INSERT INTO message_trigger_rule (id, name, is_active, event_type, offset_type, offset_days,
            recipient_type, template_key, is_default, jobs_stale, updated_at)
        VALUES (${SERVICE_RECORD_LINK_RULE_ID}, ${SERVICE_RECORD_LINK_SMS_TITLE}, true,
            ${MessageTriggerEventType.SERVICE_START}, ${MessageTriggerOffsetType.SAME_DAY}, 0,
            ${recoveryIdentity.recipientType}, ${recoveryIdentity.templateKey}, false, false, clock_timestamp())
        ON CONFLICT (id) DO NOTHING
    `);
}

export async function observePreBookingRecordLinkAssignment(
    tx: Prisma.TransactionClient, branchId: string, scheduleId: number,
): Promise<boolean> {
    const schedule = await readRecordLinkAssignment(tx, branchId, scheduleId);
    const now = new Date();
    if (!schedule || schedule.client.branchId !== branchId || schedule.client.deletedAt || schedule.replaced
        || recordLinkClientStatus(schedule.client, now) !== SERVICE_STATUS.PRE_BOOKING) return false;
    await observeRecordLinkBlock(tx, schedule, now);
    return true;
}

export async function observeRecordLinkBlock(
    tx: Prisma.TransactionClient,
    schedule: RecordLinkAssignment,
    now: Date,
    transition?: ServiceStatusType,
): Promise<void> {
    if (!schedule.branchId) return;
    const where = { ...recoveryIdentity, branchId: schedule.branchId, clientId: schedule.clientId, employeeScheduleId: schedule.id };
    // A pending original is still entitled to ordinary due processing. Any
    // terminal original keeps its original cancellation and due time.
    const existing = await tx.message_trigger_job.findFirst({ where, select: { id: true } });
    if (existing) return;
    await ensureRecordLinkRuleForObservation(tx);
    const epoch = transition ? null : await readRecordLinkEpoch(tx, schedule.branchId);
    await tx.message_trigger_job.createMany({
        skipDuplicates: true,
        data: {
            ...where,
            status: "canceled",
            scheduledFor: getServiceRecordLinkScheduledFor(schedule.startDate),
            cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
            canceledAt: now,
            recipientPhone: schedule.primaryEmployee.phone,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary`,
            payload: {
                scheduleId: schedule.id,
                scheduleIncarnationId: schedule.incarnationId,
                employeeId: schedule.primaryEmployeeId,
                clientId: schedule.clientId,
                templateVariables: {},
            },
            // An assignment discovered only on exit has no originating
            // observation. Reserve its identity with a terminal legacy blocker.
            ...(transition ? {} : {
                recoveryReason: RECORD_LINK_RECOVERY_REASON,
                recoveryEpoch: epoch,
                firstBlockedAt: now,
                recoveryState: "awaiting_transition",
            }),
        },
    });
}

export async function recordLinkTransition(
    tx: Prisma.TransactionClient, branchId: string, clientId: number, status: ServiceStatusType, now: Date,
    allowRecovery: boolean,
): Promise<void> {
    const base = {
        ...recoveryIdentity, branchId, clientId,
        status: "canceled", cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON, canceledByUser: false,
        recoveryReason: RECORD_LINK_RECOVERY_REASON, recoveryState: "awaiting_transition",
    };
    const enrollment = {
        recoveryEpoch: { not: null },
        employeeSchedule: { is: { branchId, clientId, replaced: false, terminatedAt: null } },
    };
    const eligible = allowRecovery && permitsRecordLinkRecovery(status);
    await tx.message_trigger_job.updateMany({
        where: { ...base, ...(eligible ? { NOT: enrollment } : {}) },
        data: { recoveryState: "ineligible_terminal", recoveryTransitionStatus: status },
    });
    if (!eligible) return;
    await tx.message_trigger_job.updateMany({
        where: { ...base, ...enrollment },
        data: { recoveryState: "eligible", recoveryTransitionStatus: status, nextCheckAt: now },
    });
}

/** Assignment-scoped acceptance history, including explicit sends and old logs. */
export async function hasRecordLinkAcceptance(
    tx: Prisma.TransactionClient, schedule: RecordLinkAssignment,
): Promise<boolean> {
    const stored = await tx.message_log.findFirst({
        where: {
            branchId: schedule.branchId,
            provider: "aligo_sms",
            templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
            AND: [
                { OR: [
                    { triggerJob: { is: {
                        branchId: schedule.branchId, clientId: schedule.clientId,
                        employeeScheduleId: schedule.id, templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    } } },
                    { clientId: schedule.clientId, variables: { path: ["scheduleId"], equals: String(schedule.id) } },
                    { clientId: schedule.clientId, variables: { path: ["scheduleId"], equals: schedule.id } },
                ] },
                { OR: [
                    { providerAcceptanceState: { in: ["accepted", "reconciled_delivered", "started", "uncertain"] } },
                    { providerAcceptedAt: { not: null } },
                    { carrierResultState: { in: ["delivered", "failed"] } },
                    { providerAcceptanceState: "legacy", OR: [{ status: "sent" }, { aligoMid: { not: null } }] },
                ] },
            ],
        },
        select: { id: true },
    });
    return stored !== null;
}

export async function findRecordLinkTerminalSibling(
    tx: Prisma.TransactionClient, schedule: RecordLinkAssignment, excludedId: string,
): Promise<string | null> {
    const predecessor = await tx.message_trigger_job.findFirst({
        where: { ...recoveryIdentity, branchId: schedule.branchId, clientId: schedule.clientId,
            employeeScheduleId: schedule.id, id: { not: excludedId }, status: "canceled",
            cancelReason: { in: [MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON, SERVICE_RECORD_LINK_PRE_BOOKING_REASON] },
            NOT: { dedupeKey: { contains: ":manual:" } } },
        select: { cancelReason: true },
    });
    return predecessor?.cancelReason ?? null;
}

export function matchesRecordLinkOccurrence(payload: Prisma.JsonValue, schedule: RecordLinkAssignment): boolean {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    return payload["employeeId"] === schedule.primaryEmployeeId
        && (payload["scheduleId"] === undefined || payload["scheduleId"] === schedule.id)
        && (payload["scheduleIncarnationId"] === undefined || payload["scheduleIncarnationId"] === schedule.incarnationId);
}

type RecordLinkAttempt = Pick<import("domain/entities/message-trigger-job.entity").MessageTriggerJobEntity,
    "id" | "branchId" | "clientId" | "employeeScheduleId" | "claimToken" | "dedupeKey" | "recipientPhone">;

export async function fenceRecordLinkAttempt(
    tx: Prisma.TransactionClient,
    job: RecordLinkAttempt,
    now: Date,
    stage: "pending" | "processing",
    senderOnly = false,
): Promise<{ kind: "allow" } | { kind: "lost" } | { kind: "stale"; reason: string }> {
    if (!job.branchId) return { kind: "lost" };
    const where = { ...recoveryIdentity, id: job.id, branchId: job.branchId, status: stage,
        ...(stage === "processing" ? { claimToken: job.claimToken } : { scheduledFor: { lte: now },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }) };
    const row = await tx.message_trigger_job.findFirst({ where });
    if (!row || row.canceledByUser) return { kind: "lost" };

    const cancel = async (reason: string, data: Prisma.message_trigger_jobUpdateManyMutationInput = {}) => {
        const result = await tx.message_trigger_job.updateMany({
            where,
            data: { status: "canceled", canceledAt: now, cancelReason: reason, nextAttemptAt: null,
                claimToken: null, processingDeadlineAt: null, ...data },
        });
        return result.count === 1 ? { kind: "stale" as const, reason } : { kind: "lost" as const };
    };
    if (!(await hasApprovedRecordLinkSender(tx, job.branchId))) {
        return cancel(MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON);
    }
    if (senderOnly) return { kind: "allow" };
    if (!row.employeeScheduleId || !row.clientId) return cancel(RECORD_LINK_RECOVERY_REFUSED);
    const schedule = await readRecordLinkAssignment(tx, job.branchId, row.employeeScheduleId);
    if (!recordLinkAssignmentMatches(schedule, job.branchId, row.clientId, now)) {
        return cancel(SERVICE_RECORD_LINK_ENDED_REASON);
    }
    const status = recordLinkClientStatus(schedule.client, now);
    if (!row.originalJobId) {
        const reason = await findRecordLinkTerminalSibling(tx, schedule, row.id);
        if (reason) return cancel(reason);
        if (await hasRecordLinkAcceptance(tx, schedule)) return cancel(RECORD_LINK_RECOVERY_REFUSED);
    }
    if (row.originalJobId) {
        const parent = await tx.message_trigger_job.findFirst({
            where: {
                ...recoveryIdentity,
                id: row.originalJobId, branchId: job.branchId, clientId: row.clientId,
                employeeScheduleId: row.employeeScheduleId, recoveryReason: RECORD_LINK_RECOVERY_REASON,
                recoveryState: "admitted", recoveryEpoch: row.recoveryEpoch, status: "canceled",
                cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON, canceledByUser: false,
            },
            select: { scheduledFor: true, payload: true },
        });
        if (!parent || !row.recoveryEpoch || job.dedupeKey !== RECORD_LINK_RECOVERY_PREFIX + row.originalJobId
            || !matchesRecordLinkOccurrence(parent.payload, schedule)
            || !matchesRecordLinkOccurrence(row.payload, schedule)
            || job.recipientPhone !== schedule.primaryEmployee.phone
            || (await readRecordLinkEpoch(tx, job.branchId))?.getTime() !== row.recoveryEpoch.getTime()
            || !permitsRecordLinkRecovery(status)
            || await findRecordLinkTerminalSibling(tx, schedule, row.originalJobId)
            || await hasRecordLinkAcceptance(tx, schedule)) {
            return cancel(RECORD_LINK_RECOVERY_REFUSED);
        }
        const due = new Date(Math.max(parent.scheduledFor.getTime(), getServiceRecordLinkScheduledFor(schedule.startDate).getTime()));
        if (due > now) {
            await tx.message_trigger_job.updateMany({
                where,
                data: { status: "pending", scheduledFor: due, nextAttemptAt: null, claimToken: null, processingDeadlineAt: null },
            });
            return { kind: "lost" };
        }
    } else if (status === SERVICE_STATUS.PRE_BOOKING) {
        const log = await tx.message_log.findFirst({
            where: { branchId: job.branchId, triggerJobId: row.id,
                OR: [{ providerCallStartedAt: { not: null } }, { providerAcceptanceState: { not: "prepared" } }] },
            select: { id: true },
        });
        if (row.attempts > 0 || log || row.cancelReason || row.recoveryReason || !matchesRecordLinkOccurrence(row.payload, schedule)) {
            return cancel(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
        }
        return cancel(SERVICE_RECORD_LINK_PRE_BOOKING_REASON, {
            recoveryReason: RECORD_LINK_RECOVERY_REASON,
            recoveryEpoch: await readRecordLinkEpoch(tx, job.branchId),
            firstBlockedAt: now,
            recoveryState: "awaiting_transition",
        });
    }
    return { kind: "allow" };
}
