import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { assertNoActiveEmployeeScheduleOverlap } from "application/policies/employee-schedule-invariants.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { type KrBusinessDayCalendar, UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { computeServiceStatus } from "domain/value-objects/service-status.vo";
import { IMMUTABLE_FINALIZATION_STATUSES, ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { persistReevaluationIntents, refreshTokenExpiry } from "./service-record-schedule-realignment.service";

const isoDate = (date: Date | null | undefined): string | null => date ? date.toISOString().slice(0, 10) : null;
const offset = (date: Date, days: number): string => {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() + days);
    return isoDate(copy)!;
};

interface PeriodParams {
    branchId: string;
    clientId: number;
    calendar: KrBusinessDayCalendar;
}

interface PeriodFitResult {
    startDate: string | null;
    endDate: string | null;
    changed: boolean;
    scheduleIds: number[];
}

export function servicePeriodSessionCount(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
    fallback: number | null,
    calendar: KrBusinessDayCalendar,
    authoritative = false,
): number {
    // Confirmed revision rows carry the authoritative actual N. Legacy rows
    // retain the existing in-period cap used by the provider flow, while a
    // postponed span never inflates the stored count.
    if (authoritative) return fallback ?? 0;
    const startDateIso = isoDate(startDate);
    const endDateIso = isoDate(endDate);
    if (!startDateIso || !endDateIso) return fallback ?? 0;
    try {
        return serviceRecordSessionCount(startDate, endDate, fallback, calendar) ?? 0;
    } catch (error) {
        // Unsupported legacy years remain viewable. A presentation total of
        // zero means the authoritative N is unknown; the editor projection
        // carries the explicit blocker and never invents a weekday fallback.
        if (error instanceof UnsupportedKoreanHolidayYearError) return fallback ?? 0;
        throw error;
    }
}
/** Only period boundaries change here. Submitted dates, the plan and the owed N are facts. */
@Injectable()
export class ServiceRecordPeriodMismatchService {
    constructor(
        private readonly lifecycleService: ServiceRecordLifecycleService,
        @Optional() private readonly agentAutomationRecordStore?: AgentAutomationRecordStoreService,
    ) {}

