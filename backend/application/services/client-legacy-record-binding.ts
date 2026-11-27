import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ClientAllocationPlan, ClientAllocationSnapshot } from "./client-allocation.service";
import { GROUP_RECORD_LINK_PREFIX } from "application/policies/baby-record-provenance.policy";
import { lockEformsignDocumentsForWrite } from "application/policies/service-record-write-lock.policy";
import { problemBody } from "application/utils/problem-bodies";
import { lockRecordLinkSchedule } from "infrastructure/database/repositories/record-link-recovery.repository";
import { readLegacyLinkOccurrence } from "./service-record-legacy-link-occurrence";
import { recordLinkHash, recordLinkPhone } from "./service-record-link-group-source";
import { SERVICE_RECORD_CASE_STATUS } from "./service-record-lifecycle.service";

export interface LegacyRecordBinding {
    caseId: string;
    babyOrdinal: number;
}

export interface LockedLegacyRecordBinding extends LegacyRecordBinding {
    tokenId: string;
}

const conflictDetails = {
    allocation: "기존 기록을 연결할 아기와 주 담당 인력을 다시 확인해 주세요.",
    schedule: "서비스 기간과 현재 담당 일정이 그대로인 상태에서 기존 기록을 연결해 주세요.",
    case: "이 고객의 기존 서명된 제공기록지와 담당 이력을 다시 확인해 주세요.",
    link: "기존 담당자에게 발송된 아직 유효한 기록지 링크와 등록 전화번호를 확인해 주세요.",
};

export function legacyRecordBindingConflict(reason: keyof typeof conflictDetails): never {
    throw new ConflictException(problemBody("REQUEST_CONFLICT", {
        pointer: "/legacyRecordBinding", code: "INVALID_VALUE", detail: conflictDetails[reason], location: "body",
    }));
}

type Scope = { branchId: string; clientId: number };
type Schedule = {
    id: number;
    incarnationId: string;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    startDate: Date;
    endDate: Date;
};

