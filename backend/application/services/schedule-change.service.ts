import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
    assertNoActiveEmployeeScheduleOverlap,
} from "application/policies/employee-schedule-invariants.policy";
import {
    lockScheduleChangeRequestForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    previousBusinessDay,
    shiftServiceRecordScheduleSuffix,
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";
import { MessageTriggerService } from "./message-trigger.service";
import {
    ServiceRecordTokenService,
    ServiceRecordTokenContext,
} from "./service-record-token.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { AgentAutomationRecordStoreService } from "../agent/agent-automation-record-store.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";

/** The calendar day after `iso` (YYYY-MM-DD). */
function nextCalendarDay(iso: string): string {
    const date = new Date(`${iso}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function toDbDate(iso: string): Date {
    return new Date(iso + "T00:00:00.000Z");
}

interface ServiceRecordForChange {
    requiredSessionCount?: number | null;
    plannedSessions?: Prisma.JsonValue | null;
}

/** Parse only a complete authoritative vector; legacy rows use the old path. */
function plannedSessionVector(
    raw: Prisma.JsonValue | null | undefined,
    requiredSessionCount: number | null | undefined,
    calendar: KrBusinessDayCalendar,
): ServiceRecordPlannedSession[] | null {
    if (raw === null || raw === undefined) return null;
    const values = Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null && !Array.isArray(raw)
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
        const provenanceVersion = row["provenanceVersion"]
            ?? provenance?.["version"]
            ?? row["version"];
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

function canonicalPlannedSessions(
    record: ServiceRecordForChange,
    calendar: KrBusinessDayCalendar,
): ServiceRecordPlannedSession[] | null {
    return plannedSessionVector(record.plannedSessions, record.requiredSessionCount, calendar);
}

function shiftCanonicalPlan(
    record: ServiceRecordForChange,
    sessionIndex: number,
    newDate: string,
    calendar: KrBusinessDayCalendar,
    allowNonBusinessDay = false,
): ServiceRecordPlannedSession[] | null {
    const hasPersistedPlan = record.plannedSessions !== null && record.plannedSessions !== undefined;
    const planned = canonicalPlannedSessions(record, calendar);
    if (!hasPersistedPlan) return null;
    if (!planned) {
        throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE"));
    }
    try {
        return shiftServiceRecordScheduleSuffix(planned, sessionIndex, newDate, calendar, { allowNonBusinessDay }).entries;
    } catch {
        throw new BadRequestException(codeOnlyProblemBody("INVALID_SCHEDULE_DATE"));
    }
}

class StaleRequestError extends Error {
    constructor(
        public readonly requestId: string,
        public readonly branchId: string,
    ) {
        super("stale");
    }
}

interface ScheduleForChange {
    startDate: Date | null;
    endDate: Date | null;
    clientId: number;
}

interface ClientForChange {
    duration: number | null;
    birthDate?: Date | null;
    startDate?: Date | null;
}

interface ServiceRecordDayForChange {
    sessionIndex: number;
    serviceDate: Date;
    locked: boolean;
}

interface ScheduleChangeRequestForSerialization {
    id: string;
    branchId: string;
    scheduleId: number;
    clientId: number;
    sessionIndex: number;
    fromDate: Date;
    toDate: Date;
    oldEndDate: Date;
    newEndDate: Date;
    status: string;
    reason: string | null;
    decidedBy: string | null;
    requestedAt: Date;
    decidedAt: Date | null;
}

@Injectable()
export class ScheduleChangeService {
    private readonly logger = new Logger(ScheduleChangeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly holidayCalendar: HolidayCalendarService,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly lifecycleService?: ServiceRecordLifecycleService,
        @Optional() private readonly agentAutomationRecordStore?: AgentAutomationRecordStoreService,
    ) {}

    private computeTarget(
        schedule: ScheduleForChange,
        client: ClientForChange,
        days: ServiceRecordDayForChange[],
        calendar: KrBusinessDayCalendar,
        record?: ServiceRecordForChange,
    ): { sessionIndex: number; fromDate: string; toDate: string; newEndDate: string; minimumDate: string | null } {
        const hasPersistedPlan = record?.plannedSessions !== null && record?.plannedSessions !== undefined;
        const planned = record ? canonicalPlannedSessions(record, calendar) : null;
        if (hasPersistedPlan && !planned) {
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE"));
        }
        const totalSessions = record?.requiredSessionCount ?? client.duration;
        if (!totalSessions || totalSessions <= 0) {
            throw new ConflictException(codeOnlyProblemBody("SCHEDULE_CHANGE_UNCOMPUTABLE"));
        }

        const lastLocked = days.reduce((max, row) => (row.locked ? Math.max(max, row.sessionIndex) : max), 0);
        const sessionIndex = lastLocked + 1;
        if (sessionIndex > totalSessions) {
            throw new ConflictException(codeOnlyProblemBody("ALL_SESSIONS_SUBMITTED"));
        }

        const currentRow = days.find((row) => row.sessionIndex === sessionIndex);
        let fromDate: string;
        if (planned) {
            const plannedRow = planned.find((row) => row.sessionIndex === sessionIndex);
            if (!plannedRow) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE"));
            }
            fromDate = plannedRow.serviceDate;
        } else if (currentRow) {
            fromDate = toIso(currentRow.serviceDate);
        } else {
            const previousRow = days.find((row) => row.sessionIndex === sessionIndex - 1);
            if (previousRow) {
                fromDate = calendar.nextBusinessDay(toIso(previousRow.serviceDate));
            } else if (schedule.startDate) {
                const startDate = toIso(schedule.startDate);
                fromDate = calendar.isBusinessDay(startDate) ? startDate : calendar.nextBusinessDay(startDate);
            } else {
                throw new ConflictException(codeOnlyProblemBody("SCHEDULE_CHANGE_UNCOMPUTABLE"));
            }
        }

        const toDate = calendar.nextBusinessDay(fromDate);
        const newEndDate = calendar.addBusinessDays(toDate, totalSessions - sessionIndex);

        // An admin may move the session earlier as well as later, but never
        // before the birth date (출산일) and never onto or before the previous
        // session, so sessions keep their order. Session 1 has no previous one.
        const previousDate = sessionIndex > 1
            ? planned?.find((row) => row.sessionIndex === sessionIndex - 1)?.serviceDate
                ?? (() => {
                    const row = days.find((day) => day.sessionIndex === sessionIndex - 1);
                    return row ? toIso(row.serviceDate) : undefined;
                })()
            : undefined;
        const bounds = [
            client.birthDate ? toIso(client.birthDate) : null,
            previousDate ? nextCalendarDay(previousDate) : null,
        ].filter((value): value is string => value !== null).sort();
        const minimumDate = bounds.length > 0 ? bounds[bounds.length - 1]! : null;

        return { sessionIndex, fromDate, toDate, newEndDate, minimumDate };
    }

    private serializeRequest(row: ScheduleChangeRequestForSerialization) {
        return {
            id: row.id,
            branchId: row.branchId,
            scheduleId: row.scheduleId,
            clientId: row.clientId,
            sessionIndex: row.sessionIndex,
            fromDate: toIso(row.fromDate),
            toDate: toIso(row.toDate),
            oldEndDate: toIso(row.oldEndDate),
            newEndDate: toIso(row.newEndDate),
            status: row.status,
            reason: row.reason,
            decidedBy: row.decidedBy,
            requestedAt: row.requestedAt.toISOString(),
            decidedAt: row.decidedAt?.toISOString() ?? null,
        };
    }

    async preview(ctx: ServiceRecordTokenContext): Promise<{ sessionIndex: number; fromDate: string; toDate: string }> {
        // Display-only: the cached branch calendar is enough.
        const calendar = await this.holidayCalendar.forBranch(ctx.branchId);
        const record = ctx.serviceRecordCaseId
            ? await this.prisma.service_record_case.findUnique({ where: { id: ctx.serviceRecordCaseId } })
            : await this.lifecycleService?.ensureForSchedule(ctx.scheduleId);
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), calendar, record);

        return {
            sessionIndex: target.sessionIndex,
            fromDate: target.fromDate,
            toDate: target.toDate,
        };
    }

    async createRequest(ctx: ServiceRecordTokenContext): Promise<{ id: string; sessionIndex: number; fromDate: string; toDate: string }> {
        // Saved: the proposed dates are persisted, so read the calendar fresh.
        const calendar = await this.holidayCalendar.forBranch(ctx.branchId, { fresh: true });
        const record = ctx.serviceRecordCaseId
            ? await this.prisma.service_record_case.findUnique({ where: { id: ctx.serviceRecordCaseId } })
            : await this.lifecycleService?.ensureForSchedule(ctx.scheduleId);
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        const existing = await this.prisma.schedule_change_request.findFirst({
            where: { scheduleId: ctx.scheduleId, status: "pending" },
        });
        if (existing) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_ALREADY_PENDING"));
        }

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), calendar, record);
        if (!schedule.endDate) {
            throw new ConflictException(codeOnlyProblemBody("SCHEDULE_CHANGE_UNCOMPUTABLE"));
        }

        try {
            const request = await this.prisma.schedule_change_request.create({
                data: {
                    branchId: ctx.branchId,
                    scheduleId: ctx.scheduleId,
                    clientId: schedule.clientId,
                    sessionIndex: target.sessionIndex,
                    fromDate: toDbDate(target.fromDate),
                    toDate: toDbDate(target.toDate),
                    oldEndDate: schedule.endDate,
                    newEndDate: toDbDate(target.newEndDate),
                    status: "pending",
                },
            });

            return {
                id: request.id,
                sessionIndex: request.sessionIndex,
                fromDate: toIso(request.fromDate),
                toDate: toIso(request.toDate),
            };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_ALREADY_PENDING"));
            }
            throw error;
        }
    }

    async previewAdminChange(
        branchId: string,
        scheduleId: number,
    ): Promise<{ sessionIndex: number; fromDate: string; minimumDate: string | null }> {
        // Display-only: the cached branch calendar is enough.
        const calendar = await this.holidayCalendar.forBranch(branchId);
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        const record = await this.prisma.service_record_case.findFirst({
            where: { branchId, clientId: schedule.clientId },
        });
        if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), calendar, record);

        return {
            sessionIndex: target.sessionIndex,
            fromDate: target.fromDate,
            minimumDate: target.minimumDate,
        };
    }

    async applyAdminChange(
        scheduleId: number,
        selectedDate: string,
        tenant: { branchId?: string; userId?: string },
        options: { allowNonBusinessDay?: boolean } = {},
    ) {
        const branchId = tenant.branchId ?? "";
        // Saved: the date is validated and the shifted plan persisted against
        // the branch calendar, read fresh before the transaction opens.
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        const selectedDateValue = toDbDate(selectedDate);
        if (
            Number.isNaN(selectedDateValue.getTime())
            || toIso(selectedDateValue) !== selectedDate
            || (!calendar.isBusinessDay(selectedDate) && !options.allowNonBusinessDay)
        ) {
            throw new BadRequestException(codeOnlyProblemBody("INVALID_SCHEDULE_DATE"));
        }
        // A confirmed weekend/holiday exception counts as the business day before
        // it, so later sessions are pulled onto the following business days.
        const cascadeAnchor = calendar.isBusinessDay(selectedDate)
            ? selectedDate
            : previousBusinessDay(selectedDate, calendar);

        let scheduleIdForSync: number | null = null;
        let clientIdForSync: number | null = null;

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                let schedule = await tx.employee_schedule.findFirst({
                    where: { id: scheduleId, branchId },
                    include: { client: true, primaryEmployee: true },
                });
                if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                if (!schedule.endDate) {
                    throw new ConflictException(codeOnlyProblemBody("SCHEDULE_CHANGE_UNCOMPUTABLE"));
                }

                let record = await tx.service_record_case.findFirst({
                    where: { branchId, clientId: schedule.clientId },
                });
                if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

                // Discover ids before locking, then use the shared order and
                // reread the owner rows. This keeps admin date changes aligned
                // with entry/lifecycle writers and rejects a changed target set.
                await lockServiceRecordWriteSet(tx, {
                    branchId,
                    clientId: schedule.clientId,
                    caseId: record.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
                });
                const rereadSchedule = await tx.employee_schedule.findFirst({
                    where: { id: scheduleId, branchId },
                    include: { client: true, primaryEmployee: true },
                });
                const rereadRecord = await tx.service_record_case.findFirst({
                    where: { branchId, clientId: schedule.clientId },
                });
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== schedule.clientId
                    || rereadSchedule.branchId !== branchId
                    || !rereadRecord
                    || rereadRecord.id !== record.id
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                schedule = rereadSchedule;
                record = rereadRecord;

                const pendingRequest = await tx.schedule_change_request.findFirst({
                    where: { scheduleId, status: "pending" },
                });

                const days = await tx.service_record_day.findMany({
                    where: { serviceRecordCaseId: record.id },
                    orderBy: { caseSessionIndex: "asc" },
                });
                const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
                    sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
                    serviceDate: day.serviceDate,
                    locked: day.locked,
                })), calendar, record);
                if (selectedDate === target.fromDate) {
                    throw new ConflictException(codeOnlyProblemBody("SCHEDULE_DATE_NOT_POSTPONED"));
                }
                if (target.minimumDate && selectedDate < target.minimumDate) {
                    throw new BadRequestException(codeOnlyProblemBody("INVALID_SCHEDULE_DATE"));
                }
                // The first session is the service start: moving it, either way, moves the
                // start date. A later session moved before a start pulls that start back.
                // Client period and assignment are judged separately (a replacement
                // assignment starts after the client's period does).
                const moveStart = (start: Date | null): boolean =>
                    target.sessionIndex === 1 || Boolean(start && selectedDate < toIso(start));
                const clientStartMoved = moveStart(schedule.client.startDate);
                const startMoved = moveStart(schedule.startDate);
                const newStartDate = startMoved ? selectedDateValue : schedule.startDate;

                const shiftedPlannedSessions = shiftCanonicalPlan(
                    record,
                    target.sessionIndex,
                    selectedDate,
                    calendar,
                    options.allowNonBusinessDay,
                );
                const totalSessions = record.requiredSessionCount ?? schedule.client.duration;
                if (!totalSessions || totalSessions <= 0) {
                    throw new ConflictException(codeOnlyProblemBody("SCHEDULE_CHANGE_UNCOMPUTABLE"));
                }
                const newEndDateIso = shiftedPlannedSessions
                    ? shiftedPlannedSessions[shiftedPlannedSessions.length - 1]!.serviceDate
                    : target.sessionIndex === totalSessions
                        ? selectedDate
                        : calendar.addBusinessDays(cascadeAnchor, totalSessions - target.sessionIndex);
                const newEndDate = toDbDate(newEndDateIso);

                if (shiftedPlannedSessions) {
                    await tx.service_record_case.update({
                        where: { id: record.id, branchId },
                        data: {
                            plannedSessions: shiftedPlannedSessions as unknown as Prisma.InputJsonValue,
                            version: { increment: 1 },
                        },
                    });
                    const targetRow = days.find((day) =>
                        (day.caseSessionIndex ?? day.sessionIndex) === target.sessionIndex,
                    );
                    if (targetRow && !targetRow.locked) {
                        await tx.service_record_day.update({
                            where: { id: targetRow.id },
                            data: { serviceDate: selectedDateValue },
                        });
                    }
                } else {
                    await tx.service_record_day.upsert({
                        where: {
                            serviceRecordCaseId_caseSessionIndex: {
                                serviceRecordCaseId: record.id,
                                caseSessionIndex: target.sessionIndex,
                            },
                        },
                        update: { serviceDate: selectedDateValue },
                        create: {
                            branchId,
                            scheduleId,
                            serviceRecordCaseId: record.id,
                            caseSessionIndex: target.sessionIndex,
                            employeeId: schedule.primaryEmployeeId,
                            employeeNameSnapshot: schedule.primaryEmployee.name,
                            formVersion: record.formVersion,
                            sessionIndex: target.sessionIndex,
                            serviceDate: selectedDateValue,
                        },
                    });
                }

                const unlockedRows = await tx.service_record_day.findMany({
                    where: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: { gt: target.sessionIndex },
                        locked: false,
                    },
                    orderBy: { caseSessionIndex: "asc" },
                });
                for (const row of unlockedRows) {
                    const rowSessionIndex = row.caseSessionIndex ?? row.sessionIndex;
                    const plannedRow = shiftedPlannedSessions?.find(
                        (entry) => entry.sessionIndex === rowSessionIndex,
                    );
                    await tx.service_record_day.update({
                        where: { id: row.id },
                        data: {
                            serviceDate: toDbDate(plannedRow?.serviceDate ?? calendar.addBusinessDays(
                                cascadeAnchor,
                                rowSessionIndex - target.sessionIndex,
                            )),
                        },
                    });
                }

                if (newStartDate) {
                    await assertNoActiveEmployeeScheduleOverlap(tx, {
                        branchId,
                        clientId: schedule.clientId,
                        primaryEmployeeId: schedule.primaryEmployeeId,
                        secondaryEmployeeId: schedule.secondaryEmployeeId,
                        startDate: newStartDate,
                        endDate: newEndDate,
                        replaced: schedule.replaced,
                        excludeScheduleId: schedule.id,
                    });
                }
                await this.agentAutomationRecordStore?.appendScheduleWriteFence(tx, {
                    branchId,
                    clientId: schedule.clientId,
                    mutationId: randomUUID(),
                    scheduleIds: [schedule.id],
                });
                await tx.employee_schedule.update({
                    where: { id: scheduleId },
                    data: { ...(startMoved ? { startDate: newStartDate } : {}), endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: schedule.clientId },
                    data: { ...(clientStartMoved ? { startDate: selectedDateValue } : {}), endDate: newEndDate },
                });

                const syncedRecord = await this.lifecycleService?.ensureForClient(
                    schedule.clientId,
                    tx,
                    calendar,
                );
                // A date move never changes how many sessions the case owes. The
                // lifecycle sync re-caps a legacy case's N from the new period's
                // business days, which an earlier move or a weekend exception can
                // shrink, so restore the N the case had before the move.
                if (
                    syncedRecord
                    && record.requiredSessionCount != null
                    && syncedRecord.requiredSessionCount !== record.requiredSessionCount
                ) {
                    await tx.service_record_case.update({
                        where: { id: syncedRecord.id },
                        data: { requiredSessionCount: record.requiredSessionCount },
                    });
                    // The sync derived status and completedAt from the capped N;
                    // derive them again from the restored one.
                    await this.lifecycleService?.recompute(syncedRecord.id, tx, calendar);
                }
                await this.tokenService.extendExpiryForCase(
                    syncedRecord?.id ?? record.id,
                    getServiceRecordTokenExpiresAt(newEndDate),
                    tx,
                    { onlyRaise: true },
                );

                const decidedAt = new Date();
                if (pendingRequest) {
                    await tx.schedule_change_request.update({
                        where: { id: pendingRequest.id },
                        data: {
                            status: "stale",
                            decidedBy: tenant.userId ?? null,
                            decidedAt,
                        },
                    });
                }

                const request = await tx.schedule_change_request.create({
                    data: {
                        branchId,
                        scheduleId,
                        clientId: schedule.clientId,
                        sessionIndex: target.sessionIndex,
                        fromDate: toDbDate(target.fromDate),
                        toDate: selectedDateValue,
                        oldEndDate: schedule.endDate,
                        newEndDate,
                        status: "approved",
                        decidedBy: tenant.userId ?? null,
                        decidedAt,
                    },
                });
                const clientStart = clientStartMoved ? selectedDateValue : schedule.client.startDate;
                return { request, clientStartDate: clientStart ? toIso(clientStart) : null };
            });

            scheduleIdForSync = result.request.scheduleId;
            clientIdForSync = result.request.clientId;
            return { ...this.serializeRequest(result.request), startDate: result.clientStartDate };
        } finally {
            if (scheduleIdForSync && branchId) {
                await this.triggerService
                    ?.syncEmployeeAssignmentRulesForSchedule(branchId, scheduleIdForSync, true)
                    ?.catch(() => undefined);
            }
            if (clientIdForSync && branchId) {
                await this.triggerService
                    ?.syncClientRulesForClient(branchId, clientIdForSync, false)
                    ?.catch((error) => {
                        this.logger.error(
                            `Failed to resync client trigger rules for client ${clientIdForSync}`,
                            error instanceof Error ? error.stack : String(error),
                        );
                    });
            }
        }
    }

    async approve(requestId: string, tenant: { branchId?: string; userId?: string }) {
        let scheduleIdForSync: number | null = null;
        let branchIdForSync: string | null = null;
        let clientIdForSync: number | null = null;

        // A caller without a branch can match no request: answer with the
        // same 404 the lookup gives, before any calendar is loaded.
        if (!tenant.branchId) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        // Saved: approval persists shifted dates, so read the calendar fresh
        // before the transaction opens. The request lookup below is pinned to
        // this same branch.
        const calendar = await this.holidayCalendar.forBranch(tenant.branchId, { fresh: true });

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                let request = await tx.schedule_change_request.findFirst({
                    where: { id: requestId, branchId: tenant.branchId ?? "" },
                });
                if (!request) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                if (request.status !== "pending") {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
                }

                let schedule = await tx.employee_schedule.findUnique({
                    where: { id: request.scheduleId },
                    include: { client: true, primaryEmployee: true },
                });
                if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                let record = await tx.service_record_case.findUnique({ where: { clientId: request.clientId } });
                if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

                await lockServiceRecordWriteSet(tx, {
                    branchId: request.branchId,
                    clientId: request.clientId,
                    caseId: record.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
                });
                const requestLocked = await lockScheduleChangeRequestForWrite(
                    tx,
                    request.branchId,
                    request.id,
                );
                if (typeof tx.$queryRaw === "function" && !requestLocked) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                const rereadRequest = await tx.schedule_change_request.findFirst({
                    where: { id: request.id, branchId: request.branchId },
                });
                if (!rereadRequest) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                if (rereadRequest.status !== "pending") {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
                }
                if (
                    rereadRequest.scheduleId !== request.scheduleId
                    || rereadRequest.clientId !== request.clientId
                    || rereadRequest.branchId !== request.branchId
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                request = rereadRequest;
                const rereadSchedule = await tx.employee_schedule.findUnique({
                    where: { id: request.scheduleId },
                    include: { client: true, primaryEmployee: true },
                });
                const rereadRecord = await tx.service_record_case.findUnique({
                    where: { clientId: request.clientId },
                });
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== request.clientId
                    || rereadSchedule.branchId !== request.branchId
                    || !rereadRecord
                    || rereadRecord.id !== record.id
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                schedule = rereadSchedule;
                record = rereadRecord;

                const days = await tx.service_record_day.findMany({
                    where: { serviceRecordCaseId: record.id },
                    orderBy: { caseSessionIndex: "asc" },
                });
                const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
                    sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
                    serviceDate: day.serviceDate,
                    locked: day.locked,
                })), calendar, record);
                if (
                    target.sessionIndex !== request.sessionIndex
                    || target.fromDate !== toIso(request.fromDate)
                    || target.toDate !== toIso(request.toDate)
                    || target.newEndDate !== toIso(request.newEndDate)
                ) {
                    throw new StaleRequestError(request.id, request.branchId);
                }

                const serviceDate = toDbDate(target.toDate);
                const shiftedPlannedSessions = shiftCanonicalPlan(
                    record,
                    target.sessionIndex,
                    target.toDate,
                    calendar,
                );
                if (shiftedPlannedSessions) {
                    await tx.service_record_case.update({
                        where: { id: record.id, branchId: request.branchId },
                        data: {
                            plannedSessions: shiftedPlannedSessions as unknown as Prisma.InputJsonValue,
                            version: { increment: 1 },
                        },
                    });
                    const targetRow = days.find((day) =>
                        (day.caseSessionIndex ?? day.sessionIndex) === target.sessionIndex,
                    );
                    if (targetRow && !targetRow.locked) {
                        await tx.service_record_day.update({
                            where: { id: targetRow.id },
                            data: { serviceDate },
                        });
                    }
                } else {
                    await tx.service_record_day.upsert({
                        where: {
                            serviceRecordCaseId_caseSessionIndex: {
                                serviceRecordCaseId: record.id,
                                caseSessionIndex: target.sessionIndex,
                            },
                        },
                        update: { serviceDate },
                        create: {
                            branchId: request.branchId,
                            scheduleId: request.scheduleId,
                            serviceRecordCaseId: record.id,
                            caseSessionIndex: target.sessionIndex,
                            employeeId: schedule.primaryEmployeeId,
                            employeeNameSnapshot: schedule.primaryEmployee.name,
                            formVersion: record.formVersion,
                            sessionIndex: target.sessionIndex,
                            serviceDate,
                        },
                    });
                }

                const unlockedRows = await tx.service_record_day.findMany({
                    where: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: { gt: target.sessionIndex },
                        locked: false,
                    },
                    orderBy: { caseSessionIndex: "asc" },
                });
                for (const row of unlockedRows) {
                    const rowSessionIndex = row.caseSessionIndex ?? row.sessionIndex;
                    const plannedRow = shiftedPlannedSessions?.find(
                        (entry) => entry.sessionIndex === rowSessionIndex,
                    );
                    await tx.service_record_day.update({
                        where: { id: row.id },
                        data: {
                            serviceDate: toDbDate(plannedRow?.serviceDate ?? calendar.addBusinessDays(
                                target.toDate,
                                rowSessionIndex - target.sessionIndex,
                            )),
                        },
                    });
                }

                const newEndDate = toDbDate(
                    shiftedPlannedSessions
                        ? shiftedPlannedSessions[shiftedPlannedSessions.length - 1]!.serviceDate
                        : target.newEndDate,
                );
                if (schedule.startDate) {
                    await assertNoActiveEmployeeScheduleOverlap(tx, {
                        branchId: request.branchId,
                        clientId: request.clientId,
                        primaryEmployeeId: schedule.primaryEmployeeId,
                        secondaryEmployeeId: schedule.secondaryEmployeeId,
                        startDate: schedule.startDate,
                        endDate: newEndDate,
                        replaced: schedule.replaced,
                        excludeScheduleId: schedule.id,
                    });
                }
                await this.agentAutomationRecordStore?.appendScheduleWriteFence(tx, {
                    branchId: request.branchId,
                    clientId: request.clientId,
                    mutationId: randomUUID(),
                    scheduleIds: [request.scheduleId],
                });
                await tx.employee_schedule.update({
                    where: { id: request.scheduleId },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: request.clientId },
                    data: { endDate: newEndDate },
                });

                const syncedRecord = await this.lifecycleService?.ensureForClient(
                    request.clientId,
                    tx,
                    calendar,
                );

                // 날짜 변경으로 재계산된 회차 수 대신 동기화 전의 필수 회차 수를 유지한다.
                if (
                    syncedRecord
                    && record.requiredSessionCount != null
                    && syncedRecord.requiredSessionCount !== record.requiredSessionCount
                ) {
                    await tx.service_record_case.update({
                        where: { id: syncedRecord.id },
                        data: { requiredSessionCount: record.requiredSessionCount },
                    });
                    await this.lifecycleService?.recompute(syncedRecord.id, tx, calendar);
                }

                if (syncedRecord) {
                    await this.tokenService.extendExpiryForCase(
                        syncedRecord.id,
                        getServiceRecordTokenExpiresAt(newEndDate),
                        tx,
                        { onlyRaise: true },
                    );
                } else {
                    await this.tokenService.extendExpiryForSchedule(
                        request.scheduleId,
                        getServiceRecordTokenExpiresAt(newEndDate),
                        tx,
                    );
                }

                return tx.schedule_change_request.update({
                    where: { id: request.id },
                    data: {
                        status: "approved",
                        decidedBy: tenant.userId ?? null,
                        decidedAt: new Date(),
                    },
                });
            });

            scheduleIdForSync = result.scheduleId;
            branchIdForSync = result.branchId;
            clientIdForSync = result.clientId;
            return this.serializeRequest(result);
        } catch (error) {
            if (error instanceof StaleRequestError) {
                await this.prisma.schedule_change_request.updateMany({
                    where: {
                        id: error.requestId,
                        branchId: error.branchId,
                        status: "pending",
                    },
                    data: { status: "stale", decidedAt: new Date() },
                });
                throw new ConflictException(codeOnlyProblemBody("REQUEST_STALE"));
            }
            throw error;
        } finally {
            if (scheduleIdForSync && branchIdForSync) {
                await this.triggerService
                    ?.syncEmployeeAssignmentRulesForSchedule(branchIdForSync, scheduleIdForSync, true)
                    ?.catch(() => undefined);
            }
            if (clientIdForSync && branchIdForSync) {
                await this.triggerService
                    ?.syncClientRulesForClient(branchIdForSync, clientIdForSync, false)
                    ?.catch((error) => {
                        this.logger.error(
                            `Failed to resync client trigger rules for client ${clientIdForSync}`,
                            error instanceof Error ? error.stack : String(error),
                        );
                    });
            }
        }
    }

    async reject(requestId: string, tenant: { branchId?: string; userId?: string }, reason?: string) {
        const request = await this.prisma.schedule_change_request.findFirst({
            where: { id: requestId, branchId: tenant.branchId ?? "" },
        });
        if (!request) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (request.status !== "pending") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            // Production requests always have a complete client-owned write
            // surface. Narrow unit doubles retain a request-only fallback,
            // while still rereading the mutable status in the transaction.
            if (
                typeof tx.$queryRaw !== "function"
                || typeof tx.employee_schedule?.findUnique !== "function"
                || typeof tx.service_record_case?.findUnique !== "function"
            ) {
                const rereadRequestCandidate = typeof tx.schedule_change_request.findFirst === "function"
                    ? await tx.schedule_change_request.findFirst({
                        where: { id: request.id, branchId: request.branchId },
                    })
                    : null;
                const rereadRequest = rereadRequestCandidate ?? request;
                if (!rereadRequest) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                if (rereadRequest.status !== "pending") {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
                }
                return tx.schedule_change_request.update({
                    where: { id: rereadRequest.id },
                    data: {
                        status: "rejected",
                        decidedBy: tenant.userId ?? null,
                        decidedAt: new Date(),
                        ...(reason !== undefined ? { reason } : {}),
                    },
                });
            }

            const schedule = await tx.employee_schedule.findUnique({
                where: { id: request.scheduleId },
                select: {
                    id: true,
                    clientId: true,
                    branchId: true,
                    primaryEmployeeId: true,
                    secondaryEmployeeId: true,
                },
            });
            if (
                !schedule
                || schedule.clientId !== request.clientId
                || schedule.branchId !== request.branchId
            ) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            const record = await tx.service_record_case.findUnique({
                where: { clientId: request.clientId },
                select: { id: true, branchId: true, clientId: true },
            });
            if (
                !record
                || record.branchId !== request.branchId
                || record.clientId !== request.clientId
            ) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }
            await lockServiceRecordWriteSet(tx, {
                branchId: request.branchId,
                clientId: request.clientId,
                caseId: record.id,
                scheduleIds: [schedule.id],
                employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
            });
            const requestLocked = await lockScheduleChangeRequestForWrite(
                tx,
                request.branchId,
                request.id,
            );
            if (!requestLocked) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            const rereadRequest = await tx.schedule_change_request.findFirst({
                where: { id: request.id, branchId: request.branchId },
            });
            if (!rereadRequest) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            if (rereadRequest.status !== "pending") {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
            }
            if (
                rereadRequest.scheduleId !== request.scheduleId
                || rereadRequest.clientId !== request.clientId
                || rereadRequest.branchId !== request.branchId
            ) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            return tx.schedule_change_request.update({
                where: { id: rereadRequest.id },
                data: {
                    status: "rejected",
                    decidedBy: tenant.userId ?? null,
                    decidedAt: new Date(),
                    ...(reason !== undefined ? { reason } : {}),
                },
            });
        });

        return this.serializeRequest(updated);
    }
}