    private async loadLocked(tx: Prisma.TransactionClient, params: PeriodParams) {
        const { branchId, clientId } = params;
        const where = { branchId, clientId };
        const discovered = await tx.service_record_case.findFirst({ where });
        const discoveredClient = await tx.client.findFirst({ where: { id: clientId, branchId } });
        if (!discovered || !discoveredClient) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const schedules = await tx.employee_schedule.findMany({ where, orderBy: { id: "asc" } });
        // Shared order: client -> employees -> case -> schedules/assignments/days.
        // Re-read the full target set after waiting for the lock, before any write.
        await lockServiceRecordWriteSet(tx, {
            branchId, clientId, caseId: discovered.id,
            scheduleIds: schedules.map((schedule) => schedule.id),
            expectedScheduleIds: schedules.map((schedule) => schedule.id),
            employeeIds: schedules.flatMap((schedule) => [schedule.primaryEmployeeId, schedule.secondaryEmployeeId]),
        });
        const record = await tx.service_record_case.findFirst({ where });
        const client = await tx.client.findFirst({ where: { id: clientId, branchId } });
        if (!record || record.id !== discovered.id || !client) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        if (IMMUTABLE_FINALIZATION_STATUSES.has(record.status)) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_FINALIZED"));
        }
        const currentSchedules = await tx.employee_schedule.findMany({ where, orderBy: { id: "asc" } });
        const calendar = withClientServiceDays(params.calendar, client);
        const total = servicePeriodSessionCount(record.startDate, record.endDate, record.requiredSessionCount, calendar,
            record.requiredSessionCount !== null || record.currentRevisionId != null
            || record.currentUsableRevisionId != null || record.currentUsableDocumentVersion != null || record.plannedSessions != null);
        const days = await tx.service_record_day.findMany({
            where: { branchId, serviceRecordCaseId: record.id, locked: true },
            orderBy: { caseSessionIndex: "asc" },
        });
        const outOfPeriod = days.filter((day) => {
            if (!record.startDate || !record.endDate || !day.locked) return false;
            const index = day.caseSessionIndex ?? day.sessionIndex;
            const date = isoDate(day.serviceDate)!;
            return index >= 1 && index <= total
                && date >= offset(record.startDate, -7) && date <= offset(record.endDate, 7)
                && (date < isoDate(record.startDate)! || date > isoDate(record.endDate)!);
        });
        return { record, client, schedules: currentSchedules, outOfPeriod, calendar, total };
    }

    async keepInTransaction(tx: Prisma.TransactionClient, params: PeriodParams & { sessionIndexes: number[] }): Promise<{ keptSessionIndexes: number[] }> {
        const { record, outOfPeriod } = await this.loadLocked(tx, params);
        const indexes = params.sessionIndexes;
        if (!Array.isArray(indexes) || indexes.length === 0 || new Set(indexes).size !== indexes.length
            || indexes.some((index) => !Number.isInteger(index) || index < 1
                || !outOfPeriod.some((day) => (day.caseSessionIndex ?? day.sessionIndex) === index))) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/sessionIndexes", code: "INVALID_VALUE", location: "body",
                detail: "기간 밖에 제출된 회차를 선택해 주세요.",
            }));
        }
        // Preserve the first confirmation time, including when a caller retries.
        await tx.service_record_day.updateMany({
            where: { branchId: params.branchId, serviceRecordCaseId: record.id,
                id: { in: outOfPeriod.filter((day) => indexes.includes(day.caseSessionIndex ?? day.sessionIndex)).map((day) => day.id) },
                periodMismatchKeptAt: null },
            data: { periodMismatchKeptAt: new Date() },
        });
        return { keptSessionIndexes: indexes };
    }

    async fitInTransaction(tx: Prisma.TransactionClient, params: PeriodParams): Promise<PeriodFitResult> {
        const { branchId, clientId } = params;
        const { record, client, schedules, outOfPeriod, calendar, total } = await this.loadLocked(tx, params);
        const unkept = outOfPeriod.filter((day) => day.periodMismatchKeptAt == null);
        const unchanged = { startDate: isoDate(record.startDate), endDate: isoDate(record.endDate), changed: false, scheduleIds: [] as number[] };
        if (unkept.length === 0) return unchanged;
        const dates = unkept.map((day) => isoDate(day.serviceDate)!);
        const startDate = [unchanged.startDate!, ...dates].sort()[0]!;
        const endDate = [unchanged.endDate!, ...dates].sort().at(-1)!;
        const newStart = new Date(`${startDate}T00:00:00.000Z`);
        const newEnd = new Date(`${endDate}T00:00:00.000Z`);
        const writes = schedules.map((schedule) => ({
            schedule,
            data: {
                ...(isoDate(schedule.startDate) === isoDate(client.startDate) && isoDate(schedule.startDate) !== startDate ? { startDate: newStart } : {}),
                ...(isoDate(schedule.endDate) === isoDate(client.endDate) && isoDate(schedule.endDate) !== endDate ? { endDate: newEnd } : {}),
            },
        })).filter(({ data }) => Object.keys(data).length > 0);
        // All conflicts are checked before the fence or any date write.
        for (const { schedule, data } of writes) {
            await assertNoActiveEmployeeScheduleOverlap(tx, {
                branchId, clientId, primaryEmployeeId: schedule.primaryEmployeeId,
                secondaryEmployeeId: schedule.secondaryEmployeeId,
                startDate: data.startDate ?? schedule.startDate, endDate: data.endDate ?? schedule.endDate,
                replaced: schedule.replaced, excludeScheduleId: schedule.id,
            });
        }
        const scheduleIds = writes.map(({ schedule }) => schedule.id);
        await this.agentAutomationRecordStore?.appendScheduleWriteFence(tx, {
            branchId, clientId, mutationId: randomUUID(), scheduleIds,
        });
        for (const { schedule, data } of writes) {
            await tx.employee_schedule.updateMany({ where: { id: schedule.id, branchId, clientId }, data });
        }
        await tx.client.updateMany({
            where: { id: clientId, branchId },
            data: { startDate: newStart, endDate: newEnd,
                serviceStatus: computeServiceStatus(client.serviceStatus, newStart, newEnd, client.bookingConfirmedAt) },
        });
        // Keep the old case period until ensureForClient has compared it with the
        // new client dates, then restore N if the legacy recapping changed it.
        const syncedRecord = await this.lifecycleService.ensureForClient(clientId, tx, calendar);
        if (syncedRecord && syncedRecord.requiredSessionCount !== total) {
            await tx.service_record_case.update({
                where: { id: record.id, branchId }, data: { requiredSessionCount: total },
            });
            await this.lifecycleService.recompute(record.id, tx, calendar);
        }
        await tx.service_record_case.update({
            where: { id: record.id, branchId }, data: { startDate: newStart, endDate: newEnd },
        });
        await refreshTokenExpiry(tx, branchId, record.id, newEnd);
        await persistReevaluationIntents(tx, { branchId, clientId, scheduleIds, intentAt: new Date() });
        return { startDate, endDate, changed: true, scheduleIds };
    }
}
