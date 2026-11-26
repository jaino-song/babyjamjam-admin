import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";

import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import type { StartDateChangeDecision } from "application/services/service-record-lifecycle.service";
import {
    parsePlannedVector,
    persistReevaluationIntents,
    refreshTokenExpiry,
} from "application/services/service-record-schedule-realignment.service";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";

interface StartDateChangeParams {
    branchId: string;
    clientId: number;
    decision: StartDateChangeDecision;
    newStartDate: Date | null;
    actorUserId?: string | null;
    calendar: KrBusinessDayCalendar;
    /** The allocation save validates the corrected schedule and publishes its final membership. */
    allocationSave?: {
        clientPeriod: {
            endDate: Date | null;
            allowSaturdayService: boolean;
            allowSundayService: boolean;
            allowHolidayService: boolean;
        };
        beforePeriodWrite: (periods: readonly CorrectedSchedulePeriod[]) => Promise<void>;
        collectReevaluationSchedules: (scheduleIds: ReadonlyArray<number | null>) => void;
    };
}

interface CorrectedSchedulePeriod {
    scheduleId: number;
    startDate: Date;
    endDate: Date;
}

interface OwnerPeriod {
    assignmentId: string | null;
    scheduleId: number | null;
    startDate: string;
    endDate: string;
}

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Applies an explicitly confirmed start change under the caller's service-record write locks. */
@Injectable()
export class ServiceRecordStartDateChangeService {
    constructor(
        @Optional() private readonly agentAutomationRecordStore?: AgentAutomationRecordStoreService,
    ) {}

