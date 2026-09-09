import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { message_log, message_trigger_job, Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";
import { serviceRecordSessionCount } from "domain/utils/service-record-session-count";
import {
    resolveServiceRecordScheduleProjection,
} from "application/policies/service-record-edit-preview.policy";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type IServiceRecordEditRepository,
} from "domain/repositories/service-record-edit.repository.interface";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { MessageTriggerService } from "./message-trigger.service";
import { ServiceRecordSecurityEventService } from "./service-record-security-event.service";
import {
    AdminServiceRecordAssignmentDto,
    AdminServiceRecordCaseDto,
    AdminServiceRecordHeaderDto,
    AdminServiceRecordLinkDto,
    AdminServiceRecordLinkStatus,
    AdminServiceRecordOverviewDto,
    AdminServiceRecordPreparedLinkDto,
    AdminServiceRecordResetLinkDto,
    AdminServiceRecordSessionDto,
    AdminServiceRecordSignatureDocDto,
    AdminServiceRecordTokenDto,
    AdminServiceRecordTokenState,
} from "interface/dto/admin-service-record.dto";
import type {
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryResponse,
} from "interface/dto/admin-service-record-edit.dto";

type ScheduleForOverview = Prisma.employee_scheduleGetPayload<{
    include: {
        client: true;
        primaryEmployee: true;
        serviceRecord: true;
        serviceRecordDays: true;
        serviceRecordTokens: true;
    };
}>;
type CaseForOverview = Prisma.service_record_caseGetPayload<{
    include: { days: true };
}>;

type ServiceRecordLinkJob = message_trigger_job;
type ServiceRecordLinkLog = message_log;
type SignatureDocRow = Prisma.eformsign_docGetPayload<{
    select: {
        employeeScheduleId: true;
        documentId: true;
        statusDetail: true;
        stepName: true;
        createdDate: true;
        updatedDate: true;
        snapshotVersion: true;
        snapshotChunkIndex: true;
    };
}>;

export interface ServiceRecordAdminActor {
    userId: string;
    globalRole: string;
    branchRole: string;
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

function isoDate(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function servicePeriodSessionCount(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
    fallback: number | null,
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
        return serviceRecordSessionCount(startDate, endDate, fallback) ?? 0;
    } catch (error) {
        // Unsupported legacy years remain viewable. A presentation total of
        // zero means the authoritative N is unknown; the editor projection
        // carries the explicit blocker and never invents a weekday fallback.
        if (error instanceof UnsupportedKoreanHolidayYearError) return fallback ?? 0;
        throw error;
    }
}
@Injectable()
export class AdminServiceRecordService {
    private readonly logger = new Logger(AdminServiceRecordService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly serviceRecordLinkService: ServiceRecordLinkService,
        private readonly messageTriggerService: MessageTriggerService,
        @Optional() private readonly securityEventService?: ServiceRecordSecurityEventService,
        @Optional()
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly editRepository?: IServiceRecordEditRepository,
    ) {}

