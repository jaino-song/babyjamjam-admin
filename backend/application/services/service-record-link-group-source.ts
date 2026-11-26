import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { BACKFILLED_SCALAR_LINK_PREFIX, GROUP_RECORD_LINK_PREFIX, readBackfilledLinkPolicy } from "application/policies/baby-record-provenance.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordServiceEndedAt,
    isServiceRecordLinkManualDedupeKey,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
} from "domain/constants/service-record-link-message";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";

import { readLegacyLinkOccurrence } from "./service-record-legacy-link-occurrence";

export { RECORD_LINK_GROUP_LOG_MARKER } from "./service-record-legacy-link-occurrence";
export const RECORD_LINK_GROUP_CHANGED = "제공기록지 링크의 담당자 또는 발송 대상이 변경되었습니다";
export const RECORD_LINK_GROUP_KEY_PREFIX = `${SERVICE_RECORD_LINK_RULE_ID}:group:`;

export const recordLinkGroupSupersededReasons = [SERVICE_RECORD_LINK_RESCHEDULED_REASON, RECORD_LINK_GROUP_CHANGED];
export const recordLinkGroupCarrierEvidence: Prisma.message_logWhereInput = {
    OR: [
        { providerCallStartedAt: { not: null } }, { providerAcceptedAt: { not: null } },
        { aligoMid: { not: null } }, { providerAcceptanceState: { not: "prepared" } },
    ],
};

export interface RecordLinkGroupMember {
    caseId: string;
    babyId: string;
    employeeId: number;
    assignmentVersion: number;
    activeRank: number;
    endDate: Date | null;
    employee: { name: string; phone: string; smsAutomationEnabled: boolean };
}

type GroupJob = Pick<MessageTriggerJobEntity, "id" | "ruleId" | "dedupeKey" | "payload" | "branchId"
    | "clientId" | "employeeScheduleId" | "recipientPhone"> & { templateKey: string };

export function isRecordLinkGroup(job: { dedupeKey: string; payload?: unknown; recipientEmployeeId?: number | null }): boolean {
    return job.dedupeKey.startsWith(RECORD_LINK_GROUP_KEY_PREFIX) || job.recipientEmployeeId != null
        || (!!job.payload && typeof job.payload === "object" && Object.prototype.hasOwnProperty.call(job.payload, "recordLinkGroup"));
}

function hasTaskAuthorityMarker(payload: object): boolean {
    return ["taskAutomationReference", "agentAutomationSeal", "agentAutomationRecord"]
        .some(key => Object.prototype.hasOwnProperty.call(payload, key));
}

export function isAutomaticRecordLinkGroup(job: GroupJob): boolean {
    return job.ruleId === SERVICE_RECORD_LINK_RULE_ID && job.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK
        && job.dedupeKey.startsWith(RECORD_LINK_GROUP_KEY_PREFIX) && !isServiceRecordLinkManualDedupeKey(job.dedupeKey)
        && !job.payload.sentByUserId && job.payload.templateVariables?.["triggerType"] !== "agent_scheduled"
        && !hasTaskAuthorityMarker(job.payload);
}

export function recordLinkHash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function recordLinkPhone(phone: string | null | undefined): string | null {
    const digits = phone?.replace(/\D/g, "");
    return digits && /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}

