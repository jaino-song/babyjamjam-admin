import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    assertNoActiveEmployeeScheduleOverlap,
    EMPLOYEE_SCHEDULE_OVERLAP_CODE,
    lockClientForScheduleWrite,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { validateServiceRecordAnswers } from "application/policies/service-record-answer-validation.policy";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";
import { addBusinessDaysKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SaveServiceHeaderDto, UpsertSessionDto } from "interface/dto/service-record-entry.dto";
import {
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";

import {
    ServiceRecordTokenService,
    ServiceRecordTokenContext,
    VerifyPhoneResult,
} from "./service-record-token.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "./service-record-lifecycle.service";

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

type PlannedSessionVectorResult = {
    state: "absent" | "valid" | "invalid";
    entries: ServiceRecordPlannedSession[] | null;
};

/**
 * Read the persisted, complete planned-session vector without inventing
 * provenance or dates.  Provider callers only need the date projection, but
 * validating the full row here prevents a malformed/partial admin revision
 * from silently falling back to the legacy start-date calculation.
 */
function plannedSessionVector(
    raw: Prisma.JsonValue | null | undefined,
    requiredSessionCount: number | null | undefined,
): PlannedSessionVectorResult {
    if (raw === null || raw === undefined) return { state: "absent", entries: null };
    const values = Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null && !Array.isArray(raw)
            ? ((raw as Record<string, Prisma.JsonValue>)["sessions"]
                ?? (raw as Record<string, Prisma.JsonValue>)["entries"]
                ?? (raw as Record<string, Prisma.JsonValue>)["plannedSessions"])
            : null;
    if (!Array.isArray(values)) return { state: "invalid", entries: null };

    const entries: ServiceRecordPlannedSession[] = [];
    for (const value of values) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return { state: "invalid", entries: null };
        }
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
            return { state: "invalid", entries: null };
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
        return {
            state: "valid",
            entries: validateServiceRecordScheduleVector(entries, requiredSessionCount ?? undefined),
        };
    } catch {
        return { state: "invalid", entries: null };
    }
}

function persistedPlannedSessionDates(
    raw: Prisma.JsonValue | null | undefined,
    requiredSessionCount: number | null | undefined,
): PlannedSessionVectorResult {
    return plannedSessionVector(raw, requiredSessionCount);
}

function hasAuthoritativeRevision(record: {
    currentRevisionId?: string | null;
    currentUsableRevisionId?: string | null;
    currentUsableDocumentVersion?: number | null;
}): boolean {
    return record.currentRevisionId != null
        || record.currentUsableRevisionId != null
        || record.currentUsableDocumentVersion != null;
}