    async getClientOverview(
        branchId: string,
        clientId: number,
        options: { includeSignatures?: boolean } = {},
    ): Promise<AdminServiceRecordOverviewDto> {
        const [record, schedules] = await Promise.all([
            this.prisma.service_record_case.findFirst({
                where: { branchId, clientId },
                include: { days: { orderBy: { caseSessionIndex: "asc" } } },
            }),
            this.prisma.employee_schedule.findMany({
                where: { branchId, clientId },
                include: {
                    client: true,
                    primaryEmployee: true,
                    serviceRecord: true,
                    serviceRecordDays: { orderBy: { sessionIndex: "asc" } },
                    serviceRecordTokens: {
                        where: {
                            OR: [
                                { active: true },
                                { revokedAt: { not: null } },
                            ],
                        },
                        orderBy: { createdAt: "desc" },
                    },
                },
                orderBy: { startDate: "desc" },
            }),
        ]);

        const scheduleIds = schedules.map((schedule) => schedule.id);
        const jobs = scheduleIds.length > 0 ? await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                employeeScheduleId: { in: scheduleIds },
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
            },
            orderBy: { createdAt: "desc" },
        }) : [];
        const jobIds = jobs.map((job) => job.id);
        const logs = scheduleIds.length > 0 ? await this.prisma.message_log.findMany({
            where: {
                branchId,
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                OR: [
                    ...(jobIds.length > 0 ? [{ triggerJobId: { in: jobIds } }] : []),
                    { clientId, triggerJobId: null },
                ],
            },
            orderBy: { createdAt: "desc" },
        }) : [];
        const signatureDocs = await this.findServiceRecordSignatureDocs(
            branchId,
            scheduleIds,
            record?.id ?? null,
        );
        const signatureDocByScheduleId = latestSignatureDocByScheduleId(signatureDocs);

        return {
            record: record ? this.mapCase(record, signatureDocs, options.includeSignatures === true) : null,
            assignments: schedules.map((schedule) => this.mapAssignment(
                schedule,
                jobs.filter((job) => job.employeeScheduleId === schedule.id),
                logs.filter((log) => (
                    (log.triggerJobId !== null && jobIdsForSchedule(jobs, schedule.id).has(log.triggerJobId))
                    || (log.triggerJobId === null && logScheduleId(log) === schedule.id)
                )),
                signatureDocByScheduleId.get(schedule.id) ?? null,
                options.includeSignatures === true,
            )),
        };
    }

    /**
     * Read-only editor access has a stricter not-found contract than the
     * existing overview endpoint.  The overview is intentionally allowed to
     * return an empty result for legacy callers, so assert the branch-owned
     * client before delegating to that existing read path.
     */
    async getClientEditor(branchId: string, clientId: number): Promise<AdminServiceRecordOverviewDto> {
        await this.assertClientBelongsToBranch(branchId, clientId);
        const overview = await this.getClientOverview(branchId, clientId, { includeSignatures: true });
        const scheduleProjection = await this.loadScheduleProjection(branchId, clientId);
        return { ...overview, scheduleProjection };
    }

    /** Read append-only revision history and safe document-operation state. */
    async getRevisionHistory(
        branchId: string,
        clientId: number,
    ): Promise<ServiceRecordRevisionHistoryResponse> {
        await this.assertClientBelongsToBranch(branchId, clientId);
        const repository = this.getRevisionStatusRepository();
        const result = await repository.listRevisionHistory(branchId, clientId);
        if (result === null) throw new NotFoundException("Service record case not found");
        return normalizeRevisionHistoryResponse(result);
    }

    /**
     * Queue a retry for one existing operation generation. The retry path is
     * intentionally CAS-shaped: a stale generation or an active/unknown
     * provider outcome is a conflict, never a blind resend.
     */
    async retryRevisionDocument(
        branchId: string,
        revisionId: string,
        documentStateId: string,
        expectedGeneration: string,
        actorUserId: string,
    ): Promise<ServiceRecordRevisionDocumentSummary> {
        const normalizedRevisionId = normalizePathIdentifier(revisionId, "revisionId");
        const normalizedDocumentStateId = normalizePathIdentifier(documentStateId, "documentStateId");
        const normalizedGeneration = normalizeGeneration(expectedGeneration);
        const repository = this.getRevisionStatusRepository();
        const state = await repository.findRevisionDocumentStateForBranch(
            branchId,
            normalizedRevisionId,
            normalizedDocumentStateId,
        );
        if (state === null) throw new NotFoundException("Revision document not found");
        if (state.generation !== normalizedGeneration) {
            throw revisionDocumentConflict("REVISION_DOCUMENT_GENERATION_STALE");
        }

        void actorUserId;
        const result = await repository.retryRevisionDocumentState({
            branchId,
            clientId: state.clientId,
            revisionId: normalizedRevisionId,
            stateId: normalizedDocumentStateId,
            expectedGeneration: normalizedGeneration,
        });
        if (result === null) throw revisionDocumentConflict("REVISION_DOCUMENT_RETRY_CONFLICT");
        return normalizeRevisionDocumentSummaryResult(result);
    }

    private getRevisionStatusRepository(): IServiceRecordEditRepository {
        if (!this.editRepository) {
            throw new ConflictException({ code: "REVISION_DOCUMENT_STATE_UNAVAILABLE" });
        }
        return this.editRepository;
    }

    private async loadScheduleProjection(
        branchId: string,
        clientId: number,
    ): Promise<NonNullable<AdminServiceRecordOverviewDto["scheduleProjection"]>> {
        if (!this.editRepository) {
            return {
                entries: [],
                blockingReasons: [{
                    code: "EDITOR_PROJECTION_UNAVAILABLE",
                    message: "서비스 예정 회차 근거를 확인할 수 없습니다.",
                }],
            };
        }
        const source = await this.editRepository.loadSource(branchId, { clientId });
        if (!source) {
            return {
                entries: [],
                blockingReasons: [{
                    code: "SERVICE_RECORD_SOURCE_UNAVAILABLE",
                    message: "서비스 제공기록 원본을 확인할 수 없습니다.",
                }],
            };
        }
        const projection = resolveServiceRecordScheduleProjection(source);
        return {
            entries: projection.entries,
            blockingReasons: projection.blockingReasons,
        };
    }

    private mapCase(
        record: CaseForOverview,
        signatureDocs: SignatureDocRow[],
        includeSignatures: boolean,
    ): AdminServiceRecordCaseDto {
        const header = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].some((value) => Boolean(value));
        return {
            id: record.id,
            status: record.status,
            startDate: record.startDate,
            endDate: record.endDate,
            totalSessions: servicePeriodSessionCount(
                record.startDate,
                record.endDate,
                record.requiredSessionCount,
                hasAuthoritativeRevision(record),
            ),
            completedAt: record.completedAt,
            finalizationDueAt: record.finalizationDueAt,
            finalizedAt: record.finalizedAt,
            documentsCompletedAt: record.documentsCompletedAt,
            lastError: record.lastError,
            header: header ? {
                momName: record.momName,
                momBirth: record.momBirth,
                babyName: record.babyName,
                babyBirth: record.babyBirth,
                deliveryType: record.deliveryType,
                babyWeight: record.babyWeight,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
            } : null,
            sessions: record.days.map((session) => this.mapSession(session, includeSignatures)),
            signatureDocs: signatureDocs.map((document) => this.mapSignatureDoc(document)),
        };
    }

    async prepareLink(
        branchId: string,
        scheduleId: number,
        recipientPhone?: string,
    ): Promise<AdminServiceRecordPreparedLinkDto> {
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        return this.serviceRecordLinkService.prepareLink(scheduleId, recipientPhone);
    }

    async resetLink(
        branchId: string,
        scheduleId: number,
        actor?: ServiceRecordAdminActor,
    ): Promise<AdminServiceRecordResetLinkDto> {
        if (this.securityEventService && !actor?.userId) {
            throw new ForbiddenException("Authenticated administrator required");
        }
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        const reset = await this.serviceRecordLinkService.resetLink(scheduleId);
        this.securityEventService?.emit({
            outcome: "link_reissued",
            actorUserId: actor?.userId,
            branchId,
            scheduleId,
        });
        return reset;
    }

    async sendLinkNow(
        branchId: string,
        scheduleId: number,
        preparedLinkToken?: string,
        recipientPhone?: string,
    ) {
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        const queued = await this.serviceRecordLinkService.sendNow(
            scheduleId,
            preparedLinkToken,
            recipientPhone,
        );
        const dispatched = await this.messageTriggerService.dispatchPendingJobNow(queued.jobId, {
            expectedBranchId: branchId,
        });

        return {
            ok: dispatched.status === "sent",
            jobId: dispatched.id,
            status: dispatched.status,
            scheduledFor: queued.scheduledFor,
        };
    }

    private async assertScheduleBelongsToBranch(branchId: string, scheduleId: number): Promise<void> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId },
            select: { id: true },
        });
        if (!schedule) {
            throw new NotFoundException("Assignment not found");
        }
    }

    private async assertClientBelongsToBranch(branchId: string, clientId: number): Promise<void> {
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: { id: true },
        });
        if (!client) {
            throw new NotFoundException("Client not found");
        }
    }

    private mapAssignment(
        schedule: ScheduleForOverview,
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        signatureDoc: AdminServiceRecordSignatureDocDto | null,
        includeSignatures: boolean,
    ): AdminServiceRecordAssignmentDto {
        return {
            scheduleId: schedule.id,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            replaced: schedule.replaced,
            employee: {
                id: schedule.primaryEmployee.id,
                name: schedule.primaryEmployee.name,
                phone: schedule.primaryEmployee.phone,
            },
            link: this.deriveLink(jobs, logs, schedule.serviceRecordTokens[0] ?? null),
            header: schedule.serviceRecord ? this.mapHeader(schedule.serviceRecord) : null,
            totalSessions: servicePeriodSessionCount(
                schedule.client.startDate ?? schedule.startDate,
                schedule.client.endDate ?? schedule.endDate,
                schedule.client.duration,
            ),
            sessions: schedule.serviceRecordDays.map((session) => this.mapSession(session, includeSignatures)),
            signatureDoc,
        };
    }

    private deriveLink(
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        token: ScheduleForOverview["serviceRecordTokens"][number] | null,
    ): AdminServiceRecordLinkDto {
        const sentLogs = logs
            .filter((log) => log.status === "sent")
            .sort((left, right) => this.logActivityTime(right) - this.logActivityTime(left));
        const pendingJob = jobs.find((job) => job.status === "pending") ?? null;
        const newestLog = logs[0] ?? null;
        const newestJob = jobs[0] ?? null;
        const sentCount = sentLogs.length;
        let status: AdminServiceRecordLinkStatus = "none";
        let scheduledFor: Date | null = null;

        if (sentCount > 0) {
            status = "sent";
        } else if (pendingJob) {
            status = "scheduled";
            scheduledFor = pendingJob.scheduledFor;
        } else if (newestLog?.status === "failed") {
            status = "failed";
        } else if (newestJob?.status === "canceled") {
            status = "canceled";
        }

        return {
            status,
            scheduledFor,
            sentCount,
            lastSentAt: sentLogs[0]?.lastAttemptAt ?? sentLogs[0]?.createdAt ?? null,
            token: token ? this.mapToken(token) : null,
        };
    }

    private mapToken(token: ScheduleForOverview["serviceRecordTokens"][number]): AdminServiceRecordTokenDto {
        return {
            issuedAt: token.createdAt,
            verifiedAt: token.verifiedAt,
            expiresAt: token.expiresAt,
            state: this.getTokenState(token),
        };
    }

    private getTokenState(token: ScheduleForOverview["serviceRecordTokens"][number]): AdminServiceRecordTokenState {
        if (token.revokedAt) return "revoked";
        if (token.expiresAt.getTime() < Date.now()) return "expired";
        if (token.active) return "active";
        return "revoked";
    }

    private mapHeader(header: ScheduleForOverview["serviceRecord"]): AdminServiceRecordHeaderDto {
        return {
            momName: header?.momName ?? null,
            momBirth: header?.momBirth ?? null,
            babyName: header?.babyName ?? null,
            babyBirth: header?.babyBirth ?? null,
            deliveryType: header?.deliveryType ?? null,
            babyWeight: header?.babyWeight ?? null,
            createdAt: header?.createdAt ?? new Date(0),
            updatedAt: header?.updatedAt ?? new Date(0),
        };
    }

    private mapSession(
        session: ScheduleForOverview["serviceRecordDays"][number],
        includeSignatures: boolean,
    ): AdminServiceRecordSessionDto {
        return {
            sessionIndex: session.caseSessionIndex ?? session.sessionIndex,
            serviceDate: session.serviceDate,
            locked: session.locked,
            submittedAt: session.submittedAt,
            updatedAt: session.updatedAt,
            answers: session.answers,
            etcService: session.etcService,
            notes: session.notes,
            paymentConfirmed: session.paymentConfirmed,
            hasMomApproval: Boolean(session.momApproval),
            ...(includeSignatures ? {
                clientSignature: session.clientSignature,
                clientSignedAt: session.clientSignedAt,
            } : {}),
            employeeId: session.employeeId,
            employeeName: session.employeeNameSnapshot,
            formVersion: session.formVersion,
        };
    }

    private mapSignatureDoc(document: SignatureDocRow): AdminServiceRecordSignatureDocDto {
        return {
            documentId: document.documentId,
            statusDetail: document.statusDetail,
            stepName: document.stepName,
            createdDate: document.createdDate,
            updatedDate: document.updatedDate,
            snapshotVersion: document.snapshotVersion,
            snapshotChunkIndex: document.snapshotChunkIndex,
            employeeScheduleId: document.employeeScheduleId,
        };
    }

    private logActivityTime(log: ServiceRecordLinkLog): number {
        return (log.lastAttemptAt ?? log.createdAt).getTime();
    }

    private async findServiceRecordSignatureDocs(
        branchId: string,
        scheduleIds: number[],
        serviceRecordCaseId: string | null,
    ): Promise<SignatureDocRow[]> {
        try {
            return await this.prisma.eformsign_doc.findMany({
                where: {
                    branchId,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                    OR: [
                        ...(serviceRecordCaseId ? [{ serviceRecordCaseId }] : []),
                        ...(scheduleIds.length > 0 ? [{ employeeScheduleId: { in: scheduleIds } }] : []),
                    ],
                },
                select: {
                    employeeScheduleId: true,
                    documentId: true,
                    statusDetail: true,
                    stepName: true,
                    createdDate: true,
                    updatedDate: true,
                    snapshotVersion: true,
                    snapshotChunkIndex: true,
                },
                orderBy: [
                    { employeeScheduleId: "asc" },
                    { updatedDate: "desc" },
                    { createdDate: "desc" },
                ],
            });
        } catch (error) {
            if (!isPendingEformsignServiceRecordColumnError(error)) {
                throw error;
            }

            this.logger.warn(
                "Skipping service-record signature docs because eformsign_doc service-record columns are not migrated yet.",
            );
            return [];
        }
    }
}