export async function readRecordLinkGroupSource(
    tx: Prisma.TransactionClient, branchId: string, scheduleId: number, lock = false,
) {
    const where = { id: scheduleId, branchId, client: { branchId, deletedAt: null } };
    const anchor = await tx.employee_schedule.findFirst({ where, select: { clientId: true } });
    if (!anchor) return null;
    const scope = { branchId, clientId: anchor.clientId };
    if (lock) await lockServiceRecordWriteSet(tx, { ...scope, scheduleIds: [scheduleId] });
    const schedule = await tx.employee_schedule.findFirst({
        where: { ...where, clientId: anchor.clientId, replaced: false, terminatedAt: null },
        include: { client: true },
    });
    if (!schedule) return null;
    const current = await tx.employee_schedule.findFirst({
        where: { ...scope, replaced: false, terminatedAt: null },
        select: { id: true },
        orderBy: { id: "desc" },
    });
    if (current?.id !== scheduleId) return null;

    const babies = await tx.client_baby.findMany({
        where: { ...scope, active: true }, orderBy: [{ ordinal: "asc" }, { id: "asc" }], select: { id: true },
    });
    const cases = await tx.service_record_case.findMany({
        where: { ...scope, babyId: { in: babies.map(({ id }) => id) }, finalizedAt: null },
        select: { id: true, babyId: true, endDate: true },
    });
    const assignments = await tx.service_record_baby_assignment.findMany({
        where: {
            ...scope, scheduleId, activeOwner: true, endedAt: null, teamSlot: { active: true },
            employee: { branchId, deletedAt: null },
        },
        select: { babyId: true, employeeId: true, version: true, employee: { select: { name: true, phone: true, smsAutomationEnabled: true } } },
    });
    const byBaby = new Map(assignments.map(row => [row.babyId, row]));
    const caseByBaby = new Map(cases.map(row => [row.babyId, row]));
    const members: RecordLinkGroupMember[] = babies.flatMap(({ id }, index) => {
        const record = caseByBaby.get(id);
        const owner = byBaby.get(id);
        return record && owner ? [{
            caseId: record.id, babyId: id, employeeId: owner.employeeId, assignmentVersion: owner.version,
            activeRank: index + 1, endDate: record.endDate, employee: owner.employee,
        }] : [];
    });
    return { schedule, scope, householdBabyCount: babies.length, members };
}

export type RecordLinkGroupSource = NonNullable<Awaited<ReturnType<typeof readRecordLinkGroupSource>>>;

export async function canHandOverAcceptedLegacyLink(
    tx: Prisma.TransactionClient, source: RecordLinkGroupSource, members: readonly RecordLinkGroupMember[],
    acceptedCredential: string | null, { requireRetired = false } = {},
): Promise<boolean> {
    const [member] = members;
    if (!acceptedCredential || !member || members.length !== 1 || source.householdBabyCount !== 1) return false;

    // Group preparation itself ends scalar issuance. The backfilled allocation
    // still proves the provenance of the original URL after prepare or reset.
    const historical = await readBackfilledLinkPolicy(tx, source.scope);
    if (!historical || historical.caseId !== member.caseId || historical.babyId !== member.babyId
        || historical.scheduleId !== source.schedule.id || historical.employeeId !== member.employeeId) return false;

    const phone = recordLinkPhone(member.employee.phone);
    if (!phone) return false;
    const tokens = await tx.service_record_token.findMany({
        where: {
            branchId: source.scope.branchId, scheduleId: source.schedule.id, employeeId: member.employeeId,
            NOT: { linkTokenHash: { startsWith: GROUP_RECORD_LINK_PREFIX } },
            AND: [
                { OR: [{ serviceRecordCaseId: member.caseId }, { serviceRecordCaseId: null }] },
                { OR: [{ linkTokenHash: acceptedCredential }, { revokedAt: null }, { active: true }] },
            ],
        },
        select: { linkTokenHash: true, expectedPhoneHash: true, createdAt: true, active: true, revokedAt: true },
    });
    const [token] = tokens;
    return tokens.length === 1 && token?.linkTokenHash === acceptedCredential && token.expectedPhoneHash === recordLinkHash(phone)
        && (token.createdAt < historical.backfilledAt || token.linkTokenHash.startsWith(BACKFILLED_SCALAR_LINK_PREFIX))
        && (token.active ? !requireRetired && token.revokedAt === null : token.revokedAt !== null);
}

export function canSendRecordLinkGroup(source: RecordLinkGroupSource, manual: boolean, now = new Date()): boolean {
    const { client, endDate } = source.schedule;
    const status = getEffectiveClientServiceStatus(client.serviceStatus, client.startDate, client.endDate, client.bookingConfirmedAt, now);
    return client.fetalConfirmation === "CONFIRMED" && status !== "pre_booking"
        && client.serviceStatus !== "terminated"
        && (manual || (client.serviceStatus !== "completed" && getServiceRecordServiceEndedAt(endDate) > now));
}

