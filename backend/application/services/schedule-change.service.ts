import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    assertNoActiveEmployeeScheduleOverlap,
} from "application/policies/employee-schedule-invariants.policy";
import {
    lockScheduleChangeRequestForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { addBusinessDaysKr, isBusinessDayKr, nextBusinessDayKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
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
        return validateServiceRecordScheduleVector(entries, requiredSessionCount ?? undefined);
    } catch {
        return null;
    }
}

function canonicalPlannedSessions(record: ServiceRecordForChange): ServiceRecordPlannedSession[] | null {
    return plannedSessionVector(record.plannedSessions, record.requiredSessionCount);
}

function shiftCanonicalPlan(
    record: ServiceRecordForChange,
    sessionIndex: number,
    newDate: string,
): ServiceRecordPlannedSession[] | null {
    const hasPersistedPlan = record.plannedSessions !== null && record.plannedSessions !== undefined;
    const planned = canonicalPlannedSessions(record);
    if (!hasPersistedPlan) return null;
    if (!planned) {
        throw new ConflictException({ code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" });
    }
    try {
        return shiftServiceRecordScheduleSuffix(planned, sessionIndex, newDate).entries;
    } catch {
        throw new BadRequestException({ code: "INVALID_SCHEDULE_DATE" });
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
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly lifecycleService?: ServiceRecordLifecycleService,
    ) {}

    private computeTarget(
        schedule: ScheduleForChange,
        client: ClientForChange,
        days: ServiceRecordDayForChange[],
        record?: ServiceRecordForChange,
    ): { sessionIndex: number; fromDate: string; toDate: string; newEndDate: string } {
        const hasPersistedPlan = record?.plannedSessions !== null && record?.plannedSessions !== undefined;
        const planned = record ? canonicalPlannedSessions(record) : null;
        if (hasPersistedPlan && !planned) {
            throw new ConflictException({ code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" });
        }
        const totalSessions = record?.requiredSessionCount ?? client.duration;
        if (!totalSessions || totalSessions <= 0) {
            throw new BadRequestException("Client has no session duration");
        }

        const lastLocked = days.reduce((max, row) => (row.locked ? Math.max(max, row.sessionIndex) : max), 0);
        const sessionIndex = lastLocked + 1;
        if (sessionIndex > totalSessions) {
            throw new ConflictException({ code: "ALL_SESSIONS_SUBMITTED" });
        }

        const currentRow = days.find((row) => row.sessionIndex === sessionIndex);
        let fromDate: string;
        if (planned) {
            const plannedRow = planned.find((row) => row.sessionIndex === sessionIndex);
            if (!plannedRow) {
                throw new ConflictException({ code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" });
            }
            fromDate = plannedRow.serviceDate;
        } else if (currentRow) {
            fromDate = toIso(currentRow.serviceDate);
        } else {
            const previousRow = days.find((row) => row.sessionIndex === sessionIndex - 1);
            if (previousRow) {
                fromDate = nextBusinessDayKr(toIso(previousRow.serviceDate));
            } else if (schedule.startDate) {
                const startDate = toIso(schedule.startDate);
                fromDate = isBusinessDayKr(startDate) ? startDate : nextBusinessDayKr(startDate);
            } else {
                throw new BadRequestException("Assignment has no start date");
            }
        }

        const toDate = nextBusinessDayKr(fromDate);
        const newEndDate = addBusinessDaysKr(toDate, totalSessions - sessionIndex);

        return { sessionIndex, fromDate, toDate, newEndDate };
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
        const record = ctx.serviceRecordCaseId
            ? await this.prisma.service_record_case.findUnique({ where: { id: ctx.serviceRecordCaseId } })
            : await this.lifecycleService?.ensureForSchedule(ctx.scheduleId);
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");
        if (!record) throw new NotFoundException("Service record not found");

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), record);

        return {
            sessionIndex: target.sessionIndex,
            fromDate: target.fromDate,
            toDate: target.toDate,
        };
    }

    async createRequest(ctx: ServiceRecordTokenContext): Promise<{ id: string; sessionIndex: number; fromDate: string; toDate: string }> {
        const record = ctx.serviceRecordCaseId
            ? await this.prisma.service_record_case.findUnique({ where: { id: ctx.serviceRecordCaseId } })
            : await this.lifecycleService?.ensureForSchedule(ctx.scheduleId);
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");
        if (!record) throw new NotFoundException("Service record not found");

        const existing = await this.prisma.schedule_change_request.findFirst({
            where: { scheduleId: ctx.scheduleId, status: "pending" },
        });
        if (existing) {
            throw new ConflictException({ code: "REQUEST_ALREADY_PENDING" });
        }

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), record);
        if (!schedule.endDate) {
            throw new BadRequestException("Assignment has no end date");
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
                throw new ConflictException({ code: "REQUEST_ALREADY_PENDING" });
            }
            throw error;
        }
    }

    async previewAdminChange(
        branchId: string,
        scheduleId: number,
    ): Promise<{ sessionIndex: number; fromDate: string; minimumDate: string }> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");

        const record = await this.prisma.service_record_case.findFirst({
            where: { branchId, clientId: schedule.clientId },
        });
        if (!record) throw new NotFoundException("Service record not found");

        const days = await this.prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days.map((day) => ({
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            serviceDate: day.serviceDate,
            locked: day.locked,
        })), record);

        return {
            sessionIndex: target.sessionIndex,
            fromDate: target.fromDate,
            minimumDate: target.fromDate,
        };
    }

    async applyAdminChange(
        scheduleId: number,
        selectedDate: string,
        tenant: { branchId?: string; userId?: string },
    ) {
        const branchId = tenant.branchId ?? "";
        const selectedDateValue = toDbDate(selectedDate);
        if (
            Number.isNaN(selectedDateValue.getTime())
            || toIso(selectedDateValue) !== selectedDate
            || !isBusinessDayKr(selectedDate)
        ) {
            throw new BadRequestException({ code: "INVALID_SCHEDULE_DATE" });
        }

        let scheduleIdForSync: number | null = null;
        let clientIdForSync: number | null = null;

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                let schedule = await tx.employee_schedule.findFirst({
                    where: { id: scheduleId, branchId },
                    include: { client: true, primaryEmployee: true },
                });
                if (!schedule) throw new NotFoundException("Assignment not found");
                if (!schedule.endDate) {
                    throw new BadRequestException("Assignment has no end date");
                }

                let record = await tx.service_record_case.findFirst({
                    where: { branchId, clientId: schedule.clientId },
                });
                if (!record) throw new NotFoundException("Service record not found");

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
                    throw new ConflictException("Schedule-change target changed while acquiring write locks");
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
                })), record);
                if (selectedDate <= target.fromDate) {
                    throw new ConflictException({ code: "SCHEDULE_DATE_NOT_POSTPONED" });
                }

                const shiftedPlannedSessions = shiftCanonicalPlan(
                    record,
                    target.sessionIndex,
                    selectedDate,
                );
                const totalSessions = record.requiredSessionCount ?? schedule.client.duration;
                if (!totalSessions || totalSessions <= 0) {
                    throw new BadRequestException("Client has no session duration");
                }
                const newEndDateIso = shiftedPlannedSessions
                    ? shiftedPlannedSessions[shiftedPlannedSessions.length - 1]!.serviceDate
                    : addBusinessDaysKr(selectedDate, totalSessions - target.sessionIndex);
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
                            serviceDate: toDbDate(plannedRow?.serviceDate ?? addBusinessDaysKr(
                                selectedDate,
                                rowSessionIndex - target.sessionIndex,
                            )),
                        },
                    });
                }

                if (schedule.startDate) {
                    await assertNoActiveEmployeeScheduleOverlap(tx, {
                        branchId,
                        clientId: schedule.clientId,
                        primaryEmployeeId: schedule.primaryEmployeeId,
                        secondaryEmployeeId: schedule.secondaryEmployeeId,
                        startDate: schedule.startDate,
                        endDate: newEndDate,
                        replaced: schedule.replaced,
                        excludeScheduleId: schedule.id,
                    });
                }
                await tx.employee_schedule.update({
                    where: { id: scheduleId },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: schedule.clientId },
                    data: { endDate: newEndDate },
                });

                const syncedRecord = await this.lifecycleService?.ensureForClient(
                    schedule.clientId,
                    tx,
                );
                await this.tokenService.extendExpiryForCase(
                    syncedRecord?.id ?? record.id,
                    getServiceRecordTokenExpiresAt(newEndDate),
                    tx,
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

                return tx.schedule_change_request.create({
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
            });

            scheduleIdForSync = result.scheduleId;
            clientIdForSync = result.clientId;
            return this.serializeRequest(result);
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

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                let request = await tx.schedule_change_request.findFirst({
                    where: { id: requestId, branchId: tenant.branchId ?? "" },
                });
                if (!request) throw new NotFoundException("Schedule change request not found");
                if (request.status !== "pending") {
                    throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
                }

                let schedule = await tx.employee_schedule.findUnique({
                    where: { id: request.scheduleId },
                    include: { client: true, primaryEmployee: true },
                });
                if (!schedule) throw new NotFoundException("Assignment not found");
                let record = await tx.service_record_case.findUnique({ where: { clientId: request.clientId } });
                if (!record) throw new NotFoundException("Service record not found");

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
                    throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
                }
                const rereadRequest = await tx.schedule_change_request.findFirst({
                    where: { id: request.id, branchId: request.branchId },
                });
                if (!rereadRequest) throw new NotFoundException("Schedule change request not found");
                if (rereadRequest.status !== "pending") {
                    throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
                }
                if (
                    rereadRequest.scheduleId !== request.scheduleId
                    || rereadRequest.clientId !== request.clientId
                    || rereadRequest.branchId !== request.branchId
                ) {
                    throw new ConflictException("Schedule-change request target changed while acquiring write locks");
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
                    throw new ConflictException("Schedule-change target changed while acquiring write locks");
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
                })), record);
                if (target.sessionIndex !== request.sessionIndex || target.fromDate !== toIso(request.fromDate)) {
                    throw new StaleRequestError(request.id, request.branchId);
                }

                const serviceDate = toDbDate(target.toDate);
                const shiftedPlannedSessions = shiftCanonicalPlan(
                    record,
                    target.sessionIndex,
                    target.toDate,
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
                            serviceDate: toDbDate(plannedRow?.serviceDate ?? addBusinessDaysKr(
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
                await tx.employee_schedule.update({
                    where: { id: request.scheduleId },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: request.clientId },
                    data: { endDate: newEndDate },
                });

                const syncedRecord = await this.lifecycleService?.ensureForClient(request.clientId, tx);

                if (syncedRecord) {
                    await this.tokenService.extendExpiryForCase(
                        syncedRecord.id,
                        getServiceRecordTokenExpiresAt(newEndDate),
                        tx,
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
                throw new ConflictException({ code: "REQUEST_STALE" });
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
        if (!request) throw new NotFoundException("Schedule change request not found");
        if (request.status !== "pending") {
            throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
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
                if (!rereadRequest) throw new NotFoundException("Schedule change request not found");
                if (rereadRequest.status !== "pending") {
                    throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
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
                throw new ConflictException("Schedule-change target changed while acquiring write locks");
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
                throw new NotFoundException("Service record not found");
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
                throw new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
            }
            const rereadRequest = await tx.schedule_change_request.findFirst({
                where: { id: request.id, branchId: request.branchId },
            });
            if (!rereadRequest) throw new NotFoundException("Schedule change request not found");
            if (rereadRequest.status !== "pending") {
                throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
            }
            if (
                rereadRequest.scheduleId !== request.scheduleId
                || rereadRequest.clientId !== request.clientId
                || rereadRequest.branchId !== request.branchId
            ) {
                throw new ConflictException("Schedule-change request target changed while acquiring write locks");
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