const SAFE_DOCUMENT_OPERATIONS = new Set<string>([
    "record_snapshot",
    "contract_period",
    "receipt_refresh",
]);
const SAFE_DOCUMENT_STATUSES = new Set<string>([
    "not_required",
    "waiting_for_completion",
    "waiting_for_signature",
    "capability_unverified",
    "manual_review",
    "pending",
    "processing",
    "unknown",
    "failed",
    "completed",
]);

function asRows(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => (
        typeof item === "object" && item !== null && !Array.isArray(item)
    ));
}

function readField(value: unknown, names: string[]): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    for (const name of names) {
        if (name in row) return row[name];
    }
    return undefined;
}

function readStringField(value: unknown, names: string[]): string | null {
    const field = readField(value, names);
    return typeof field === "string" && field.length > 0 ? field : null;
}

function readNullableStringField(value: unknown, names: string[]): string | null {
    const field = readField(value, names);
    return field === null || field === undefined ? null : readStringField(value, names);
}

function readPositiveIntegerField(value: unknown, names: string[]): number | null {
    const field = readField(value, names);
    return typeof field === "number" && Number.isSafeInteger(field) && field > 0 ? field : null;
}

function readNonNegativeIntegerField(value: unknown, names: string[]): number | null {
    const field = readField(value, names);
    return typeof field === "number" && Number.isSafeInteger(field) && field >= 0 ? field : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeIsoDate(value: unknown): string | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
    return new Date(value).toISOString();
}

