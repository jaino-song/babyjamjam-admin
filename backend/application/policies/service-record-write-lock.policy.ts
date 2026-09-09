import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    lockClientForScheduleWrite,
    lockEmployeesForScheduleWrite,
} from "./employee-schedule-invariants.policy";

/**
 * Shared row-lock helpers for every writer that can change a client-owned
 * service record. Callers discover the target set before entering this policy,
 * then acquire locks in this order:
 *
 *   client -> employees -> case -> schedules/assignments/days -> documents
 *
 * Every id list is de-duplicated and sorted before it reaches PostgreSQL. The
 * helpers deliberately no-op for narrow unit-test doubles that do not expose
 * `$queryRaw`; a real Prisma transaction always exposes that method.
 */
export type ServiceRecordWriteTransaction = Prisma.TransactionClient;

function sortedIds(ids: readonly (number | null | undefined)[]): number[] {
    return [...new Set(ids.filter((id): id is number => id !== null && id !== undefined))]
        .sort((left, right) => left - right);
}

function sortedStringIds(ids: readonly (string | null | undefined)[]): string[] {
    return [...new Set(ids.filter((id): id is string => Boolean(id)))]
        .sort((left, right) => left.localeCompare(right));
}

export async function lockServiceRecordCaseForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    caseId: string,
    clientId?: number,
): Promise<boolean> {
    if (typeof transaction.$queryRaw !== "function") return false;
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "service_record_case"
        WHERE "id" = ${caseId}::uuid
          AND "branch_id" = ${branchId}::uuid
          ${clientId === undefined ? Prisma.empty : Prisma.sql`AND "client_id" = ${clientId}`}
        FOR UPDATE
    `);
    return rows.length === 1;
}

export async function lockServiceRecordCaseForClientWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    clientId: number,
): Promise<string | null> {
    if (typeof transaction.$queryRaw !== "function") return null;
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "service_record_case"
        WHERE "client_id" = ${clientId}
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
    `);
    return rows[0]?.id ?? null;
}

export async function lockEmployeeSchedulesForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    scheduleIds: readonly (number | null | undefined)[],
): Promise<void> {
    if (typeof transaction.$queryRaw !== "function") return;
    const ids = sortedIds(scheduleIds);
    if (ids.length === 0) return;
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "employee_schedule"
        WHERE "branch_id" = ${branchId}::uuid
          AND "id" IN (${Prisma.join(ids)})
        ORDER BY "id" ASC
        FOR UPDATE
    `);
}

export async function lockServiceRecordAssignmentsForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    caseId: string,
    scheduleIds: readonly (number | null | undefined)[] = [],
): Promise<void> {
    if (typeof transaction.$queryRaw !== "function") return;
    const ids = sortedIds(scheduleIds);
    const scheduleFilter = ids.length > 0
        ? Prisma.sql`AND "schedule_id" IN (${Prisma.join(ids)})`
        : Prisma.empty;
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "service_record_assignment"
        WHERE "branch_id" = ${branchId}::uuid
          AND "service_record_case_id" = ${caseId}::uuid
          ${scheduleFilter}
        ORDER BY "id" ASC
        FOR UPDATE
    `);
}

export async function lockServiceRecordDaysForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    caseId: string,
    sessionIndexes: readonly (number | null | undefined)[] = [],
): Promise<void> {
    if (typeof transaction.$queryRaw !== "function") return;
    const indexes = sortedIds(sessionIndexes);
    const sessionFilter = indexes.length > 0
        ? Prisma.sql`AND "case_session_index" IN (${Prisma.join(indexes)})`
        : Prisma.empty;
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "service_record_day"
        WHERE "branch_id" = ${branchId}::uuid
          AND "service_record_case_id" = ${caseId}::uuid
          ${sessionFilter}
        ORDER BY "case_session_index" ASC NULLS LAST, "id" ASC
        FOR UPDATE
    `);
}

export async function lockEformsignDocumentsForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    documentIds: readonly (number | null | undefined)[],
): Promise<void> {
    if (typeof transaction.$queryRaw !== "function") return;
    const ids = sortedIds(documentIds);
    if (ids.length === 0) return;
    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "eformsign_doc"
        WHERE "branch_id" = ${branchId}::uuid
          AND "id" IN (${Prisma.join(ids)})
        ORDER BY "id" ASC
        FOR UPDATE
    `);
}

export async function lockEformsignDocumentByIdForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    documentId: string,
): Promise<boolean> {
    if (typeof transaction.$queryRaw !== "function") return false;
    const rows = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "eformsign_doc"
        WHERE "document_id" = ${documentId}
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
    `);
    return rows.length === 1;
}

/**
 * Lock a schedule-change request after its client-owned rows have been
 * serialized. Requests are mutable workflow state, so every approve/reject
 * writer must reread the row after this lock before deciding its transition.
 */
export async function lockScheduleChangeRequestForWrite(
    transaction: ServiceRecordWriteTransaction,
    branchId: string,
    requestId: string,
): Promise<boolean> {
    if (typeof transaction.$queryRaw !== "function") return false;
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "schedule_change_request"
        WHERE "id" = ${requestId}::uuid
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
    `);
    return rows.length === 1;
}

