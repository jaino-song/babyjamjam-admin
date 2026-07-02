import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    EmployeeFeedbackTokenService,
    FeedbackTokenContext,
    VerifyPhoneResult,
} from "./employee-feedback-token.service";
import { SaveServiceHeaderDto, UpsertSessionDto } from "interface/dto/service-feedback.dto";
import { CreateAndSendFeedbackSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase";

const ORG = { name: "인천 아이미래로", hours: "평일 09시~18시" };

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * No-login 제공기록지 capture (BJJ-247). The phone challenge is public (link token);
 * everything else runs behind EmployeeFeedbackGuard, which supplies the assignment context.
 */
@Injectable()
export class ServiceFeedbackService {
    private readonly logger = new Logger(ServiceFeedbackService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: EmployeeFeedbackTokenService,
        private readonly snapshotUsecase: CreateAndSendFeedbackSnapshotUsecase,
    ) {}

    /** Is this SMS link still usable (before asking for the phone number)? No PII returned. */
    async linkStatus(linkToken: string): Promise<{ valid: boolean }> {
        return { valid: Boolean(await this.tokenService.resolveLink(linkToken)) };
    }

    /** Phone challenge → mint access token (or report wrong/locked). */
    async verify(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        return this.tokenService.verifyPhoneAndMintAccess(linkToken, phone);
    }

    /** Full wizard context: header + existing sessions + how many sessions are contracted. */
    async getContext(ctx: FeedbackTokenContext) {
        const [schedule, pendingScheduleChange] = await Promise.all([
            this.prisma.employee_schedule.findUnique({
                where: { id: ctx.scheduleId },
                include: {
                    client: true,
                    primaryEmployee: true,
                    serviceRecord: true,
                    serviceRecordDays: { orderBy: { sessionIndex: "asc" } },
                },
            }),
            this.prisma.schedule_change_request.findFirst({
                where: { scheduleId: ctx.scheduleId, status: "pending" },
                select: { id: true, sessionIndex: true, fromDate: true, toDate: true },
            }),
        ]);
        if (!schedule) throw new NotFoundException("Assignment not found");

        return {
            org: ORG,
            employee: { id: schedule.primaryEmployee.id, name: schedule.primaryEmployee.name },
            client: { id: schedule.client.id, name: schedule.client.name },
            totalSessions: schedule.client.duration ?? 0,
            startDate: schedule.startDate,
            header: schedule.serviceRecord ?? null,
            sessions: schedule.serviceRecordDays,
            pendingScheduleChange: pendingScheduleChange
                ? {
                    id: pendingScheduleChange.id,
                    sessionIndex: pendingScheduleChange.sessionIndex,
                    fromDate: toIso(pendingScheduleChange.fromDate),
                    toDate: toIso(pendingScheduleChange.toDate),
                }
                : null,
        };
    }

    /** Upsert the one-time service header. */
    async saveHeader(ctx: FeedbackTokenContext, dto: SaveServiceHeaderDto) {
        return this.prisma.service_record.upsert({
            where: { scheduleId: ctx.scheduleId },
            create: { branchId: ctx.branchId, scheduleId: ctx.scheduleId, ...dto },
            update: { ...dto },
        });
    }

    /**
     * Create/update one session record. Sessions are filled in order; a submitted (locked)
     * session is immutable; the service date is forward-only (skip-safe, no backdating).
     */
    async upsertSession(ctx: FeedbackTokenContext, sessionIndex: number, dto: UpsertSessionDto, lock: boolean) {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");

        const total = schedule.client.duration ?? 0;
        if (sessionIndex < 1 || sessionIndex > total) {
            throw new BadRequestException(`Session ${sessionIndex} is outside the contracted range 1..${total}`);
        }

        const serviceDate = new Date(dto.serviceDate);

        const existing = await this.prisma.service_record_day.findUnique({
            where: { scheduleId_sessionIndex: { scheduleId: ctx.scheduleId, sessionIndex } },
        });
        if (existing?.locked) {
            throw new ConflictException(`Session ${sessionIndex} has already been submitted and cannot be edited.`);
        }

        if (sessionIndex > 1) {
            const prev = await this.prisma.service_record_day.findUnique({
                where: { scheduleId_sessionIndex: { scheduleId: ctx.scheduleId, sessionIndex: sessionIndex - 1 } },
            });
            if (!prev?.locked) {
                throw new ConflictException(`Submit session ${sessionIndex - 1} before session ${sessionIndex}.`);
            }
            if (serviceDate < prev.serviceDate) {
                throw new BadRequestException("Service date cannot precede the previous session's date.");
            }
        } else if (schedule.startDate && serviceDate < schedule.startDate) {
            throw new BadRequestException("Service date cannot precede the assignment start date.");
        }

        const data = {
            branchId: ctx.branchId,
            scheduleId: ctx.scheduleId,
            sessionIndex,
            serviceDate,
            answers: (dto.answers ?? {}) as Prisma.InputJsonValue,
            etcService: dto.etcService ?? null,
            notes: dto.notes ?? null,
            paymentConfirmed: dto.paymentConfirmed ?? false,
            momSignature: dto.momSignature ?? null,
            locked: lock,
            submittedAt: lock ? new Date() : null,
        };

        const saved = await this.prisma.service_record_day.upsert({
            where: { scheduleId_sessionIndex: { scheduleId: ctx.scheduleId, sessionIndex } },
            create: data,
            update: data,
        });
        if (lock) {
            this.logger.log(`Service feedback session ${sessionIndex} submitted + locked for schedule ${ctx.scheduleId}`);
        }
        return saved;
    }

    /** Generate the eformsign snapshot of the whole record and SMS it to the 제공인력 to sign. */
    async finalize(ctx: FeedbackTokenContext) {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: ctx.scheduleId },
            include: { client: true, serviceRecordDays: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");

        const total = schedule.client.duration ?? 0;
        const lockedCount = schedule.serviceRecordDays.filter((d) => d.locked).length;
        if (total > 0 && lockedCount < total) {
            throw new BadRequestException(`아직 모든 회차가 제출되지 않았습니다 (${lockedCount}/${total}).`);
        }

        return this.snapshotUsecase.execute(ctx.branchId, ctx.scheduleId);
    }
}