function normalizePathIdentifier(value: string, field: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 255) {
        throw new NotFoundException(`${field} not found`);
    }
    return value;
}

function normalizeGeneration(value: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
        throw new ConflictException({ code: "REVISION_DOCUMENT_GENERATION_INVALID" });
    }
    return value;
}

function revisionDocumentConflict(code: string): ConflictException {
    return new ConflictException({ code });
}

function normalizeRevisionHistoryResponse(value: unknown): ServiceRecordRevisionHistoryResponse {
    const row = asObject(value);
    if (!row || !Array.isArray(row["revisions"])) {
        throw new Error("Invalid service-record revision history response");
    }
    const caseId = readStringField(row, ["caseId", "case_id"]);
    const caseVersion = readNonNegativeIntegerField(row, ["caseVersion", "case_version"]);
    if (!caseId || caseVersion === null) throw new Error("Invalid service-record revision history response");
    const currentRevisionId = readNullableStringField(row, ["currentRevisionId", "current_revision_id"]);
    const currentUsableRevisionId = readNullableStringField(row, [
        "currentUsableRevisionId",
        "current_usable_revision_id",
    ]);
    const revisions = asRows(row["revisions"]).map((revision) => {
        const id = readStringField(revision, ["id"]);
        const revisionNumber = readPositiveIntegerField(revision, ["revisionNumber", "revision_number"]);
        const confirmedAt = normalizeIsoDate(readField(revision, ["confirmedAt", "confirmed_at"]));
        if (!id || revisionNumber === null || !confirmedAt) {
            throw new Error("Invalid service-record revision summary response");
        }
        const documents = Array.isArray(revision["documents"])
            ? revision["documents"].map(normalizeRevisionDocumentSummary)
            : [];
        return {
            id,
            revisionNumber,
            confirmedAt,
            isCurrent: readField(revision, ["isCurrent", "is_current"]) === true,
            documents,
        };
    });
    return {
        caseId,
        caseVersion,
        currentRevisionId,
        currentUsableRevisionId,
        revisions,
    };
}