    async applyInTransaction(
        tx: Prisma.TransactionClient,
        params: StartDateChangeParams,
    ): Promise<{ restoreRequiredSessionCount: number | null; restoreByCase?: ReadonlyMap<string, number | null> }> {
        const { branchId, clientId, decision, newStartDate } = params;
        if (!newStartDate) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/startDate", code: "REQUIRED", location: "body",
                detail: "변경할 서비스 시작일을 입력해 주세요.",
            }));
        }
        const records = await tx.service_record_case.findMany({
            where: { branchId, clientId, ...(decision.cases ? { id: { in: decision.cases.map(({ caseId }) => caseId) } } : {}) },
            select: { id: true, requiredSessionCount: true, plannedSessions: true },
            orderBy: { id: "asc" },
        });
        if (records.length !== (decision.cases?.length ?? 1)) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        const sharedPeriods = new Map<number, CorrectedSchedulePeriod>();
        const restoreByCase = new Map<string, number | null>();
        let householdEnd: Date | undefined;
        for (const record of records) {
            const selected = decision.cases?.find(({ caseId }) => caseId === record.id);
            const corrected = await this.applyCase(tx, { ...params, newStartDate, decision: { ...decision, ...selected } }, record);
            restoreByCase.set(record.id, record.requiredSessionCount);
            if (corrected.endDate && (!householdEnd || corrected.endDate > householdEnd)) householdEnd = corrected.endDate;
            for (const period of corrected.periods) {
                const prior = sharedPeriods.get(period.scheduleId);
                if (!prior) {
                    sharedPeriods.set(period.scheduleId, period);
                } else {
                    if (period.startDate < prior.startDate) prior.startDate = period.startDate;
                    if (period.endDate > prior.endDate) prior.endDate = period.endDate;
                }
            }
        }
        const periods = [...sharedPeriods.values()];
        await params.allocationSave?.beforePeriodWrite(periods);
        if (householdEnd) {
            await tx.client.updateMany({ where: { id: clientId, branchId }, data: { endDate: householdEnd } });
        }
        for (const { scheduleId, ...data } of periods) {
            await this.agentAutomationRecordStore?.appendScheduleWriteFence(tx, {
                branchId, clientId, mutationId: randomUUID(), scheduleIds: [scheduleId],
            });
            await tx.employee_schedule.updateMany({ where: { id: scheduleId, branchId, clientId }, data });
        }
        const scheduleIds = periods.map(({ scheduleId }) => scheduleId);
        if (params.allocationSave) {
            params.allocationSave.collectReevaluationSchedules(scheduleIds);
        } else {
            await persistReevaluationIntents(tx, { branchId, clientId, scheduleIds, intentAt: new Date() });
        }
        return {
            restoreRequiredSessionCount: records.length === 1 ? records[0]!.requiredSessionCount : null,
            ...(decision.cases ? { restoreByCase } : {}),
        };
    }

    private async applyCase(
        tx: Prisma.TransactionClient,
        params: StartDateChangeParams & { newStartDate: Date },
        record: { id: string; requiredSessionCount: number | null; plannedSessions: Prisma.JsonValue },
    ): Promise<{ endDate: Date | null; periods: CorrectedSchedulePeriod[] }> {
        const { branchId, clientId, decision, newStartDate } = params;
        const client = await tx.client.findFirst({
            where: { id: clientId, branchId },
            select: { allowSaturdayService: true, allowSundayService: true, allowHolidayService: true, endDate: true },
        });
        if (!client) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        const caseWhere = { branchId, serviceRecordCaseId: record.id };
        const days = await tx.service_record_day.findMany({ where: caseWhere });
        const total = record.requiredSessionCount;
        if (total === null && days.length > 0 && (decision.mode === "RESTART" || decision.mode === "MOVE")) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_DURATION_REQUIRED"));
        }
        const clientPeriod = params.allocationSave?.clientPeriod ?? client;
        const calendar = withClientServiceDays(params.calendar, clientPeriod);
        const start = newStartDate.toISOString().slice(0, 10);
        // No old written slots or pauses seed this window: this is the read projection's no-record fallback.
        const dates = Array.from({ length: total ?? 0 }, (_, index) => calendar.calcEndDateBusinessDays(start, index + 1));
        const schedules = await tx.employee_schedule.findMany({
            where: { branchId, clientId },
            select: { id: true, replaced: true, terminatedAt: true },
            orderBy: { id: "desc" },
        });
        const assignments = await tx.service_record_assignment.findMany({
            where: caseWhere,
            select: { id: true, scheduleId: true },
        });
        const activeSchedule = schedules.find((schedule) => !schedule.replaced && !schedule.terminatedAt);
        const activeAssignment = assignments.find((assignment) => assignment.scheduleId === activeSchedule?.id);

        let entries: ServiceRecordPlannedSession[] | null = null;
        if (record.plannedSessions !== null) {
            const vector = parsePlannedVector(record.plannedSessions, total, calendar);
            if (!vector || total === null) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE"));
            }
            const restartOwner = vector.find((entry) => entry.assignmentId === activeAssignment?.id)
                ?? vector[vector.length - 1]!;
            entries = validateServiceRecordScheduleVector(vector.map((entry) => {
                const date = dates[entry.sessionIndex - 1]!;
                return {
                    ...(decision.mode === "RESTART" ? restartOwner : entry),
                    sessionIndex: entry.sessionIndex,
                    serviceDate: date,
                    originalDate: date,
                };
            }), total, calendar, { persisted: true });
        }
        const periods = new Map<string, OwnerPeriod>();
        const addDate = (assignmentId: string | null, scheduleId: number | null, date: string): void => {
            if (!assignmentId && scheduleId === null) return;
            const key = assignmentId ?? `schedule:${scheduleId}`;
            const period = periods.get(key);
            if (period) {
                period.startDate = date < period.startDate ? date : period.startDate;
                period.endDate = date > period.endDate ? date : period.endDate;
            } else {
                periods.set(key, { assignmentId, scheduleId, startDate: date, endDate: date });
            }
        };
        if (decision.mode !== "RESTART") {
            if (entries) {
                for (const entry of entries) addDate(entry.assignmentId, entry.scheduleId, entry.serviceDate);
            } else {
                const scheduleBySession = new Map(days.map((day) => [
                    day.caseSessionIndex ?? day.sessionIndex, day.scheduleId,
                ]));
                for (const [index, date] of dates.entries()) {
                    // 기록된 회차의 소유자는 유지하고, 미작성 회차는 현재 활성 일정에 배정한다.
                    const scheduleId = scheduleBySession.get(index + 1) ?? activeSchedule?.id;
                    if (scheduleId === undefined) continue;
                    const assignment = assignments.find((candidate) => candidate.scheduleId === scheduleId);
                    addDate(assignment?.id ?? null, scheduleId, date);
                }
            }
        }
        if (periods.size === 0 && activeSchedule && dates.length > 0) {
            addDate(activeAssignment?.id ?? null, activeSchedule.id, dates[0]!);
            addDate(activeAssignment?.id ?? null, activeSchedule.id, dates[dates.length - 1]!);
        }
        if (days.length > 0) {
            const batchId = randomUUID();
            await tx.service_record_day_archive.createMany({
                data: days.map((day) => ({
                    ...caseWhere,
                    clientId,
                    batchId,
                    reason: decision.mode,
                    originalDayId: day.id,
                    caseSessionIndex: day.caseSessionIndex,
                    serviceDate: day.serviceDate,
                    previousStartDate: decision.previousStartDate,
                    newStartDate,
                    archivedByUserId: params.actorUserId ?? null,
                    // JSON round-trip preserves every scalar/JSON field and serializes Date values as ISO strings.
                    payload: JSON.parse(JSON.stringify(day)) as Prisma.InputJsonValue,
                })),
            });
        }

        if (decision.mode === "RESTART") {
            await tx.service_record_day.deleteMany({ where: caseWhere });
        } else if (decision.mode === "MOVE") {
            for (const day of days) {
                const date = dates[(day.caseSessionIndex ?? day.sessionIndex) - 1];
                if (!date) continue;
                await tx.service_record_day.updateMany({
                    where: { ...caseWhere, id: day.id },
                    data: {
                        serviceDate: toDbDate(date),
                        ...(day.serviceDate.toISOString().slice(0, 10) !== date ? { periodMismatchKeptAt: null } : {}),
                    },
                });
            }
        }

        const endDate = dates.length > 0 ? toDbDate(dates[dates.length - 1]!) : clientPeriod.endDate;
        await tx.service_record_case.update({
            where: { id: record.id, branchId },
            data: {
                startDate: newStartDate,
                endDate,
                ...(entries ? { plannedSessions: entries as unknown as Prisma.InputJsonValue } : {}),
                version: { increment: 1 },
            },
        });
        for (const { assignmentId, startDate, endDate } of periods.values()) {
            if (assignmentId) {
                await tx.service_record_assignment.updateMany({
                    where: { ...caseWhere, id: assignmentId },
                    data: { startDate: toDbDate(startDate), endDate: toDbDate(endDate) },
                });
            }
        }
        if (endDate) await refreshTokenExpiry(tx, branchId, record.id, endDate);
        return {
            endDate: dates.length > 0 ? endDate : null,
            periods: [...periods.values()].flatMap(({ scheduleId, startDate, endDate }) =>
                scheduleId === null ? [] : [{ scheduleId, startDate: toDbDate(startDate), endDate: toDbDate(endDate) }]),
        };
    }
}