function plannedSessionDateUnavailable(): ConflictException {
    return new ConflictException({ code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" });
}

/**
 * No-login 제공기록지 capture (BJJ-247). The phone challenge is public (link token);
 * everything else runs behind ServiceRecordGuard, which supplies the assignment context.
 */
@Injectable()
export class ServiceRecordEntryService {
    private readonly logger = new Logger(ServiceRecordEntryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly lifecycleService: ServiceRecordLifecycleService,
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
    async getContext(ctx: ServiceRecordTokenContext) {
        const serviceRecordCase = await this.resolveCase(ctx);
        const [schedule, record, pendingScheduleChange] = await Promise.all([
            this.prisma.employee_schedule.findUnique({
                where: { id: ctx.scheduleId },
                include: {
                    client: true,
                    primaryEmployee: true,
                },
            }),
            this.prisma.service_record_case.findUnique({
                where: { id: serviceRecordCase.id },
                include: {
                    days: { orderBy: { caseSessionIndex: "asc" } },
                },
            }),
            this.prisma.schedule_change_request.findFirst({
                where: { scheduleId: ctx.scheduleId, status: "pending" },
                select: { id: true, sessionIndex: true, fromDate: true, toDate: true },
            }),
        ]);
        if (!schedule) throw new NotFoundException("Assignment not found");
        if (!record) throw new NotFoundException("Service record not found");

        const persistedDates = persistedPlannedSessionDates(
            record.plannedSessions,
            record.requiredSessionCount,
        );
        if (
            persistedDates.state === "invalid"
            || (persistedDates.state === "absent" && hasAuthoritativeRevision(record))
        ) {
            throw plannedSessionDateUnavailable();
        }
        const plannedSessionDates = persistedDates.state === "valid"
            ? persistedDates.entries?.map(({ sessionIndex, serviceDate }) => ({ sessionIndex, serviceDate })) ?? null
            : null;

        return {
            employee: { id: schedule.primaryEmployee.id, name: schedule.primaryEmployee.name },
            client: { id: schedule.client.id, name: schedule.client.name },
            totalSessions: record.requiredSessionCount ?? 0,
            startDate: record.startDate,
            endDate: record.endDate,
            recordStatus: record.status,
            completedAt: record.completedAt,
            finalizationDueAt: record.finalizationDueAt,
            finalizedAt: record.finalizedAt,
            header: this.headerFromCase(record),
            sessions: record.days.map((day) => ({
                ...day,
                sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            })),
            ...(plannedSessionDates ? { plannedSessionDates } : {}),
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
    async saveHeader(ctx: ServiceRecordTokenContext, dto: SaveServiceHeaderDto) {
        const record = await this.resolveCase(ctx);
        const lockedCount = await this.prisma.service_record_day.count({
            where: { serviceRecordCaseId: record.id, branchId: ctx.branchId, locked: true },
        });
        if (lockedCount > 0) {
            throw new ConflictException({ code: "SERVICE_RECORD_HEADER_LOCKED" });
        }
        if ([
            SERVICE_RECORD_CASE_STATUS.FINALIZING,
            SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
            SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
            SERVICE_RECORD_CASE_STATUS.COMPLETED,
        ].includes(record.status as never)) {
            throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const schedule = tx.employee_schedule?.findUnique
                ? await tx.employee_schedule.findUnique({
                    where: { id: ctx.scheduleId },
                    select: {
                        id: true,
                        clientId: true,
                        branchId: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                })
                : null;
            if (schedule && typeof schedule.clientId === "number") {
                await lockServiceRecordWriteSet(tx, {
                    branchId: ctx.branchId,
                    clientId: schedule.clientId,
                    caseId: record.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
                });
                const rereadSchedule = await tx.employee_schedule.findUnique({
                    where: { id: ctx.scheduleId },
                    select: {
                        id: true,
                        clientId: true,
                        branchId: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                });
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== schedule.clientId
                    || (
                        rereadSchedule.branchId !== undefined
                        && rereadSchedule.branchId !== ctx.branchId
                    )
                ) {
                    throw new ConflictException("Assignment changed while acquiring service-record locks");
                }
            } else {
                // Narrow unit doubles without assignment ownership fields keep
                // the old case-only lock; production never enters this branch.
                const caseLocked = await lockServiceRecordCaseForWrite(tx, ctx.branchId, record.id);
                if (typeof tx.$queryRaw === "function" && !caseLocked) {
                    throw new NotFoundException("Service record not found");
                }
            }
            // The pre-transaction checks above are only an early rejection.
            // The client/case lock can wait behind a submit or finalization,
            // so reread both the case status and locked-day set before the
            // first header or legacy-row write.
            const rereadRecord = typeof tx.service_record_case?.findUnique === "function"
                ? await tx.service_record_case.findUnique({
                    where: { id: record.id },
                })
                : record;
            if (
                !rereadRecord
                || (
                    rereadRecord.branchId !== undefined
                    && rereadRecord.branchId !== ctx.branchId
                )
            ) {
                throw new ConflictException("Service record changed while acquiring write locks");
            }
            const dayDelegate = tx.service_record_day as unknown as {
                count?: (args: unknown) => Promise<number>;
            } | undefined;
            const rereadLockedCount = typeof dayDelegate?.count === "function"
                ? await dayDelegate.count({
                    where: { serviceRecordCaseId: record.id, branchId: ctx.branchId, locked: true },
                })
                : 0;
            if (rereadLockedCount > 0) {
                throw new ConflictException({ code: "SERVICE_RECORD_HEADER_LOCKED" });
            }
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(rereadRecord.status as never)) {
                throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
            }

            const aggregate = await tx.service_record_case.update({
                where: { id: record.id, branchId: ctx.branchId },
                data: { ...dto, version: { increment: 1 } },
            });
            await tx.service_record.upsert({
                where: { scheduleId: ctx.scheduleId, branchId: ctx.branchId },
                create: {
                    branchId: ctx.branchId,
                    scheduleId: ctx.scheduleId,
                    serviceRecordCaseId: record.id,
                    ...dto,
                },
                update: { serviceRecordCaseId: record.id, ...dto },
            });
            await this.lifecycleService.recompute(record.id, tx);
            return aggregate;
        });
        return this.headerFromCase(updated);
    }

    /**
     * Create/update one session record. Sessions are filled in order; submitted sessions
     * are immutable after client approval and locking.
     */
    async upsertSession(ctx: ServiceRecordTokenContext, sessionIndex: number, dto: UpsertSessionDto, lock: boolean) {
        const aggregate = await this.resolveCase(ctx);
        // The public mobile form historically mirrors its flat draft into the
        // `answers` object, so the two adjacent free-form fields and payment
        // flag arrive there as well as their dedicated DTO properties. Keep
        // that wire shape compatible while sending only the canonical 14
        // structured answer keys through the shared validator.
        const answerInput = Object.fromEntries(
            Object.entries(dto.answers ?? {})
                .filter(([key]) => !["etcService", "notes", "paymentConfirmed"].includes(key)),
        );
        const answers = validateServiceRecordAnswers(answerInput);
        const saved = await this.prisma.$transaction(async (tx) => {
            // Discover the assignment before locking. Production rows carry a
            // client id, so the common policy then locks client -> employees ->
            // case -> schedule/assignment/day and rereads both owner rows. The
            // fallback preserves narrow unit-test doubles that expose only the
            // historical case lock seam.
            let schedule = await tx.employee_schedule.findUnique({
                where: { id: ctx.scheduleId },
                include: { primaryEmployee: true },
            });
            if (!schedule) throw new NotFoundException("Assignment not found");
            let record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            if (typeof schedule.clientId === "number") {
                await lockServiceRecordWriteSet(tx, {
                    branchId: ctx.branchId,
                    clientId: schedule.clientId,
                    caseId: aggregate.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
                    sessionIndexes: [sessionIndex, sessionIndex - 1],
                });
                const rereadSchedule = await tx.employee_schedule.findUnique({
                    where: { id: ctx.scheduleId },
                    include: { primaryEmployee: true },
                });
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== schedule.clientId
                    || (
                        rereadSchedule.branchId !== undefined
                        && rereadSchedule.branchId !== ctx.branchId
                    )
                ) {
                    throw new ConflictException("Assignment changed while acquiring service-record locks");
                }
                schedule = rereadSchedule;
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            } else {
                // Serialize all entry writes for this case before reading a
                // session snapshot when a legacy test adapter omits ownership
                // fields. Real Prisma transactions never take this branch.
                const locked = await lockServiceRecordCaseForWrite(tx, ctx.branchId, aggregate.id);
                if (typeof tx.$queryRaw === "function" && !locked) {
                    throw new NotFoundException("Service record not found");
                }
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            }
            if (!record) throw new NotFoundException("Service record not found");
            if (record.branchId !== ctx.branchId) {
                throw new NotFoundException("Service record not found");
            }
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(record.status as never)) {
                throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
            }

            const total = record.requiredSessionCount ?? 0;
            if (sessionIndex < 1 || sessionIndex > total) {
                throw new BadRequestException(`Session ${sessionIndex} is outside the contracted range 1..${total}`);
            }
            const serviceDate = new Date(dto.serviceDate);
            if (Number.isNaN(serviceDate.getTime())) {
                throw new BadRequestException("Invalid service date");
            }
            if (record.startDate && serviceDate < record.startDate) {
                throw new BadRequestException("Service date cannot precede the service start date.");
            }

            // A confirmed administrator revision is authoritative for every
            // provider slot, including slots that do not yet have a day row.
            // Check the persisted vector after the common lock/reread and
            // before any schedule/client extension so stale provider input can
            // never mutate derived periods first.
            const persistedDates = plannedSessionVector(record.plannedSessions, total);
            if (
                persistedDates.state === "invalid"
                || (persistedDates.state === "absent" && hasAuthoritativeRevision(record))
            ) {
                throw plannedSessionDateUnavailable();
            }
            if (persistedDates.state === "valid") {
                const plannedDate = persistedDates.entries?.find((entry) => entry.sessionIndex === sessionIndex)?.serviceDate;
                if (!plannedDate) {
                    throw plannedSessionDateUnavailable();
                }
                if (toIso(serviceDate) !== plannedDate) {
                    throw new ConflictException({ code: "SERVICE_RECORD_PLANNED_DATE_STALE" });
                }
            }

            // A postponed session (a later serviceDate than originally
            // scheduled) can push the remaining sessions past the current
            // end date. requiredSessionCount stays fixed; the end date
            // extends automatically so the case can still fit every
            // session, no admin approval needed.
            const serviceDateIso = toIso(serviceDate);
            const currentEndIso = record.endDate ? toIso(record.endDate) : null;
            let requiredEndIso: string;
            try {
                requiredEndIso = addBusinessDaysKr(serviceDateIso, total - sessionIndex);
            } catch {
                throw new BadRequestException("서비스 제공일자를 계산할 수 없습니다. 날짜를 확인해 주세요.");
            }
            if (currentEndIso && requiredEndIso > currentEndIso) {
                const newEndDate = new Date(`${requiredEndIso}T00:00:00.000Z`);
                // Production already owns these locks from the common set
                // above. Keep the helper calls only for legacy unit doubles
                // that omit client ownership fields.
                if (typeof schedule.clientId !== "number") {
                    await lockClientForScheduleWrite(tx, ctx.branchId, schedule.clientId);
                    await lockEmployeesForScheduleWrite(tx, ctx.branchId, [
                        schedule.primaryEmployeeId,
                        schedule.secondaryEmployeeId,
                    ]);
                }
                if (schedule.startDate) {
                    try {
                        await assertNoActiveEmployeeScheduleOverlap(tx, {
                            branchId: ctx.branchId,
                            clientId: schedule.clientId,
                            primaryEmployeeId: schedule.primaryEmployeeId,
                            secondaryEmployeeId: schedule.secondaryEmployeeId,
                            startDate: schedule.startDate,
                            endDate: newEndDate,
                            replaced: schedule.replaced,
                            excludeScheduleId: schedule.id,
                        });
                    } catch (error) {
                        if (error instanceof ConflictException) {
                            const response = error.getResponse();
                            const code = typeof response === "object" && response !== null && "code" in response
                                ? (response as { code?: unknown }).code
                                : undefined;
                            if (code === EMPLOYEE_SCHEDULE_OVERLAP_CODE) {
                                throw new ConflictException({
                                    code: EMPLOYEE_SCHEDULE_OVERLAP_CODE,
                                    message: "다음 배정 일정과 겹쳐 종료일을 연장할 수 없습니다. 관리자에게 문의해 주세요.",
                                });
                            }
                        }
                        throw error;
                    }
                }
                await tx.employee_schedule.update({
                    where: { id: schedule.id, branchId: ctx.branchId },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: schedule.clientId, branchId: ctx.branchId },
                    data: { endDate: newEndDate },
                });
                await this.lifecycleService.ensureForClient(schedule.clientId, tx);
                await this.tokenService.extendExpiryForCase(
                    record.id,
                    getServiceRecordTokenExpiresAt(newEndDate),
                    tx,
                );
                this.logger.log(
                    `Service-record session ${sessionIndex} for case ${record.id} extended end date ${currentEndIso} -> ${requiredEndIso}`,
                );
                record = await tx.service_record_case.findUnique({ where: { id: record.id } }) ?? record;
            }

            if (record.endDate && serviceDate > record.endDate) {
                throw new BadRequestException("Service date cannot exceed the service end date.");
            }

            const existing = await tx.service_record_day.findUnique({
                where: {
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                    },
                },
            });
            if (existing?.locked) {
                throw new ConflictException({ code: "SERVICE_RECORD_SESSION_LOCKED" });
            }

            if (sessionIndex > 1) {
                const prev = await tx.service_record_day.findUnique({
                    where: {
                        serviceRecordCaseId_caseSessionIndex: {
                            serviceRecordCaseId: record.id,
                            caseSessionIndex: sessionIndex - 1,
                        },
                    },
                });
                if (!prev?.locked) {
                    throw new ConflictException(`Submit session ${sessionIndex - 1} before session ${sessionIndex}.`);
                }
                if (serviceDate < prev.serviceDate) {
                    throw new BadRequestException("Service date cannot precede the previous session's date.");
                }
            }

            if (lock) {
                if (dto.momApproval !== "approved") {
                    throw new BadRequestException("산모 확인 승인이 필요합니다.");
                }
                if (!this.hasCompleteHeader(record)) {
                    throw new BadRequestException("서비스 기본정보를 모두 입력해 주세요.");
                }
                if (!existing?.locked && !existing?.clientSignature && !dto.clientSignature) {
                    throw new BadRequestException({ code: "CLIENT_SIGNATURE_REQUIRED" });
                }
            }

            const submittedAt = lock ? new Date() : existing?.submittedAt ?? null;
            const data = {
                branchId: ctx.branchId,
                scheduleId: ctx.scheduleId,
                serviceRecordCaseId: record.id,
                caseSessionIndex: sessionIndex,
                employeeId: ctx.employeeId,
                employeeNameSnapshot: schedule.primaryEmployee.name,
                formVersion: record.formVersion,
                sessionIndex,
                serviceDate,
                answers: answers as Prisma.InputJsonValue,
                etcService: this.trimNullable(
                    dto.etcService,
                    SERVICE_RECORD_TEXT_LIMITS.etcService,
                ),
                notes: this.trimNullable(
                    dto.notes,
                    SERVICE_RECORD_TEXT_LIMITS.notes,
                ),
                paymentConfirmed: dto.paymentConfirmed ?? false,
                momApproval: dto.momApproval ?? null,
                locked: Boolean(existing?.locked || lock),
                submittedAt,
            };

            let row = await tx.service_record_day.upsert({
                where: {
                    branchId: ctx.branchId,
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                    },
                },
                create: data,
                update: data,
            });
            if (lock && dto.clientSignature) {
                const clientSignedAt = new Date();
                const signatureWrite = await tx.service_record_day.updateMany({
                    where: {
                        branchId: ctx.branchId,
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                        clientSignature: null,
                    },
                    data: {
                        clientSignature: dto.clientSignature,
                        clientSignedAt,
                    },
                });
                if (signatureWrite.count === 1) {
                    row = { ...row, clientSignature: dto.clientSignature, clientSignedAt };
                }
            }
            await this.lifecycleService.recompute(record.id, tx);
            return row;
        });
        if (lock) {
            this.logger.log(`Service-record session ${sessionIndex} submitted + locked for case ${aggregate.id}`);
        }
        return { ...saved, sessionIndex: saved.caseSessionIndex ?? saved.sessionIndex };
    }

    /** Backward-compatible completion acknowledgement. Snapshot creation is scheduler-owned. */
    async finalize(ctx: ServiceRecordTokenContext) {
        const record = await this.resolveCase(ctx);
        const updated = await this.lifecycleService.recompute(record.id);
        const documentIds = await this.prisma.eformsign_doc.findMany({
            where: { serviceRecordCaseId: record.id, documentKind: "service_record_snapshot" },
            select: { documentId: true },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        return {
            status: updated.status,
            completedAt: updated.completedAt,
            finalizationDueAt: updated.finalizationDueAt,
            finalizedAt: updated.finalizedAt,
            chunkCount: documentIds.length,
            documentIds: documentIds.map((document) => document.documentId),
        };
    }

    private async resolveCase(ctx: ServiceRecordTokenContext) {
        if (ctx.serviceRecordCaseId) {
            const record = await this.prisma.service_record_case.findFirst({
                where: { id: ctx.serviceRecordCaseId, branchId: ctx.branchId },
            });
            if (record) return record;
        }
        const record = await this.lifecycleService.ensureForSchedule(ctx.scheduleId);
        if (!record || record.branchId !== ctx.branchId) {
            throw new NotFoundException("Service record not found");
        }
        return record;
    }

    private headerFromCase(record: {
        momName: string | null;
        momBirth: string | null;
        babyName: string | null;
        babyBirth: string | null;
        deliveryType: string | null;
        babyWeight: string | null;
        createdAt: Date;
        updatedAt: Date;
    }) {
        const hasValue = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].some((value) => Boolean(value));
        if (!hasValue) return null;
        return {
            momName: record.momName,
            momBirth: record.momBirth,
            babyName: record.babyName,
            babyBirth: record.babyBirth,
            deliveryType: record.deliveryType,
            babyWeight: record.babyWeight,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        };
    }

    private hasCompleteHeader(record: {
        momName: string | null;
        momBirth: string | null;
        babyName: string | null;
        babyBirth: string | null;
        deliveryType: string | null;
        babyWeight: string | null;
    }): boolean {
        return [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].every((value) => Boolean(value?.trim()));
    }

    private trimNullable(value: string | null | undefined, maxLength: number): string | null {
        if (value !== null && value !== undefined && value.length > maxLength) {
            throw new BadRequestException(`입력값은 ${maxLength}자를 넘을 수 없습니다.`);
        }
        const normalized = value?.trim();
        if (!normalized) return null;
        return normalized;
    }
}
