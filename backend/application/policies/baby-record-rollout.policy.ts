import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { codeOnlyProblemBody } from "application/utils/problem-bodies";

export const BABY_RECORD_ROLLOUT_PAUSED = "지점의 아기별 제공기록지 신규 처리가 중지되었습니다";

export function babyRecordRolloutKey(branchId: string): string {
    return `branch:${branchId}:baby_service_records:enabled`;
}

export async function isBabyRecordRolloutEnabled(
    db: Pick<Prisma.TransactionClient, "system_setting">,
    branchId: string,
): Promise<boolean> {
    if (!branchId) return false;
    const setting = await db.system_setting.findUnique({
        where: { key: babyRecordRolloutKey(branchId) },
        select: { value: true },
    });
    return setting?.value === "true";
}

/**
 * For writers already holding aggregate locks. SHARE locks on the setting
 * coexist across writers, and conflict with the operator's setting upsert.
 * The operator takes the branch advisory lock and writes only this setting.
 * A missing row denies admission, so a missing-row lock is unnecessary.
 */
export async function lockEnabledBabyRecordRollout(tx: Prisma.TransactionClient, branchId: string): Promise<boolean> {
    const [setting] = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT value FROM system_setting WHERE key = ${babyRecordRolloutKey(branchId)} FOR SHARE
    `;
    return setting?.value === "true";
}

export class BabyRecordRolloutPausedException extends ConflictException {
    constructor() {
        super({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), detail: BABY_RECORD_ROLLOUT_PAUSED });
    }
}

export async function requireBabyRecordRollout(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    if (!await lockEnabledBabyRecordRollout(tx, branchId)) throw new BabyRecordRolloutPausedException();
}

const BACKFILL_VOUCHER = /^A(가|통합|라)-?[1-3①②③](형)?$/;
export const BACKFILLED_SCALAR_LINK_PREFIX = "efl_v1hist__";
export const GROUP_RECORD_LINK_PREFIX = "efl_group___";

type HouseholdScope = { branchId: string; clientId: number };

/**
 * Recognize the allocation that the foundation backfill carried over from the
 * original case and its scalar schedule. Writers read this under the client
 * write lock. Retired rows still count as evidence of mixed provenance.
 */
async function readBackfilledSingleton(db: Prisma.TransactionClient, scope: HouseholdScope) {
    const client = await db.client.findFirst({
        where: { branchId: scope.branchId, id: scope.clientId, deletedAt: null },
        select: { type: true, voucherClient: true, fetalType: true, fetalConfirmation: true, serviceStatus: true },
    });
    if (!client?.voucherClient || client.fetalType !== "SINGLETON" || client.fetalConfirmation !== "CONFIRMED"
        || !BACKFILL_VOUCHER.test(client.type?.trim() ?? "") || client.serviceStatus === "terminated") return null;

    const [babies, cases, schedules, slots, owners] = await Promise.all([
        db.client_baby.findMany({ where: scope, take: 2,
            select: { id: true, active: true, ordinal: true, legacyBackfilled: true } }),
        db.service_record_case.findMany({ where: scope, take: 2, select: { id: true, babyId: true } }),
        db.employee_schedule.findMany({
            where: { ...scope, replaced: false, terminatedAt: null }, orderBy: { id: "desc" },
            select: { id: true, primaryEmployeeId: true, secondaryEmployeeId: true,
                primaryEmployee: { select: { branchId: true, deletedAt: true } },
                secondaryEmployee: { select: { branchId: true, deletedAt: true } } },
        }),
        db.service_record_team_slot.findMany({ where: scope,
            select: { id: true, scheduleId: true, slot: true, employeeId: true, active: true, legacyBackfilled: true } }),
        db.service_record_baby_assignment.findMany({ where: scope,
            select: { babyId: true, scheduleId: true, teamSlotId: true, employeeId: true,
                activeOwner: true, endedAt: true, legacyBackfilled: true, effectiveFrom: true },
            orderBy: { effectiveFrom: "asc" } }),
    ]);
    const [baby] = babies;
    const [record] = cases;
    const [current] = schedules;
    if (!baby?.active || baby.ordinal !== 1 || !baby.legacyBackfilled || babies.length !== 1
        || cases.length !== 1 || record?.babyId !== baby.id || !current
        || slots.some(slot => !slot.legacyBackfilled)
        || owners.some(owner => !owner.legacyBackfilled || owner.babyId !== baby.id)) return null;

    const liveEmployee = (employee: { branchId: string | null; deletedAt: Date | null } | null) =>
        employee?.branchId === scope.branchId && employee.deletedAt === null;
    const validSchedules = schedules.every(schedule => {
        if (!liveEmployee(schedule.primaryEmployee)) return false;
        const currentSlots = slots.filter(slot => slot.scheduleId === schedule.id && slot.active);
        const primary = currentSlots.find(slot => slot.slot === 0 && slot.employeeId === schedule.primaryEmployeeId);
        if (!primary) return false;
        if (schedule.secondaryEmployeeId === null) {
            if (currentSlots.length !== 1) return false;
        } else if (!liveEmployee(schedule.secondaryEmployee) || currentSlots.length !== 2
            || !currentSlots.some(slot => slot.slot === 1 && slot.employeeId === schedule.secondaryEmployeeId)) return false;
        const activeOwners = owners.filter(owner => owner.scheduleId === schedule.id && owner.activeOwner);
        return activeOwners.length === 1 && activeOwners[0]?.endedAt === null
            && activeOwners[0].teamSlotId === primary.id && activeOwners[0].employeeId === primary.employeeId;
    });
    const original = owners[0];
    if (!validSchedules || !original) return null;
    const originalAssignment = await db.service_record_assignment.findFirst({
        where: { branchId: scope.branchId, serviceRecordCaseId: record.id,
            scheduleId: original.scheduleId, employeeId: original.employeeId },
        select: { id: true },
    });
    return originalAssignment ? { caseId: record.id, babyId: baby.id, scheduleId: current.id,
        employeeId: current.primaryEmployeeId, backfilledAt: original.effectiveFrom } : null;
}

export async function readBackfilledLinkPolicy(db: Prisma.TransactionClient, scope: HouseholdScope) {
    const source = await readBackfilledSingleton(db, scope);
    if (!source) return null;
    // Earlier grouped sends persisted membership. An unmarked token minted
    // after the backfill can also be an earlier grouped prepare, so its
    // credential kind cannot establish scalar continuity.
    const [group, ambiguousLink] = await Promise.all([
        db.service_record_job_member.findFirst({ where: scope, select: { jobId: true } }),
        db.service_record_token.findFirst({
            where: { branchId: scope.branchId, schedule: scope, OR: [
                { linkTokenHash: { startsWith: GROUP_RECORD_LINK_PREFIX } },
                { createdAt: { gte: source.backfilledAt }, NOT: { linkTokenHash: { startsWith: BACKFILLED_SCALAR_LINK_PREFIX } } },
            ] },
            select: { id: true },
        }),
    ]);
    return { ...source, scalarAllowed: !group && !ambiguousLink };
}

export async function readBackfilledScalarHousehold(db: Prisma.TransactionClient, scope: HouseholdScope) {
    const source = await readBackfilledLinkPolicy(db, scope);
    return source?.scalarAllowed ? source : null;
}

/** Queue eligibility is only a prefilter; writers recheck under their fence. */
export function babyRecordRolloutEnabledSql(branch: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`EXISTS (
        SELECT 1 FROM system_setting rollout
        WHERE rollout.key = 'branch:' || ${branch}::text || ':baby_service_records:enabled'
          AND rollout.value = 'true'
    )`;
}
