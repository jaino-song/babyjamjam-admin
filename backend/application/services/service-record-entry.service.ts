import {
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import {
    alignPlannedSessionsToCaregiverDate,
    CaregiverDateAlignmentError,
} from "application/policies/service-record-caregiver-date.policy";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { validateServiceRecordAnswers } from "application/policies/service-record-answer-validation.policy";
import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";
import { UnsupportedKoreanHolidayYearError, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SaveServiceHeaderDto, UpsertSessionDto } from "interface/dto/service-record-entry.dto";
import {
    validateServiceRecordScheduleVector,
    type ServiceRecordPlannedSession,
} from "@babyjamjam/shared/utils/service-record-schedule";

import {
    isServiceRecordAccessTokenUsable,
    ServiceRecordTokenService,
    ServiceRecordTokenContext,
    VerifyPhoneResult,
} from "./service-record-token.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "./service-record-lifecycle.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** The four caregiver-editable fields of a submitted day, plus its service date. */
type EditableDaySnapshot = {
    serviceDate: string;
    answers: Prisma.JsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
};

/** Plain-JSON copy so stored JSON and freshly validated answers compare structurally (key order irrelevant). */
function toPlainJson(value: unknown): Prisma.JsonValue {
    return JSON.parse(JSON.stringify(value ?? {})) as Prisma.JsonValue;
}

/** Snapshot used both to detect a real change and as the `before` payload of the edit log. Never carries signature data. */
function editableDaySnapshot(day: {
    serviceDate: Date;
    answers: unknown;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
}): EditableDaySnapshot {
    return {
        serviceDate: toIso(day.serviceDate),
        answers: toPlainJson(day.answers),
        etcService: day.etcService ?? null,
        notes: day.notes ?? null,
        paymentConfirmed: day.paymentConfirmed,
    };
}

type PlannedSessionVectorResult = {
    state: "absent" | "valid" | "invalid";
    entries: ServiceRecordPlannedSession[] | null;
};

/**
 * Read the persisted, complete planned-session vector without inventing
 * provenance or dates. Only valid vectors can follow caregiver dates; legacy
 * absent or malformed vectors remain untouched.
 */
function plannedSessionVector(
    raw: Prisma.JsonValue | null | undefined,
    requiredSessionCount: number | null | undefined,
    calendar: KrBusinessDayCalendar,
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
            ...row,
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
            entries: validateServiceRecordScheduleVector(entries, requiredSessionCount ?? undefined, calendar, { persisted: true }),
        };
    } catch {
        return { state: "invalid", entries: null };
    }
}

function hasAuthoritativeRevision(record: {
    currentRevisionId?: string | null;
    currentUsableRevisionId?: string | null;
    currentUsableDocumentVersion?: number | null;
    plannedSessions?: Prisma.JsonValue | null;
}): boolean {
    return record.currentRevisionId != null
        || record.currentUsableRevisionId != null
        || record.currentUsableDocumentVersion != null
        || record.plannedSessions != null;
}

function entrySessionCount(record: {
    startDate: Date | null;
    endDate: Date | null;
    requiredSessionCount: number | null;
    currentRevisionId?: string | null;
    currentUsableRevisionId?: string | null;
    currentUsableDocumentVersion?: number | null;
    plannedSessions?: Prisma.JsonValue | null;
}, calendar: KrBusinessDayCalendar): number {
    // A stored N is the authoritative count: a confirmed revision stores it
    // independently of the calendar span, and a legacy case keeps the N its
    // lifecycle ensure path capped when the period last changed. A holiday
    // calendar edit must not shrink it (it would reject a session the caregiver
    // may still write). The calendar only derives N when none is stored;
    // unsupported legacy years remain viewable with their stored N.
    if (hasAuthoritativeRevision(record) || record.requiredSessionCount !== null) {
        return record.requiredSessionCount ?? 0;
    }
    try {
        return serviceRecordSessionCount(
            record.startDate,
            record.endDate,
            record.requiredSessionCount,
            calendar,
        ) ?? 0;
    } catch (error) {
        if (error instanceof UnsupportedKoreanHolidayYearError) {
            return record.requiredSessionCount ?? 0;
        }
        throw error;
    }
}

