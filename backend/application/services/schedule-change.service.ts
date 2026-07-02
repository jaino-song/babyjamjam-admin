import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { getServiceFeedbackTokenExpiresAt } from "domain/constants/service-feedback-link-message";
import { addBusinessDaysKr, isBusinessDayKr, nextBusinessDayKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AlimtalkTriggerService } from "./alimtalk-trigger.service";
import {
    EmployeeFeedbackTokenService,
    FeedbackTokenContext,
} from "./employee-feedback-token.service";

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function toDbDate(iso: string): Date {
    return new Date(iso + "T00:00:00.000Z");
}

class StaleRequestError extends Error {
    constructor(public readonly requestId: string) {
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: EmployeeFeedbackTokenService,
        @Optional() private readonly triggerService?: AlimtalkTriggerService,
    ) {}

    private computeTarget(
        schedule: ScheduleForChange,
        client: ClientForChange,
        days: ServiceRecordDayForChange[],
    ): { sessionIndex: number; fromDate: string; toDate: string; newEndDate: string } {
        const totalSessions = client.duration;
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
        if (currentRow) {
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

    async preview(ctx: FeedbackTokenContext): Promise<{ sessionIndex: number; fromDate: string; toDate: string }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");

        const days = await this.prisma.service_record_day.findMany({
            where: { scheduleId: ctx.scheduleId },
            orderBy: { sessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days);

        return {
            sessionIndex: target.sessionIndex,
            fromDate: target.fromDate,
            toDate: target.toDate,
        };
    }

    async createRequest(ctx: FeedbackTokenContext): Promise<{ id: string; sessionIndex: number; fromDate: string; toDate: string }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");

        const existing = await this.prisma.schedule_change_request.findFirst({
            where: { scheduleId: ctx.scheduleId, status: "pending" },
        });
        if (existing) {
            throw new ConflictException({ code: "REQUEST_ALREADY_PENDING" });
        }

        const days = await this.prisma.service_record_day.findMany({
            where: { scheduleId: ctx.scheduleId },
            orderBy: { sessionIndex: "asc" },
        });
        const target = this.computeTarget(schedule, schedule.client, days);
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

    async approve(requestId: string, tenant: { branchId?: string; userId?: string }) {
        let scheduleIdForSync: number | null = null;
        let branchIdForSync: string | null = null;

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const request = await tx.schedule_change_request.findFirst({
                    where: { id: requestId, branchId: tenant.branchId ?? "" },
                });
                if (!request) throw new NotFoundException("Schedule change request not found");
                if (request.status !== "pending") {
                    throw new ConflictException({ code: "REQUEST_NOT_PENDING" });
                }

                const schedule = await tx.employee_schedule.findUnique({
                    where: { id: request.scheduleId },
                    include: { client: true },
                });
                if (!schedule) throw new NotFoundException("Assignment not found");

                const days = await tx.service_record_day.findMany({
                    where: { scheduleId: request.scheduleId },
                    orderBy: { sessionIndex: "asc" },
                });
                const target = this.computeTarget(schedule, schedule.client, days);
                if (target.sessionIndex !== request.sessionIndex || target.fromDate !== toIso(request.fromDate)) {
                    throw new StaleRequestError(request.id);
                }

                const serviceDate = toDbDate(target.toDate);
                await tx.service_record_day.upsert({
                    where: {
                        scheduleId_sessionIndex: {
                            scheduleId: request.scheduleId,
                            sessionIndex: target.sessionIndex,
                        },
                    },
                    update: { serviceDate },
                    create: {
                        branchId: request.branchId,
                        scheduleId: request.scheduleId,
                        sessionIndex: target.sessionIndex,
                        serviceDate,
                    },
                });

                const unlockedRows = await tx.service_record_day.findMany({
                    where: {
                        scheduleId: request.scheduleId,
                        sessionIndex: { gt: target.sessionIndex },
                        locked: false,
                    },
                    orderBy: { sessionIndex: "asc" },
                });
                for (const row of unlockedRows) {
                    await tx.service_record_day.update({
                        where: { id: row.id },
                        data: {
                            serviceDate: toDbDate(
                                addBusinessDaysKr(target.toDate, row.sessionIndex - target.sessionIndex),
                            ),
                        },
                    });
                }

                const newEndDate = toDbDate(target.newEndDate);
                await tx.employee_schedule.update({
                    where: { id: request.scheduleId },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: request.clientId },
                    data: { endDate: newEndDate },
                });

                await this.tokenService.extendExpiryForSchedule(
                    request.scheduleId,
                    getServiceFeedbackTokenExpiresAt(newEndDate),
                    tx,
                );

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
            return this.serializeRequest(result);
        } catch (error) {
            if (error instanceof StaleRequestError) {
                await this.prisma.schedule_change_request.update({
                    where: { id: error.requestId },
                    data: { status: "stale", decidedAt: new Date() },
                });
                throw new ConflictException({ code: "REQUEST_STALE" });
            }
            throw error;
        } finally {
            if (scheduleIdForSync && branchIdForSync) {
                this.triggerService
                    ?.syncEmployeeAssignmentRulesForSchedule(branchIdForSync, scheduleIdForSync, true)
                    ?.catch(() => undefined);
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

        const updated = await this.prisma.schedule_change_request.update({
            where: { id: request.id },
            data: {
                status: "rejected",
                decidedBy: tenant.userId ?? null,
                decidedAt: new Date(),
                ...(reason !== undefined ? { reason } : {}),
            },
        });

        return this.serializeRequest(updated);
    }
}