const dateForMessage = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

export function recordLinkGroupVariables(source: RecordLinkGroupSource, member: RecordLinkGroupMember): Record<string, string> {
    return {
        name: member.employee.name,
        employeeName: member.employee.name,
        clientName: source.schedule.client.name,
        serviceStartDate: dateForMessage.format(source.schedule.startDate),
        serviceEndDate: dateForMessage.format(source.schedule.endDate),
    };
}

export function recordLinkGroupSourceHash(source: RecordLinkGroupSource, members: readonly RecordLinkGroupMember[]): string {
    return recordLinkHash(JSON.stringify({
        ...source.scope,
        scheduleId: source.schedule.id,
        incarnation: source.schedule.incarnationId,
        start: source.schedule.startDate,
        end: source.schedule.endDate,
        clientName: source.schedule.client.name,
        employeeId: members[0]?.employeeId,
        employeeName: members[0]?.employee.name,
        recipientPhone: recordLinkPhone(members[0]?.employee.phone),
        householdBabyCount: source.householdBabyCount,
        members: members.map(({ caseId, babyId, activeRank, assignmentVersion, endDate }) => ({
            caseId, babyId, activeRank, assignmentVersion, endDate,
        })),
    }));
}

function memberKey(caseId: string, version: number): string {
    return `${caseId}:${version}`;
}

export async function unreservedRecordLinkMembers(
    tx: Prisma.TransactionClient, source: RecordLinkGroupSource, members: RecordLinkGroupMember[], excludedJobId?: string,
): Promise<RecordLinkGroupMember[]> {
    const employeeId = members[0]?.employeeId;
    if (!employeeId) return [];
    const history = await tx.message_trigger_job.findMany({
        where: {
            ...source.scope, employeeScheduleId: source.schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID,
            recipientEmployeeId: employeeId, ...(excludedJobId ? { id: { not: excludedJobId } } : {}),
            OR: [
                { status: { in: ["sent", "dispatching"] } },
                { status: { in: ["pending", "processing"] }, dedupeKey: { contains: ":manual:" } },
                { canceledByUser: true },
                { status: "canceled", cancelReason: { notIn: recordLinkGroupSupersededReasons } },
                { logs: { some: recordLinkGroupCarrierEvidence } },
            ],
        },
        select: { status: true, payload: true, canceledByUser: true,
            logs: { where: recordLinkGroupCarrierEvidence, take: 1, select: { id: true } },
            recordMembers: { select: { serviceRecordCaseId: true, assignmentVersion: true } } },
    });
    const covered = new Set(history.flatMap(job => {
        const keys = job.recordMembers.map(member => memberKey(member.serviceRecordCaseId, member.assignmentVersion));
        if (!job.canceledByUser && !job.logs.length && (job.status === "pending" || job.status === "processing")) {
            const selected = members.filter(member => keys.includes(memberKey(member.caseId, member.assignmentVersion)));
            const payload = job.payload as unknown as MessageTriggerJobEntity["payload"];
            if (selected.length !== keys.length || recordLinkGroupSourceHash(source, selected) !== payload.recordLinkGroup?.sourceHash) return [];
        }
        return keys;
    }));
    return members.filter(member => !covered.has(memberKey(member.caseId, member.assignmentVersion)));
}