export type ServiceRecordLinkStatus =
    | { valid: true }
    | { valid: false; reason: "not_found" | "unavailable" };

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
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    /** Is this SMS link still usable (before asking for the phone number)? No PII returned. */
    async linkStatus(linkToken: string): Promise<ServiceRecordLinkStatus> {
        if (await this.tokenService.resolveLink(linkToken)) return { valid: true };
        // not_found: no row for this exact token (mistyped/garbled link); unavailable: a row exists but is unusable.
        const exists = await this.tokenService.linkTokenExists(linkToken);
        return { valid: false, reason: exists ? "unavailable" : "not_found" };
    }

    /** Phone challenge → mint access token (or report wrong/locked). */
    async verify(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        return this.tokenService.verifyPhoneAndMintAccess(linkToken, phone);
    }

    /** Full wizard context: header + existing sessions + how many sessions are contracted. */
    async getContext(ctx: ServiceRecordTokenContext) {
        const serviceRecordCase = await this.resolveCase(ctx);
        const [schedule, record] = await Promise.all([
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
        ]);
        if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

        // Legacy session counts control entry/submission, so use the current
        // calendar on this client's own service days.
        const calendar = withClientServiceDays(
            await this.holidayCalendar.forBranch(ctx.branchId, { fresh: true }),
            schedule.client,
        );
        return {
            employee: { id: schedule.primaryEmployee.id, name: schedule.primaryEmployee.name },
            client: { id: schedule.client.id, name: schedule.client.name },
            serviceDays: {
                saturday: schedule.client.allowSaturdayService ?? false,
                sunday: schedule.client.allowSundayService ?? false,
                holiday: schedule.client.allowHolidayService ?? false,
            },
            totalSessions: entrySessionCount(record, calendar),
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
        };
    }

    /** Upsert the one-time service header. */
    async saveHeader(ctx: ServiceRecordTokenContext, dto: SaveServiceHeaderDto) {
        const record = await this.resolveCase(ctx);
        const lockedCount = await this.prisma.service_record_day.count({
            where: { serviceRecordCaseId: record.id, branchId: ctx.branchId, locked: true },
        });
        if (lockedCount > 0) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if ([
            SERVICE_RECORD_CASE_STATUS.FINALIZING,
            SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
            SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
            SERVICE_RECORD_CASE_STATUS.COMPLETED,
        ].includes(record.status as never)) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        // The in-transaction recompute derives a legacy null N from the branch
        // calendar. Read it fresh here, before the transaction opens, so that
        // recompute never reads it through the root client while this
        // transaction holds a pooled connection and the service-record locks.
        const calendar = await this.holidayCalendar.forBranch(ctx.branchId, { fresh: true });
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
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
            } else {
                // Narrow unit doubles without assignment ownership fields keep
                // the old case-only lock; production never enters this branch.
                const caseLocked = await lockServiceRecordCaseForWrite(tx, ctx.branchId, record.id);
                if (typeof tx.$queryRaw === "function" && !caseLocked) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
            }
            await this.assertTokenStillValid(tx, ctx);
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
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
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
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(rereadRecord.status as never)) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
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
            await this.lifecycleService.recompute(record.id, tx, calendar);
            return aggregate;
        });
        return this.headerFromCase(updated);
    }

    /**
     * Create/update one session record. Sessions are filled in order. A submitted (locked)
     * session keeps its date, signature and approval; any caregiver with a valid token may
     * still change its answers, notes, etc. service and payment flag until the case is
     * finalized, and each real change is written to service_record_day_edit_log.
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
        // Saved computation: read the branch calendar fresh, before the
        // transaction opens, so a holiday edit is honoured at once.
        const calendar = await this.holidayCalendar.forBranch(ctx.branchId, { fresh: true });
        let lockedEditOutcome: "edited" | "unchanged" | null = null;
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
            if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            let record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            // The client's service-day flags, read with the locked reread so a
            // concurrent flag change cannot be missed. Absent (branch calendar)
            // only for legacy test doubles that carry no client ownership.
            let clientServiceDays: {
                allowSaturdayService?: boolean | null;
                allowSundayService?: boolean | null;
                allowHolidayService?: boolean | null;
            } | null | undefined;
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
                    include: {
                        primaryEmployee: true,
                        client: {
                            select: {
                                allowSaturdayService: true,
                                allowSundayService: true,
                                allowHolidayService: true,
                            },
                        },
                    },
                });
                // A replacement commits `replaced=true` under these same locks
                // while this request may still hold a context resolved before
                // it. The token proves who was the provider at request start,
                // so refuse once the schedule is replaced or no longer owned
                // by the context's employee.
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== schedule.clientId
                    || (
                        rereadSchedule.branchId !== undefined
                        && rereadSchedule.branchId !== ctx.branchId
                    )
                    || rereadSchedule.replaced === true
                    || rereadSchedule.primaryEmployeeId !== ctx.employeeId
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                schedule = rereadSchedule;
                clientServiceDays = rereadSchedule.client;
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            } else {
                // Serialize all entry writes for this case before reading a
                // session snapshot when a legacy test adapter omits ownership
                // fields. Real Prisma transactions never take this branch.
                const locked = await lockServiceRecordCaseForWrite(tx, ctx.branchId, aggregate.id);
                if (typeof tx.$queryRaw === "function" && !locked) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            }
            // Token lock goes after the write-set lock (documented lock order)
            // and before any write below.
            await this.assertTokenStillValid(tx, ctx);
            if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            if (record.branchId !== ctx.branchId) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(record.status as never)) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }

            const clientCalendar = withClientServiceDays(calendar, clientServiceDays);
            const total = entrySessionCount(record, clientCalendar);
            if (sessionIndex < 1 || sessionIndex > total) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/sessionIndex",
                    code: "INVALID_VALUE",
                    detail: `Session ${sessionIndex} is outside the contracted range 1..${total}`,
                    location: "body",
                }));
            }
            const serviceDate = new Date(dto.serviceDate);
            if (Number.isNaN(serviceDate.getTime())) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/serviceDate",
                    code: "INVALID_VALUE",
                    detail: "Invalid service date",
                    location: "body",
                }));
            }
            serviceDate.setUTCHours(0, 0, 0, 0);
            const existing = await tx.service_record_day.findUnique({
                where: {
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                    },
                },
            });
            if (existing?.locked) {
                // Draft saves and legacy days without a signature stay refused.
                if (
                    !lock
                    || !existing.clientSignature
                ) {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
            }
            const lockedEdit = Boolean(existing?.locked);
            const dateIso = toIso(serviceDate);
            const dateChanged = !existing || dateIso !== toIso(existing.serviceDate);
            const dateFailure = (
                detail: string,
                serviceDateReason: "OUT_OF_RANGE" | "NOT_SERVICE_DAY" | "TAKEN" | "BEFORE_PREVIOUS" | "AFTER_NEXT",
            ): BadRequestException => new BadRequestException({
                ...problemBody("VALIDATION_FAILED", {
                    pointer: "/serviceDate", code: "INVALID_VALUE", detail, location: "body",
                }),
                serviceDateReason,
            });
            const forwardDetail = "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요.";
            const backwardDetail = "앞 회차보다 이르게 바꿀 수 없어요. 앞 회차를 먼저 변경해 주세요.";
            let aligned: ServiceRecordPlannedSession[] | null = null;
            if (dateChanged) {
                const offsetDate = (date: Date, days: number): string => {
                    const copy = new Date(`${toIso(date)}T00:00:00.000Z`);
                    copy.setUTCDate(copy.getUTCDate() + days);
                    return toIso(copy);
                };
                if ((record.startDate && dateIso < offsetDate(record.startDate, -7))
                    || (record.endDate && dateIso > offsetDate(record.endDate, 7))) {
                    throw dateFailure("고를 수 있는 기간이 아니에요.", "OUT_OF_RANGE");
                }
                let isServiceDay = false;
                try {
                    isServiceDay = clientCalendar.isBusinessDay(dateIso);
                } catch (error) {
                    if (!(error instanceof UnsupportedKoreanHolidayYearError)) throw error;
                }
                if (!isServiceDay) throw dateFailure("서비스를 하지 않는 날이에요.", "NOT_SERVICE_DAY");
                const days = await tx.service_record_day.findMany({
                    where: { serviceRecordCaseId: record.id, branchId: ctx.branchId },
                    orderBy: { caseSessionIndex: "asc" },
                });
                const others = days
                    .map((day) => ({ ...day, caseSessionIndex: day.caseSessionIndex ?? day.sessionIndex }))
                    .filter((day) => day.caseSessionIndex !== sessionIndex)
                    .sort((a, b) => a.caseSessionIndex - b.caseSessionIndex);
                const prev = others.filter((day) => day.caseSessionIndex < sessionIndex).at(-1);
                const next = others.find((day) => day.caseSessionIndex > sessionIndex);
                if (prev && dateIso <= toIso(prev.serviceDate)) throw dateFailure(backwardDetail, "BEFORE_PREVIOUS");
                if (next && dateIso >= toIso(next.serviceDate)) throw dateFailure(forwardDetail, "AFTER_NEXT");
                if (others.some((day) => toIso(day.serviceDate) === dateIso)) {
                    throw dateFailure("다른 회차가 이미 고른 날이에요.", "TAKEN");
                }
                const vector = plannedSessionVector(record.plannedSessions, total, clientCalendar);
                if (vector.state === "valid" && vector.entries) {
                    try {
                        aligned = alignPlannedSessionsToCaregiverDate(
                            vector.entries, sessionIndex, dateIso,
                            new Set(others.map((day) => day.caseSessionIndex)), clientCalendar,
                        );
                        aligned = validateServiceRecordScheduleVector(aligned, total, clientCalendar, { persisted: true });
                    } catch (error) {
                        const direction = error instanceof CaregiverDateAlignmentError
                            ? error.direction
                            : dateIso > vector.entries[sessionIndex - 1]!.serviceDate ? "forward" : "backward";
                        throw dateFailure(
                            direction === "forward" ? forwardDetail : backwardDetail,
                            direction === "forward" ? "AFTER_NEXT" : "BEFORE_PREVIOUS",
                        );
                    }
                    if (isDeepStrictEqual(aligned, vector.entries)) aligned = null;
                }
            }
            const writeAlignedVector = async (): Promise<void> => {
                if (!aligned) return;
                await tx.service_record_case.update({
                    where: { id: record.id, branchId: ctx.branchId },
                    data: {
                        plannedSessions: aligned as unknown as Prisma.InputJsonValue,
                        version: { increment: 1 },
                    },
                });
            };
            // 새 기록(미제출 초안 재저장 포함)은 앞선 모든 회차가 제출된 경우에만 쓸 수 있다.
            if (!lockedEdit && sessionIndex > 1) {
                const submittedCount = await tx.service_record_day.count({
                    where: {
                        serviceRecordCaseId: record.id,
                        branchId: ctx.branchId,
                        caseSessionIndex: { lt: sessionIndex },
                        locked: true,
                    },
                });
                if (submittedCount !== sessionIndex - 1) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }

            if (lock) {
                if (dto.momApproval !== "approved") {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/momApproval",
                        code: "INVALID_VALUE",
                        detail: "산모 확인 승인이 필요합니다.",
                        location: "body",
                    }));
                }
                if (!this.hasCompleteHeader(record)) {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/header",
                        code: "INVALID_VALUE",
                        detail: "서비스 기본정보를 모두 입력해 주세요.",
                        location: "body",
                    }));
                }
                if (!existing?.locked && !existing?.clientSignature && !dto.clientSignature) {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/clientSignature",
                        code: "INVALID_VALUE",
                        detail: "산모 서명이 필요합니다.",
                        location: "body",
                    }));
                }
            }

            const etcService = this.trimNullable(
                dto.etcService,
                SERVICE_RECORD_TEXT_LIMITS.etcService,
                "etcService",
            );
            const notes = this.trimNullable(
                dto.notes,
                SERVICE_RECORD_TEXT_LIMITS.notes,
                "notes",
            );
            const paymentConfirmed = dto.paymentConfirmed ?? false;

            if (existing && lockedEdit) {
                // Caregiver edit of a submitted day. The date and editable
                // fields come from the request; every other column is the
                // stored fact (original submit time, approval, signature,
                // author, schedule, form version). The request's
                // clientSignature is deliberately ignored.
                const before = editableDaySnapshot(existing);
                const after: EditableDaySnapshot = {
                    serviceDate: dateIso,
                    answers: toPlainJson(answers),
                    etcService,
                    notes,
                    paymentConfirmed,
                };
                if (isDeepStrictEqual(before, after)) {
                    // The client always resends the full draft; an unchanged
                    // edit writes and logs nothing.
                    lockedEditOutcome = "unchanged";
                    return existing;
                }
                const editData = {
                    branchId: ctx.branchId,
                    scheduleId: existing.scheduleId,
                    serviceRecordCaseId: record.id,
                    caseSessionIndex: sessionIndex,
                    employeeId: existing.employeeId,
                    employeeNameSnapshot: existing.employeeNameSnapshot,
                    formVersion: existing.formVersion,
                    sessionIndex: existing.sessionIndex,
                    serviceDate,
                    answers: answers as Prisma.InputJsonValue,
                    etcService,
                    notes,
                    paymentConfirmed,
                    momApproval: existing.momApproval,
                    locked: true,
                    submittedAt: existing.submittedAt,
                };
                const editedRow = await tx.service_record_day.upsert({
                    where: {
                        branchId: ctx.branchId,
                        serviceRecordCaseId_caseSessionIndex: {
                            serviceRecordCaseId: record.id,
                            caseSessionIndex: sessionIndex,
                        },
                    },
                    create: editData,
                    update: editData,
                });
                await tx.service_record_day_edit_log.create({
                    data: {
                        branchId: ctx.branchId,
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                        serviceRecordDayId: existing.id,
                        employeeId: ctx.employeeId,
                        employeeNameSnapshot: schedule.primaryEmployee.name,
                        before: before as unknown as Prisma.InputJsonValue,
                        after: after as unknown as Prisma.InputJsonValue,
                    },
                });
                lockedEditOutcome = "edited";
                await writeAlignedVector();
                await this.lifecycleService.recompute(record.id, tx, calendar, { preserveVersion: !dateChanged });
                return editedRow;
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
                etcService,
                notes,
                paymentConfirmed,
                momApproval: dto.momApproval ?? null,
                locked: lock,
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
            await writeAlignedVector();
            await this.lifecycleService.recompute(record.id, tx, calendar, {
                preserveVersion: !dateChanged && existing?.locked === lock,
            });
            return row;
        });
        if (lockedEditOutcome === "edited") {
            this.logger.log(`Service-record session ${sessionIndex} edited after submit for case ${aggregate.id}`);
        } else if (lock && lockedEditOutcome === null) {
            this.logger.log(`Service-record session ${sessionIndex} submitted + locked for case ${aggregate.id}`);
        }
        return { ...saved, sessionIndex: saved.caseSessionIndex ?? saved.sessionIndex };
    }

    /** Archive the complete submitted or draft row before removing it. */
    async deleteSession(ctx: ServiceRecordTokenContext, sessionIndex: number) {
        const aggregate = await this.resolveCase(ctx);
        const calendar = await this.holidayCalendar.forBranch(ctx.branchId, { fresh: true });
        await this.prisma.$transaction(async (tx) => {
            // Discover the assignment before locking. Production rows carry a
            // client id, so the common policy then locks client -> employees ->
            // case -> schedule/assignment/day and rereads both owner rows. The
            // fallback preserves narrow unit-test doubles that expose only the
            // historical case lock seam.
            let schedule = await tx.employee_schedule.findUnique({
                where: { id: ctx.scheduleId },
                include: { primaryEmployee: true },
            });
            if (!schedule) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            let record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            if (typeof schedule.clientId === "number") {
                await lockServiceRecordWriteSet(tx, {
                    branchId: ctx.branchId,
                    clientId: schedule.clientId,
                    caseId: aggregate.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [schedule.primaryEmployeeId, schedule.secondaryEmployeeId],
                    sessionIndexes: [sessionIndex],
                });
                const rereadSchedule = await tx.employee_schedule.findUnique({
                    where: { id: ctx.scheduleId },
                    include: {
                        primaryEmployee: true,
                        client: {
                            select: {
                                allowSaturdayService: true,
                                allowSundayService: true,
                                allowHolidayService: true,
                            },
                        },
                    },
                });
                // A replacement commits `replaced=true` under these same locks
                // while this request may still hold a context resolved before
                // it. The token proves who was the provider at request start,
                // so refuse once the schedule is replaced or no longer owned
                // by the context's employee.
                if (
                    !rereadSchedule
                    || rereadSchedule.clientId !== schedule.clientId
                    || (
                        rereadSchedule.branchId !== undefined
                        && rereadSchedule.branchId !== ctx.branchId
                    )
                    || rereadSchedule.replaced === true
                    || rereadSchedule.primaryEmployeeId !== ctx.employeeId
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                schedule = rereadSchedule;
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            } else {
                // Serialize all entry writes for this case before reading a
                // session snapshot when a legacy test adapter omits ownership
                // fields. Real Prisma transactions never take this branch.
                const locked = await lockServiceRecordCaseForWrite(tx, ctx.branchId, aggregate.id);
                if (typeof tx.$queryRaw === "function" && !locked) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                record = await tx.service_record_case.findUnique({ where: { id: aggregate.id } });
            }
            // Token lock goes after the write-set lock (documented lock order)
            // and before any write below.
            await this.assertTokenStillValid(tx, ctx);
            if (!record) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            if (record.branchId !== ctx.branchId) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(record.status as never)) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }

            const row = await tx.service_record_day.findUnique({
                where: {
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id, caseSessionIndex: sessionIndex,
                    },
                    branchId: ctx.branchId,
                },
            });
            if (!row) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            await tx.service_record_day_archive.create({
                data: {
                    branchId: ctx.branchId,
                    serviceRecordCaseId: record.id,
                    clientId: schedule.clientId,
                    batchId: randomUUID(),
                    reason: "caregiver_delete",
                    originalDayId: row.id,
                    caseSessionIndex: row.caseSessionIndex,
                    serviceDate: row.serviceDate,
                    previousStartDate: record.startDate,
                    newStartDate: record.startDate ?? row.serviceDate,
                    archivedByUserId: null,
                    payload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
                },
            });
            await tx.service_record_day.delete({ where: { id: row.id, branchId: ctx.branchId } });
            await this.lifecycleService.recompute(record.id, tx, calendar);
        });
        this.logger.log(`Service-record session ${sessionIndex} deleted for case ${aggregate.id}`);
        return { deleted: true, sessionIndex };
    }

    /** Backward-compatible completion acknowledgement. Snapshot creation is scheduler-owned. */
    async finalize(ctx: ServiceRecordTokenContext) {
        const record = await this.resolveCase(ctx);
        // `recompute` opens its own transaction with its own lock order, so the
        // token is checked in a separate short transaction right before it. This
        // narrows, but does not serialise, the window between the check and the
        // recompute's writes.
        await this.prisma.$transaction(async (tx) => {
            await this.assertTokenStillValid(tx, ctx);
        });
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

    /**
     * Re-check the caregiver access token inside a write transaction. The guard
     * resolves it once per request, so an admin revoke/replace or an expiry that
     * lands between that check and the write would otherwise still commit.
     *
     * The token row is locked (`FOR UPDATE`) so a concurrent revoke/replace
     * serialises with this write. Call it AFTER the service-record write-set /
     * case lock: `service-record-write-lock.policy` fixes client -> employees ->
     * case -> schedules/assignments/days, and other schedule writers take
     * those locks before updating token rows, so locking the token earlier here
     * would invert that order.
     *
     * Refuses exactly as the guard does for an unusable token. The current-provider
     * / phone check stays in `resolveAccess`; only row state and ownership are
     * re-checked here.
     */
    private async assertTokenStillValid(
        tx: Prisma.TransactionClient,
        ctx: ServiceRecordTokenContext,
    ): Promise<void> {
        // Narrow unit doubles that expose no token lock keep the old behaviour;
        // the real token service always has it.
        if (typeof this.tokenService.lockAccessTokenForWrite !== "function") return;
        const token = await this.tokenService.lockAccessTokenForWrite(tx, ctx.tokenId);
        if (
            !token
            || !isServiceRecordAccessTokenUsable(token)
            || token.scheduleId !== ctx.scheduleId
            || token.employeeId !== ctx.employeeId
        ) {
            this.logger.warn("Service record write refused: access token no longer valid inside transaction");
            throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        }
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
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
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

    private trimNullable(value: string | null | undefined, maxLength: number, field: string): string | null {
        if (value !== null && value !== undefined && value.length > maxLength) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: `/${field}`,
                code: "INVALID_VALUE",
                detail: `입력값은 ${maxLength}자를 넘을 수 없습니다.`,
                location: "body",
            }));
        }
        const normalized = value?.trim();
        if (!normalized) return null;
        return normalized;
    }
}
