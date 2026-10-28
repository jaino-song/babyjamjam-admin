import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
    getExpectedSessionDateFromRecords,
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";

import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { assignmentWrites } from "application/services/admin-service-record-edit.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "application/services/message-automation-intent-writer";
import { SERVICE_RECORD_CASE_STATUS } from "application/services/service-record-lifecycle.service";
import { assertNoActiveEmployeeScheduleOverlap } from "application/policies/employee-schedule-invariants.policy";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { ServiceRecordEditConflictError } from "domain/errors/service-record-edit.error";
import type { ServiceRecordEditSourceAssignment } from "domain/repositories/service-record-edit.repository.interface";
import { isoDateInKorea, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";

/** The extension code a screen reads to send the admin to "제공기록지 일정 변경". */
export const REALIGNMENT_REQUIRES_MANUAL_SCHEDULE = "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" as const;

const MANUAL_SCHEDULE_DETAIL =
    "남은 회차의 날짜를 자동으로 옮길 수 없어요. 제공기록지 일정 변경에서 날짜를 직접 지정해 주세요.";

/**
 * Cases the lifecycle treats as terminal for date work: a finalization claim
 * froze the source, and the two review states need an admin decision first.
 */
const CLOSED_CASE_STATUSES = new Set<string>([
    SERVICE_RECORD_CASE_STATUS.FINALIZING,
    SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
    SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
    SERVICE_RECORD_CASE_STATUS.COMPLETED,
    SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED,
    SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED,
]);

export interface ServiceRecordRealignmentParams {
    branchId: string;
    clientId: number;
    /** The plain branch calendar; the client's own flags are applied in here from the locked row. */
    calendar: KrBusinessDayCalendar;
    /** Frozen clock for tests; defaults to the current instant. */
    now?: Date;
    /**
     * The same client update also supplied `endDate`. A legacy case keeps the caller's
     * end date (nothing is re-derived). A case with a planned vector does not: the
     * re-laid vector's last date is authoritative for the client, the case and the token.
     */
    callerSuppliedEndDate?: boolean;
}

export interface ServiceRecordRealignmentResult {
    changed: boolean;
    mode: "none" | "planned" | "legacy";
    /** The new last service date when the case was re-laid. */
    endDate: string | null;
    /**
     * Legacy only: the session count the case owes. The lifecycle sync that runs
     * next can re-cap it; the caller restores this value if it did.
     */
    restoreRequiredSessionCount: number | null;
}

const NOT_CHANGED: ServiceRecordRealignmentResult = Object.freeze({
    changed: false,
    mode: "none",
    endDate: null,
    restoreRequiredSessionCount: null,
});

function manualScheduleConflict(): ConflictException {
    return new ConflictException({
        ...problemBody("REQUEST_CONFLICT", {
            pointer: "",
            code: "INVALID_VALUE",
            detail: MANUAL_SCHEDULE_DETAIL,
            location: "body",
        }),
        scheduleCode: REALIGNMENT_REQUIRES_MANUAL_SCHEDULE,
    });
}

function isoDate(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function toDbDate(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

function nextCalendarDay(iso: string): string {
    const date = toDbDate(iso);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

/** Parse only a complete authoritative vector; null when the stored one cannot be trusted. */
function parsePlannedVector(
    raw: Prisma.JsonValue,
    requiredSessionCount: number | null,
    calendar: KrBusinessDayCalendar,
): ServiceRecordPlannedSession[] | null {
    const values = Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null
            ? ((raw as Record<string, Prisma.JsonValue>)["sessions"]
                ?? (raw as Record<string, Prisma.JsonValue>)["entries"]
                ?? (raw as Record<string, Prisma.JsonValue>)["plannedSessions"])
            : null;
    if (!Array.isArray(values)) return null;

    const entries: ServiceRecordPlannedSession[] = [];
    for (const value of values) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        const row = value as Record<string, Prisma.JsonValue>;
        const provenance = typeof row["provenance"] === "object" && row["provenance"] !== null && !Array.isArray(row["provenance"])
            ? row["provenance"] as Record<string, Prisma.JsonValue>
            : null;
        const sessionIndex = row["sessionIndex"];
        const serviceDate = row["serviceDate"];
        const originalDate = row["originalDate"];
        const assignmentId = row["assignmentId"];
        const scheduleId = row["scheduleId"] ?? provenance?.["scheduleId"];
        const employeeId = row["employeeId"] ?? provenance?.["employeeId"];
        const provenanceVersion = row["provenanceVersion"] ?? provenance?.["version"] ?? row["version"];
        if (
            typeof sessionIndex !== "number"
            || !Number.isInteger(sessionIndex)
            || typeof serviceDate !== "string"
            || typeof originalDate !== "string"
            || typeof assignmentId !== "string"
            || typeof scheduleId !== "number"
            || !Number.isInteger(scheduleId)
            || typeof employeeId !== "number"
            || !Number.isInteger(employeeId)
            || (typeof provenanceVersion !== "string" && typeof provenanceVersion !== "number")
        ) {
            return null;
        }
        entries.push({
            sessionIndex,
            serviceDate,
            originalDate,
            assignmentId,
            scheduleId,
            employeeId,
            provenanceVersion: String(provenanceVersion),
        });
    }

    try {
        return validateServiceRecordScheduleVector(entries, requiredSessionCount ?? undefined, calendar, { persisted: true });
    } catch {
        return null;
    }
}

interface ScheduleRow {
    id: number;
    branchId: string | null;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    terminatedAt: Date | null;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    primaryEmployee: { name: string };
    serviceRecordAssignment: {
        id: string;
        branchId: string;
        serviceRecordCaseId: string;
        scheduleId: number | null;
        employeeId: number | null;
        startDate: Date;
        endDate: Date;
        employeeNameSnapshot: string;
    } | null;
}

/**
 * Re-lays a client's remaining service-record sessions when its Saturday /
 * Sunday / holiday service-day flags change. Sessions already written (locked,
 * submitted, or dated before today) stay as they are; everything after the last
 * of them moves onto the next service days under the client's NEW flags.
 *
 * Runs inside the caller's transaction, after the flag write. The caller owns
 * the client -> employees -> case -> schedules/assignments/days lock order
 * (`lockServiceRecordWriteSet`); nothing here takes a lock of its own.
 *
 * Like the existing schedule-change flow it writes no revision or history entry.
 * An open admin-edit draft turns stale through its source fingerprint.
 */
@Injectable()
export class ServiceRecordScheduleRealignmentService {
    constructor(
        @Optional() private readonly agentAutomationRecordStore?: AgentAutomationRecordStoreService,
    ) {}

    /**
     * A new schedule has no assignment row until the lifecycle sync runs, so a
     * flag change that arrives together with an assignment change cannot be
     * re-laid. Refuse that combination for a case that carries a planned vector.
     */
    async assertCanCombineWithAssignmentChange(
        tx: Prisma.TransactionClient,
        params: { branchId: string; clientId: number },
    ): Promise<void> {
        if (typeof tx.service_record_case?.findUnique !== "function") return;
        const record = await tx.service_record_case.findUnique({
            where: { clientId: params.clientId },
            select: { branchId: true, status: true, plannedSessions: true },
        });
        if (!record || record.branchId !== params.branchId || CLOSED_CASE_STATUSES.has(record.status)) return;
        if (record.plannedSessions === null || record.plannedSessions === undefined) return;
        throw manualScheduleConflict();
    }

    async realignForServiceDayChangeInTransaction(
        tx: Prisma.TransactionClient,
        params: ServiceRecordRealignmentParams,
    ): Promise<ServiceRecordRealignmentResult> {
        const { branchId, clientId } = params;
        const now = params.now ?? new Date();

        const client = await tx.client.findUnique({
            where: { id: clientId },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                allowSaturdayService: true,
                allowSundayService: true,
                allowHolidayService: true,
            },
        });
        if (!client || (client.branchId !== null && client.branchId !== branchId)) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }

        const record = await tx.service_record_case.findUnique({ where: { clientId } });
        if (!record) return NOT_CHANGED;
        if (record.branchId !== branchId) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        if (CLOSED_CASE_STATUSES.has(record.status)) return NOT_CHANGED;

        // The client's NEW flags, read from the locked row after the flag write.
        const calendar = withClientServiceDays(params.calendar, client);
        const days = await tx.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id, branchId },
            orderBy: { caseSessionIndex: "asc" },
        });

        if (record.plannedSessions !== null && record.plannedSessions !== undefined) {
            return this.realignPlanned(tx, { params, now, client, record, days, calendar });
        }
        return this.realignLegacy(tx, { params, now, client, record, days, calendar });
    }

    private async realignPlanned(
        tx: Prisma.TransactionClient,
        ctx: {
            params: ServiceRecordRealignmentParams;
            now: Date;
            client: { startDate: Date | null; endDate: Date | null };
            record: Prisma.service_record_caseGetPayload<Prisma.service_record_caseDefaultArgs>;
            days: Prisma.service_record_dayGetPayload<Prisma.service_record_dayDefaultArgs>[];
            calendar: KrBusinessDayCalendar;
        },
    ): Promise<ServiceRecordRealignmentResult> {
        const { params, now, client, record, days, calendar } = ctx;
        const { branchId, clientId } = params;

        const vector = parsePlannedVector(record.plannedSessions as Prisma.JsonValue, record.requiredSessionCount, calendar);
        if (!vector) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE"));
        }
        const total = vector.length;
        const today = isoDateInKorea(now);

        const rowByIndex = new Map<number, (typeof days)[number]>();
        for (const day of days) rowByIndex.set(day.caseSessionIndex ?? day.sessionIndex, day);

        // Fixed: written (locked / submitted) or already past. The highest fixed
        // index splits the vector; out-of-order gaps before it are left alone.
        let lastFixed = 0;
        for (const entry of vector) {
            const row = rowByIndex.get(entry.sessionIndex);
            if (row?.locked || row?.submittedAt || entry.serviceDate < today) {
                lastFixed = Math.max(lastFixed, entry.sessionIndex);
            }
        }
        if (lastFixed >= total) {
            return this.reconcilePlannedPeriod(tx, { branchId, clientId, client, record, endDate: vector[total - 1]!.serviceDate });
        }

        // The effective period is the client's as written in this transaction; the case
        // still holds the previous start when the same update moved it.
        const caseStart = isoDate(client.startDate) ?? isoDate(record.startDate);
        const afterFixed = lastFixed > 0
            ? nextCalendarDay(vector[lastFixed - 1]!.serviceDate)
            : caseStart ?? today;
        const lowerBound = afterFixed > today ? afterFixed : today;
        let cursor = calendar.isBusinessDay(lowerBound) ? lowerBound : calendar.nextBusinessDay(lowerBound);

        const relaid: ServiceRecordPlannedSession[] = vector.map((entry) => {
            if (entry.sessionIndex <= lastFixed) return { ...entry };
            const serviceDate = cursor;
            cursor = calendar.nextBusinessDay(cursor);
            // originalDate stays: it records the first projection and never changes on a move.
            return { ...entry, serviceDate };
        });

        let entries: ServiceRecordPlannedSession[];
        try {
            entries = validateServiceRecordScheduleVector(relaid, total, calendar, { persisted: true });
        } catch {
            throw manualScheduleConflict();
        }
        const movedIndexes = entries
            .filter((entry) => entry.serviceDate !== vector[entry.sessionIndex - 1]!.serviceDate)
            .map((entry) => entry.sessionIndex);
        const endDate = entries[entries.length - 1]!.serviceDate;
        // Nothing moved, but the vector's last date is still the authority for the period:
        // the same update may have supplied a different end date.
        if (movedIndexes.length === 0) {
            return this.reconcilePlannedPeriod(tx, { branchId, clientId, client, record, endDate });
        }
        const schedules = await this.loadSchedules(tx, branchId, clientId);
        const storedAssignments = this.sourceAssignments(schedules);
        const ownerAssignmentIds = new Set(entries.map((entry) => entry.assignmentId));

        // Same rule the admin edit confirm uses: the outer edges follow the first and last planned dates.
        let writes: ReturnType<typeof assignmentWrites>;
        try {
            writes = assignmentWrites({ assignments: storedAssignments }, entries[0]!.serviceDate, endDate, ownerAssignmentIds);
        } catch (error) {
            if (error instanceof ServiceRecordEditConflictError) throw manualScheduleConflict();
            throw error;
        }
        this.assertNoCrossedHandover(vector, entries, movedIndexes, storedAssignments, writes);

        const changedWrites = writes.filter((write) => write.datesChanged !== false);
        for (const write of changedWrites) {
            const schedule = schedules.find((candidate) => candidate.id === write.scheduleId);
            if (!schedule || schedule.replaced || schedule.terminatedAt) continue;
            if (write.endDate <= isoDate(schedule.endDate)!) continue;
            await this.assertNoOverlap(tx, branchId, clientId, schedule, write.startDate, write.endDate);
        }

        for (const write of changedWrites) {
            if (write.scheduleId === null) continue;
            await this.agentAutomationRecordStore?.appendScheduleWriteFence(tx, {
                branchId,
                clientId,
                mutationId: randomUUID(),
                scheduleIds: [write.scheduleId],
            });
        }

        const endDateValue = toDbDate(endDate);
        await tx.service_record_case.update({
            where: { id: record.id, branchId },
            data: {
                plannedSessions: entries as unknown as Prisma.InputJsonValue,
                endDate: endDateValue,
                version: { increment: 1 },
            },
        });
        // The re-laid vector is authoritative over an end date the same update supplied: the
        // client forms send a recomputed end date with every toggle change, and the case,
        // client and token must end on the date the sessions really end.
        if (isoDate(client.endDate) !== endDate) {
            await tx.client.updateMany({
                where: { id: clientId, branchId },
                data: { endDate: endDateValue },
            });
        }
        // Only unwritten rows move; a locked or submitted row is by definition at or before the split.
        for (const sessionIndex of movedIndexes) {
            const row = rowByIndex.get(sessionIndex);
            if (!row || row.locked || row.submittedAt) continue;
            await tx.service_record_day.updateMany({
                where: { id: row.id, branchId, serviceRecordCaseId: record.id, locked: false },
                data: { serviceDate: toDbDate(entries[sessionIndex - 1]!.serviceDate) },
            });
        }
        for (const write of changedWrites) {
            if (write.assignmentId) {
                await tx.service_record_assignment.updateMany({
                    where: { id: write.assignmentId, branchId, serviceRecordCaseId: record.id },
                    data: { startDate: toDbDate(write.startDate), endDate: toDbDate(write.endDate) },
                });
            }
            if (write.scheduleId !== null) {
                await tx.employee_schedule.updateMany({
                    where: { id: write.scheduleId, branchId },
                    data: { startDate: toDbDate(write.startDate), endDate: toDbDate(write.endDate) },
                });
            }
        }
        await this.refreshTokenExpiry(tx, branchId, record.id, endDateValue);
        await this.persistReevaluationIntents(tx, {
            branchId,
            clientId,
            scheduleIds: writes.map((write) => write.scheduleId),
            intentAt: now,
        });

        return { changed: true, mode: "planned", endDate, restoreRequiredSessionCount: null };
    }

    /**
     * No session moves, yet the planned vector's last date is still authoritative for the
     * client, case and token periods (a form-style end date sent with the toggle change may
     * differ). Writes only what differs; assignment, schedule and re-evaluation work is for
     * sessions that moved, so none happens here.
     */
    private async reconcilePlannedPeriod(
        tx: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            client: { endDate: Date | null };
            record: Prisma.service_record_caseGetPayload<Prisma.service_record_caseDefaultArgs>;
            endDate: string;
        },
    ): Promise<ServiceRecordRealignmentResult> {
        const { branchId, clientId, client, record, endDate } = params;
        const endDateValue = toDbDate(endDate);
        let wrote = false;
        if (isoDate(record.endDate) !== endDate) {
            await tx.service_record_case.update({
                where: { id: record.id, branchId },
                data: { endDate: endDateValue, version: { increment: 1 } },
            });
            wrote = true;
        }
        if (isoDate(client.endDate) !== endDate) {
            await tx.client.updateMany({
                where: { id: clientId, branchId },
                data: { endDate: endDateValue },
            });
            wrote = true;
        }
        if (!wrote) return { ...NOT_CHANGED, mode: "planned" };
        await this.refreshTokenExpiry(tx, branchId, record.id, endDateValue);
        return { changed: true, mode: "planned", endDate, restoreRequiredSessionCount: null };
    }

    private async realignLegacy(
        tx: Prisma.TransactionClient,
        ctx: {
            params: ServiceRecordRealignmentParams;
            now: Date;
            client: { startDate: Date | null; endDate: Date | null };
            record: Prisma.service_record_caseGetPayload<Prisma.service_record_caseDefaultArgs>;
            days: Prisma.service_record_dayGetPayload<Prisma.service_record_dayDefaultArgs>[];
            calendar: KrBusinessDayCalendar;
        },
    ): Promise<ServiceRecordRealignmentResult> {
        const { params, now, client, record, days, calendar } = ctx;
        const { branchId, clientId } = params;
        // The caller's own end date wins, and a case with no stored N has nothing to project.
        if (params.callerSuppliedEndDate) return NOT_CHANGED;
        const total = record.requiredSessionCount;
        if (total === null || total < 1) return NOT_CHANGED;
        // The client's start as written in this transaction, not the case's previous one.
        const startDate = isoDate(client.startDate) ?? isoDate(record.startDate);
        if (!startDate) return NOT_CHANGED;

        const records = days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: isoDate(day.serviceDate)!,
        }));
        // A written (locked or submitted) session N is the end itself; otherwise chain from the
        // closest earlier row (or the start) on the client's service days. An unwritten draft
        // row N is only a date that moves with the schedule. Never `startDate + duration`:
        // that would roll back delay extensions already recorded in the rows.
        const writtenLast = days.find((day) =>
            (day.caseSessionIndex ?? day.sessionIndex) === total && (day.locked || day.submittedAt));
        const projected = (writtenLast ? isoDate(writtenLast.serviceDate) : null)
            ?? getExpectedSessionDateFromRecords(startDate, total, records, calendar);
        if (!projected) return NOT_CHANGED;
        let lastWritten: string | null = null;
        for (const day of days) {
            if (!day.locked && !day.submittedAt) continue;
            const date = isoDate(day.serviceDate)!;
            if (lastWritten === null || date > lastWritten) lastWritten = date;
        }
        const endDate = lastWritten !== null && lastWritten > projected ? lastWritten : projected;
        if (endDate === isoDate(client.endDate)) return NOT_CHANGED;

        const endDateValue = toDbDate(endDate);
        await tx.client.updateMany({
            where: { id: clientId, branchId },
            data: { endDate: endDateValue },
        });
        // Case and client periods stay equal, so the lifecycle sync keeps the stored count.
        await tx.service_record_case.update({
            where: { id: record.id, branchId },
            data: { endDate: endDateValue, version: { increment: 1 } },
        });
        await this.refreshTokenExpiry(tx, branchId, record.id, endDateValue);
        await this.persistReevaluationIntents(tx, { branchId, clientId, scheduleIds: [], intentAt: now });

        return { changed: true, mode: "legacy", endDate, restoreRequiredSessionCount: total };
    }

    private async loadSchedules(
        tx: Prisma.TransactionClient,
        branchId: string,
        clientId: number,
    ): Promise<ScheduleRow[]> {
        return tx.employee_schedule.findMany({
            where: { branchId, clientId },
            orderBy: { id: "asc" },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                replaced: true,
                terminatedAt: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                primaryEmployee: { select: { name: true } },
                serviceRecordAssignment: {
                    select: {
                        id: true,
                        branchId: true,
                        serviceRecordCaseId: true,
                        scheduleId: true,
                        employeeId: true,
                        startDate: true,
                        endDate: true,
                        employeeNameSnapshot: true,
                    },
                },
            },
        });
    }

    /** The assignment view `assignmentWrites` expects; built the way the edit source builds it. */
    private sourceAssignments(schedules: readonly ScheduleRow[]): ServiceRecordEditSourceAssignment[] {
        return schedules.map((schedule) => ({
            id: schedule.serviceRecordAssignment?.id ?? null,
            branchId: schedule.serviceRecordAssignment?.branchId ?? schedule.branchId ?? null,
            serviceRecordCaseId: schedule.serviceRecordAssignment?.serviceRecordCaseId ?? null,
            scheduleId: schedule.id,
            employeeId: schedule.serviceRecordAssignment?.employeeId ?? schedule.primaryEmployeeId,
            startDate: isoDate(schedule.serviceRecordAssignment?.startDate ?? schedule.startDate) ?? "",
            endDate: isoDate(schedule.serviceRecordAssignment?.endDate ?? schedule.endDate) ?? "",
            replaced: schedule.replaced,
            employeeName: schedule.serviceRecordAssignment?.employeeNameSnapshot ?? schedule.primaryEmployee.name,
            scheduleStartDate: isoDate(schedule.startDate) ?? "",
            scheduleEndDate: isoDate(schedule.endDate) ?? "",
            scheduleTerminatedAt: schedule.terminatedAt ? schedule.terminatedAt.toISOString() : null,
            primaryEmployeeId: schedule.primaryEmployeeId,
            secondaryEmployeeId: schedule.secondaryEmployeeId ?? null,
            primaryEmployeeName: schedule.primaryEmployee.name,
        }));
    }

    /**
     * A re-laid session that stood inside its own assignment's period must still
     * stand inside it afterwards. Moving it across a handover boundary would hand
     * the session to the other caregiver's period; that is the admin's call.
     */
    private assertNoCrossedHandover(
        before: readonly ServiceRecordPlannedSession[],
        after: readonly ServiceRecordPlannedSession[],
        movedIndexes: readonly number[],
        stored: readonly ServiceRecordEditSourceAssignment[],
        writes: ReturnType<typeof assignmentWrites>,
    ): void {
        for (const sessionIndex of movedIndexes) {
            const entry = after[sessionIndex - 1]!;
            const assignment = stored.find((candidate) => candidate.id === entry.assignmentId);
            const write = writes.find((candidate) => candidate.assignmentId === entry.assignmentId);
            if (!assignment || !write) continue;
            const oldDate = before[sessionIndex - 1]!.serviceDate;
            const wasInside = oldDate >= (assignment.startDate || assignment.scheduleStartDate)
                && oldDate <= (assignment.endDate || assignment.scheduleEndDate);
            const isInside = entry.serviceDate >= write.startDate && entry.serviceDate <= write.endDate;
            if (wasInside && !isInside) throw manualScheduleConflict();
        }
    }

    private async assertNoOverlap(
        tx: Prisma.TransactionClient,
        branchId: string,
        clientId: number,
        schedule: ScheduleRow,
        startDate: string,
        endDate: string,
    ): Promise<void> {
        try {
            await assertNoActiveEmployeeScheduleOverlap(tx, {
                branchId,
                clientId,
                primaryEmployeeId: schedule.primaryEmployeeId,
                secondaryEmployeeId: schedule.secondaryEmployeeId,
                startDate: toDbDate(startDate),
                endDate: toDbDate(endDate),
                replaced: schedule.replaced,
                excludeScheduleId: schedule.id,
            });
        } catch (error) {
            if (error instanceof ConflictException || error instanceof BadRequestException) {
                throw manualScheduleConflict();
            }
            throw error;
        }
    }

    private async refreshTokenExpiry(
        tx: Prisma.TransactionClient,
        branchId: string,
        caseId: string,
        endDate: Date,
    ): Promise<void> {
        await tx.service_record_token.updateMany({
            where: { branchId, serviceRecordCaseId: caseId, active: true, revokedAt: null },
            data: { expiresAt: getServiceRecordTokenExpiresAt(endDate) },
        });
    }

    /**
     * Leaves the durable marker the automation reconciler uses to recalculate
     * future jobs, the way the admin edit confirm does. Written in the caller's
     * transaction, so a later failure rolls it back with the dates.
     */
    private async persistReevaluationIntents(
        tx: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            scheduleIds: ReadonlyArray<number | null>;
            intentAt: Date;
        },
    ): Promise<void> {
        const transaction = tx as unknown as {
            message_trigger_rule?: { upsert?: unknown };
            message_trigger_job?: { upsert?: unknown };
        };
        // Narrow unit doubles do not expose the message delegates; a real Prisma
        // transaction always does, so production stays durable and atomic.
        if (
            typeof transaction.message_trigger_rule?.upsert !== "function"
            || typeof transaction.message_trigger_job?.upsert !== "function"
        ) {
            return;
        }
        await persistClientMessageAutomationIntent(tx, {
            branchId: params.branchId,
            clientId: params.clientId,
            includePast: false,
            suppressGreeting: true,
            intentAt: params.intentAt,
        });
        const scheduleIds = [...new Set(
            params.scheduleIds.filter((scheduleId): scheduleId is number => (
                typeof scheduleId === "number" && Number.isInteger(scheduleId) && scheduleId > 0
            )),
        )].sort((left, right) => left - right);
        for (const scheduleId of scheduleIds) {
            await persistScheduleMessageAutomationIntent(tx, {
                branchId: params.branchId,
                clientId: params.clientId,
                scheduleId,
                includePast: false,
                intentAt: params.intentAt,
            });
        }
    }
}