/** Reconstruct the selected assignment and credentials from durable rows. */
export async function resolveRecordLinkGroup(tx: Prisma.TransactionClient, job: GroupJob, lock = false) {
    const group = job.payload.recordLinkGroup;
    if (job.ruleId !== SERVICE_RECORD_LINK_RULE_ID || job.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK
        || !job.branchId || job.employeeScheduleId === null || job.clientId === null || group?.version !== 1
        || !Array.isArray(group.members) || !group.members.length
        || job.payload.templateVariables?.["triggerType"] === "agent_scheduled"
        || hasTaskAuthorityMarker(job.payload)) return null;

    const manual = isServiceRecordLinkManualDedupeKey(job.dedupeKey);
    if (manual && (!job.payload.sentByUserId || !group.previewHash)) return null;
    if (!manual && !job.dedupeKey.startsWith(RECORD_LINK_GROUP_KEY_PREFIX)) return null;
    const source = await readRecordLinkGroupSource(tx, job.branchId, job.employeeScheduleId, lock);
    if (!source || source.scope.clientId !== job.clientId || !canSendRecordLinkGroup(source, manual)) return null;

    const row = await tx.message_trigger_job.findFirst({
        where: {
            id: job.id, branchId: job.branchId, clientId: job.clientId, employeeScheduleId: job.employeeScheduleId,
            ruleId: job.ruleId, dedupeKey: job.dedupeKey, canceledByUser: false,
        },
        select: { recipientEmployeeId: true, recipientPhone: true, recordMembers: true, payload: true },
    });
    if (!row?.recipientEmployeeId || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)
        || hasTaskAuthorityMarker(row.payload)
        || row.recipientEmployeeId !== job.payload.employeeId || row.recipientPhone !== job.recipientPhone
        || row.recordMembers.length !== group.members.length) return null;

    const owned = source.members.filter(member => member.employeeId === row.recipientEmployeeId);
    const members = owned.filter(member => row.recordMembers.some(item => item.serviceRecordCaseId === member.caseId
        && item.babyId === member.babyId && item.assignmentVersion === member.assignmentVersion));
    const employee = members[0]?.employee;
    const phone = recordLinkPhone(employee?.phone);
    if (!employee || !phone || phone !== job.recipientPhone || phone !== job.payload.recipientPhone
        || (!manual && !employee.smsAutomationEnabled)
        || members.length !== row.recordMembers.length || recordLinkGroupSourceHash(source, members) !== group.sourceHash) return null;

    const legacy = await readLegacyLinkOccurrence(tx, { ...source.scope, scheduleId: source.schedule.id,
        incarnationId: source.schedule.incarnationId, employeeId: row.recipientEmployeeId, phone });
    if (legacy.blocked && (!manual || !await canHandOverAcceptedLegacyLink(
        tx, source, members, legacy.acceptedCredential, { requireRetired: true },
    ))) return null;

    if (!manual) {
        const unreserved = await unreservedRecordLinkMembers(tx, source, owned, job.id);
        if (unreserved.length !== members.length || unreserved.some((member, index) => member.caseId !== members[index]?.caseId)) return null;
    }

    const proofs = new Map(group.members.map(member => [member?.caseId, member?.tokenId]));
    if (proofs.size !== members.length || members.some(member => !proofs.get(member.caseId))) return null;
    // IDs in the proof are generated by the issuer. Validate before a UUID query.
    const ids = [...proofs.values()];
    if (ids.some(id => typeof id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))) return null;
    const tokens = await tx.service_record_token.findMany({
        where: {
            id: { in: ids }, branchId: job.branchId, scheduleId: job.employeeScheduleId,
            employeeId: row.recipientEmployeeId, expectedPhoneHash: recordLinkHash(phone),
            active: true, revokedAt: null, lockedAt: null, expiresAt: { gt: new Date() },
        },
        select: { id: true, serviceRecordCaseId: true, linkTokenHash: true },
    });
    const links = members.flatMap(member => {
        const token = tokens.find(token => token.id === proofs.get(member.caseId)
            && (token.serviceRecordCaseId === member.caseId || (token.serviceRecordCaseId === null && source.householdBabyCount === 1)));
        return token ? [{ activeRank: member.activeRank, linkToken: token.linkTokenHash }] : [];
    });
    if (links.length !== members.length) return null;
    return { employeeId: row.recipientEmployeeId, links, householdBabyCount: source.householdBabyCount, variables: recordLinkGroupVariables(source, members[0]!) };
}