function normalizeRevisionDocumentSummary(value: unknown): ServiceRecordRevisionDocumentSummary {
    const row = asObject(value);
    if (!row) throw new Error("Invalid service-record revision document response");
    const id = readStringField(row, ["id", "documentStateId", "document_state_id"]);
    const generation = readStringField(row, ["generation"]);
    if (!id || !generation) throw new Error("Invalid service-record revision document response");
    const operation = normalizeRevisionDocumentOperation(readField(row, ["operation"]));
    const status = normalizeRevisionDocumentStatus(readField(row, ["status"]));
    const directCanRetry = readField(row, ["canRetry", "can_retry"]);
    const reasonCode = normalizeReasonCode(readField(row, [
        "reasonCode",
        "reason_code",
        "lastErrorCode",
        "last_error_code",
    ]));
    return {
        id,
        operation,
        generation,
        status,
        documentVersion: readPositiveIntegerField(row, ["documentVersion", "document_version"]),
        canRetry: directCanRetry === true,
        reasonCode,
    };
}

function normalizeRevisionDocumentSummaryResult(value: unknown): ServiceRecordRevisionDocumentSummary {
    const row = asObject(value);
    if (!row) throw new Error("Invalid service-record revision document response");
    const candidate = asObject(row["document"]) ?? row;
    return normalizeRevisionDocumentSummary(candidate);
}