export type ServiceRecordWriteLockSet = {
    branchId: string;
    clientId: number;
    caseId?: string | null;
    scheduleIds?: readonly (number | null | undefined)[];
    /**
     * Optional snapshot of the complete client schedule target set captured
     * before waiting for the client row. When supplied, a changed set is a
     * controlled write conflict after the post-client-lock reread.
     */
    expectedScheduleIds?: readonly (number | null | undefined)[];
    employeeIds?: readonly (number | null | undefined)[];
    sessionIndexes?: readonly (number | null | undefined)[];
    documentIds?: readonly (number | null | undefined)[];
};

/**
 * Acquire the complete lock set shared by schedule, entry, and mirror writers.
 * The schedule reread happens after the client lock and contributes any newly
 * discovered schedule/employee ids to the deterministic union. Callers should
 * use the returned ids for their ownership/target-set revalidation before the
 * first write.
 */
export async function lockServiceRecordWriteSet(
    transaction: ServiceRecordWriteTransaction,
    params: ServiceRecordWriteLockSet,
): Promise<{ scheduleIds: number[]; employeeIds: number[] }> {
    const clientLocked = await lockClientForScheduleWrite(
        transaction,
        params.branchId,
        params.clientId,
    );
    if (typeof transaction.$queryRaw === "function" && !clientLocked) {
        throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
    }

    // Resolve the case only after the owning client row is locked. A case can
    // be created or rebound by a concurrent writer while the initial discovery
    // read is in flight; taking the client lock first makes this reread the
    // linearization point and prevents a later case lock from inverting the
    // client -> employee -> case order.
    let effectiveCaseId = params.caseId ?? null;
    const caseDelegate = transaction.service_record_case as unknown as {
        findUnique?: (args: unknown) => Promise<{ id?: string; branchId?: string; clientId?: number } | null>;
    } | undefined;
    if (typeof caseDelegate?.findUnique === "function") {
        const discoveredCase = await caseDelegate.findUnique({
            where: { clientId: params.clientId },
            select: { id: true, branchId: true, clientId: true },
        });
        if (
            discoveredCase
            && (discoveredCase.branchId !== undefined && discoveredCase.branchId !== params.branchId
                || discoveredCase.clientId !== undefined && discoveredCase.clientId !== params.clientId)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
        }
        if (params.caseId !== undefined && params.caseId !== null) {
            if (!discoveredCase || discoveredCase.id !== params.caseId) {
                throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
            }
        } else {
            effectiveCaseId = discoveredCase?.id ?? null;
        }
    }

    const discoveredSchedules = transaction.employee_schedule?.findMany
        ? await transaction.employee_schedule.findMany({
            where: { branchId: params.branchId, clientId: params.clientId },
            select: {
                id: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
            },
            orderBy: { id: "asc" },
        })
        : [];
    if (params.expectedScheduleIds !== undefined) {
        const expectedScheduleIds = sortedIds(params.expectedScheduleIds);
        const rereadScheduleIds = sortedIds(discoveredSchedules.map((schedule) => schedule.id));
        if (
            expectedScheduleIds.length !== rereadScheduleIds.length
            || expectedScheduleIds.some((id, index) => id !== rereadScheduleIds[index])
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
        }
    }
    const scheduleIds = sortedIds([
        ...(params.scheduleIds ?? []),
        ...discoveredSchedules.map((schedule) => schedule.id),
    ]);
    const employeeIds = sortedIds([
        ...(params.employeeIds ?? []),
        ...discoveredSchedules.flatMap((schedule) => [
            schedule.primaryEmployeeId,
            schedule.secondaryEmployeeId,
        ]),
    ]);

    await lockEmployeesForScheduleWrite(transaction, params.branchId, employeeIds);
    if (effectiveCaseId) {
        const caseLocked = await lockServiceRecordCaseForWrite(
            transaction,
            params.branchId,
            effectiveCaseId,
            params.clientId,
        );
        if (typeof transaction.$queryRaw === "function" && !caseLocked) {
            throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
        }
    }
    await lockEmployeeSchedulesForWrite(transaction, params.branchId, scheduleIds);
    if (effectiveCaseId) {
        await lockServiceRecordAssignmentsForWrite(
            transaction,
            params.branchId,
            effectiveCaseId,
            scheduleIds,
        );
        await lockServiceRecordDaysForWrite(
            transaction,
            params.branchId,
            effectiveCaseId,
            params.sessionIndexes,
        );
    }
    await lockEformsignDocumentsForWrite(
        transaction,
        params.branchId,
        params.documentIds ?? [],
    );
    return { scheduleIds, employeeIds };
}

/** Return deterministic employee ids for a schedule snapshot. */
export function employeeIdsForSchedule(schedule: {
    primaryEmployeeId?: number | null;
    secondaryEmployeeId?: number | null;
} | null | undefined): number[] {
    return sortedIds([schedule?.primaryEmployeeId, schedule?.secondaryEmployeeId]);
}

/** Return deterministic schedule ids while tolerating omitted relation rows. */
export function scheduleIdsForWrite(
    schedules: readonly { id?: number | null }[],
): number[] {
    return sortedIds(schedules.map((schedule) => schedule.id));
}

/** Return deterministic string identifiers for generation/CAS diagnostics. */
export function stringIdsForWrite(ids: readonly (string | null | undefined)[]): string[] {
    return sortedStringIds(ids);
}