/** The customer write already holds the branch, client, staff, case, schedule and signed-day locks. */
export async function proveLegacyRecordBinding(
    tx: Prisma.TransactionClient,
    scope: Scope,
    input: LegacyRecordBinding,
    plan: ClientAllocationPlan,
    snapshot: ClientAllocationSnapshot,
    schedule: Schedule,
): Promise<LockedLegacyRecordBinding> {
    const caseId = input.caseId.toLowerCase();
    const { primaryEmployeeId: employeeId, id: scheduleId } = schedule;
    const selected = plan.assignments.find(({ ordinal }) => ordinal === input.babyOrdinal);
    if (plan.assignments.length < 2 || !selected || selected.providerSlot !== 0
        || plan.providers.find(({ slot }) => slot === 0)?.employeeId !== employeeId || plan.retired.length) {
        legacyRecordBindingConflict("allocation");
    }
    const owners = await tx.service_record_baby_assignment.findMany({
        where: scope, select: { babyId: true, scheduleId: true, employeeId: true, activeOwner: true, endedAt: true, version: true },
    });
    if (plan.unchanged) {
        // A retry can only acknowledge the already-bound selection. The
        // original assignment generation must still be the current one.
        if (!selected.babyId || snapshot.babies.length !== plan.assignments.length
            || owners.length !== plan.assignments.length
            || owners.some(owner => owner.scheduleId !== scheduleId || !owner.activeOwner || owner.endedAt || owner.version !== 1)
            || !owners.some(owner => owner.babyId === selected.babyId && owner.employeeId === employeeId)) {
            legacyRecordBindingConflict("allocation");
        }
    } else if (snapshot.fetalConfirmation === "CONFIRMED" || snapshot.babies.length || owners.length
        || plan.assignments.some(({ babyId }) => babyId !== null)
        || snapshot.employeeSchedules[0]?.recordTeamSlots.some(({ slot, employeeId: staffId }) =>
            (slot === 0 && staffId !== employeeId) || (slot === 1 && staffId !== schedule.secondaryEmployeeId) || slot > 1)) {
        legacyRecordBindingConflict("allocation");
    }
    const [mixedScope] = await tx.$queryRaw<Array<{ schedules: boolean; cases: boolean }>>(Prisma.sql`
        SELECT EXISTS (
            SELECT 1 FROM employee_schedule WHERE client_id = ${scope.clientId} AND id <> ${scheduleId}
              AND (branch_id IS DISTINCT FROM ${scope.branchId}::uuid OR primary_employee_id <> ${employeeId}
                   OR (NOT replaced AND terminated_at IS NULL))
        ) AS schedules, EXISTS (
            SELECT 1 FROM service_record_case WHERE client_id = ${scope.clientId}
              AND branch_id IS DISTINCT FROM ${scope.branchId}::uuid
        ) AS cases
    `);
    if (mixedScope?.schedules) legacyRecordBindingConflict("schedule");
    if (mixedScope?.cases) legacyRecordBindingConflict("case");

    const records = await tx.service_record_case.findMany({
        where: scope, select: { id: true, babyId: true, status: true, finalizedAt: true, finalizationStartedAt: true },
    });
    const record = records.find(({ id }) => id === caseId);
    if (!record || record.babyId !== selected.babyId || record.finalizedAt || record.finalizationStartedAt
        || ![SERVICE_RECORD_CASE_STATUS.IN_PROGRESS, SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE].some(status => status === record.status)
        || records.length !== (plan.unchanged ? plan.assignments.length : 1)) {
        legacyRecordBindingConflict("case");
    }
    const caseScope = { serviceRecordCaseId: caseId };
    const documents = await tx.eformsign_doc.findMany({
        where: { ...caseScope, branchId: scope.branchId }, select: { id: true },
    });
    await lockEformsignDocumentsForWrite(tx, scope.branchId, documents.map(({ id }) => id));
    const [employee, assignments, badDay, signedDay, badHeader, badDocument, foreignEvidence] = await Promise.all([
        tx.employee.findFirst({ where: { id: employeeId, branchId: scope.branchId, deletedAt: null }, select: { phone: true } }),
        tx.service_record_assignment.findMany({
            where: { ...caseScope, branchId: scope.branchId },
            select: { scheduleId: true, employeeId: true, employeePhoneSnapshot: true, startDate: true, endDate: true },
        }),
        tx.service_record_day.findFirst({
            where: { branchId: scope.branchId, OR: [{ scheduleId, serviceRecordCaseId: null }, { ...caseScope, OR: [
                { scheduleId: { not: scheduleId } }, { scheduleId: null },
                { employeeId: { not: employeeId } }, { employeeId: null }, { caseSessionIndex: null },
                { serviceDate: { lt: schedule.startDate } }, { serviceDate: { gt: schedule.endDate } },
            ] }] },
            select: { id: true },
        }),
        tx.service_record_day.findFirst({
            where: { ...caseScope, branchId: scope.branchId, locked: true, momApproval: "approved", clientSignedAt: { not: null },
                clientSignature: { not: null }, NOT: { clientSignature: "" } },
            select: { id: true },
        }),
        tx.service_record.findFirst({
            where: { branchId: scope.branchId, OR: [{ ...caseScope, scheduleId: { not: scheduleId } }, { scheduleId, serviceRecordCaseId: null }] },
            select: { id: true },
        }),
        tx.eformsign_doc.findFirst({
            where: { branchId: scope.branchId, OR: [
                { ...caseScope, employeeScheduleId: { not: scheduleId } },
                { employeeScheduleId: scheduleId, serviceRecordCaseId: null, documentKind: "service_record_snapshot" },
                { ...caseScope, clientId: { not: scope.clientId } },
            ] },
            select: { id: true },
        }),
        tx.service_record_case.findFirst({
            where: { ...scope, id: caseId, OR: [
                { assignments: { some: { branchId: { not: scope.branchId } } } },
                { days: { some: { branchId: { not: scope.branchId } } } },
                { legacyHeaders: { some: { branchId: { not: scope.branchId } } } },
                { eformsignDocs: { some: { OR: [{ branchId: null }, { branchId: { not: scope.branchId } }] } } },
            ] },
            select: { id: true },
        }),
    ]);
    const phone = recordLinkPhone(employee?.phone);
    const [assignment] = assignments;
    if (!phone || assignments.length !== 1 || !assignment || assignment.scheduleId !== scheduleId || assignment.employeeId !== employeeId
        || recordLinkPhone(assignment.employeePhoneSnapshot) !== phone
        || assignment.startDate.getTime() !== schedule.startDate.getTime() || assignment.endDate.getTime() !== schedule.endDate.getTime()) {
        legacyRecordBindingConflict("case");
    }
    if (badHeader || badDocument || badDay || !signedDay || foreignEvidence) {
        legacyRecordBindingConflict("case");
    }

    await lockRecordLinkSchedule(tx, scheduleId);
    const occurrence = await readLegacyLinkOccurrence(tx, {
        ...scope, scheduleId, incarnationId: schedule.incarnationId, employeeId, phone,
    }, true);
    if (!occurrence.acceptedCredential || occurrence.acceptedCredential.startsWith(GROUP_RECORD_LINK_PREFIX)
        || occurrence.jobs.some(job => job.canceledByUser || ["pending", "processing", "needs_setup"].includes(job.status))) {
        legacyRecordBindingConflict("link");
    }
    const tokenRows = await tx.$queryRaw<Array<{ scoped: boolean }>>(Prisma.sql`
        SELECT token.branch_id = ${scope.branchId}::uuid AND token.schedule_id = ${scheduleId}
            AND (token.service_record_case_id IS NULL OR
                (record.branch_id = ${scope.branchId}::uuid AND record.client_id = ${scope.clientId})) AS scoped
        FROM service_record_token token LEFT JOIN service_record_case record ON record.id = token.service_record_case_id
        WHERE token.schedule_id = ${scheduleId} OR token.service_record_case_id = ${caseId}::uuid
        ORDER BY token.id FOR UPDATE OF token
    `);
    if (tokenRows.some(row => !row.scoped)) legacyRecordBindingConflict("link");
    const token = await tx.service_record_token.findFirst({
        where: { branchId: scope.branchId, scheduleId, employeeId, ...caseScope, active: true, revokedAt: null,
            expectedPhoneHash: recordLinkHash(phone), linkTokenHash: occurrence.acceptedCredential, expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true },
    });
    if (!token) legacyRecordBindingConflict("link");
    if (plan.unchanged) {
        const baby = await tx.client_baby.findFirst({
            where: { ...scope, id: selected.babyId ?? "", active: true, legacyBackfilled: false, createdAt: { gt: token.createdAt } },
            select: { id: true },
        });
        if (!baby) legacyRecordBindingConflict("allocation");
    }
    return { ...input, caseId, tokenId: token.id };
}