function normalizeRevisionDocumentOperation(value: unknown): ServiceRecordRevisionDocumentOperation {
    if (typeof value !== "string" || !SAFE_DOCUMENT_OPERATIONS.has(value)) {
        throw new Error("Invalid service-record revision document operation");
    }
    return value as ServiceRecordRevisionDocumentOperation;
}

function normalizeRevisionDocumentStatus(value: unknown): ServiceRecordRevisionDocumentStatus {
    return typeof value === "string" && SAFE_DOCUMENT_STATUSES.has(value)
        ? value as ServiceRecordRevisionDocumentStatus
        : "unknown";
}

function normalizeReasonCode(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0) return null;
    return /^[A-Z0-9][A-Z0-9_.:-]{0,79}$/.test(value) ? value : null;
}

function isPendingEformsignServiceRecordColumnError(error: unknown): boolean {
    const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "P2022") {
        return true;
    }

    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${message} ${typeof column === "string" ? column : ""}`;
    return /document_kind|employee_schedule_id|template_id|service_record_case_id|snapshot_version|snapshot_chunk_index|documentKind|employeeScheduleId|templateId|serviceRecordCaseId|snapshotVersion|snapshotChunkIndex/i.test(haystack);
}

function jobIdsForSchedule(jobs: ServiceRecordLinkJob[], scheduleId: number): Set<string> {
    return new Set(
        jobs
            .filter((job) => job.employeeScheduleId === scheduleId)
            .map((job) => job.id),
    );
}

/** Permanent-failure logs carry no trigger job; their scheduleId lives only in the variables payload. */
function logScheduleId(log: ServiceRecordLinkLog): number | null {
    const variables = log.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
    const raw = (variables as Record<string, unknown>)["scheduleId"];
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN;
    return Number.isNaN(parsed) ? null : parsed;
}

function latestSignatureDocByScheduleId(docs: SignatureDocRow[]): Map<number, AdminServiceRecordSignatureDocDto> {
    const byScheduleId = new Map<number, AdminServiceRecordSignatureDocDto>();
    for (const doc of docs) {
        if (doc.employeeScheduleId === null || byScheduleId.has(doc.employeeScheduleId)) continue;
        byScheduleId.set(doc.employeeScheduleId, {
            ...mapSignatureDocRow(doc),
        });
    }
    return byScheduleId;
}

function mapSignatureDocRow(doc: SignatureDocRow): AdminServiceRecordSignatureDocDto {
    return {
        documentId: doc.documentId,
        statusDetail: doc.statusDetail,
        stepName: doc.stepName,
        createdDate: doc.createdDate,
        updatedDate: doc.updatedDate,
        snapshotVersion: doc.snapshotVersion,
        snapshotChunkIndex: doc.snapshotChunkIndex,
        employeeScheduleId: doc.employeeScheduleId,
    };
}
