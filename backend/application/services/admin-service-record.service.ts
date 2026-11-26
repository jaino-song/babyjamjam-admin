import { readBackfilledScalarHousehold } from "application/policies/baby-record-provenance.policy";
import { resolveAdminServiceRecordTarget } from "./admin-service-record-target";
import { IMMUTABLE_FINALIZATION_STATUSES, SERVICE_RECORD_CASE_STATUS } from "./service-record-lifecycle.service";
import { ServiceRecordFinalizationService } from "./service-record-finalization.service";
import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { message_log, message_trigger_job, Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AdminAuditEventWriter } from "./admin-audit-event.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { codeOnlyProblemBody, codeOnlyProblemException } from "application/utils/problem-bodies";
import { isInitialFinalizationWorkflowScopeForRevision } from "application/policies/service-record-initial-finalization.policy";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { type KrBusinessDayCalendar } from "domain/utils/business-days";
import {
    resolveServiceRecordScheduleProjection,
} from "application/policies/service-record-edit-preview.policy";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type IServiceRecordEditRepository,
} from "domain/repositories/service-record-edit.repository.interface";
import { ServiceRecordPeriodMismatchService, hasAuthoritativeServiceRecordCount, servicePeriodSessionCount } from "./service-record-period-mismatch.service";
import {
    ServiceRecordLinkGroupService, type RecordLinkPrepareSelection, type RecordLinkSelection, type RecordLinkSendSelection,
} from "./service-record-link-group.service";
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
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import {
    buildServiceRecordCaregiverEditChanges,
    buildServiceRecordRevisionChanges,
} from "application/policies/service-record-revision-changes.policy";
import type { ServiceRecordRevisionChangesResponse } from "interface/dto/admin-service-record-edit.dto";
import type {
    AdminServiceRecordCaseSummary,
    ServiceRecordCaregiverEditChangesResponse,
    ServiceRecordCaregiverEditSummary,
} from "@babyjamjam/shared/types/service-record";

type ScheduleForOverview = Prisma.employee_scheduleGetPayload<{
    include: {
        client: true;
        primaryEmployee: true;
        serviceRecordDays: true;
        serviceRecordTokens: true;
    };
}> & {
    serviceRecord: Prisma.service_recordGetPayload<object> | null;
    recordEmployee?: AdminServiceRecordAssignmentDto["employee"];
};
type CaseForOverview = Prisma.service_record_caseGetPayload<{
    include: { days: true };
}>;

type ServiceRecordLinkJob = message_trigger_job;
type ServiceRecordLinkLog = message_log;
type LinkAttempt =
    | { kind: "job"; time: number; job: ServiceRecordLinkJob }
    | { kind: "log"; time: number; log: ServiceRecordLinkLog };

/**
 * An unmaterialised scheduling lease that automation deactivation canceled.
 *
 * `service-record-link.service.ts` claims an automatic send by inserting a
 * `failed` lease row (reason SCHEDULING_RETRY, no link, never dispatched). When
 * the branch automation is switched off,
 * `message-automation-activation.service.ts` cancels exactly those leases with
 * SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON and `canceledByUser: false`; a
 * job that had materialised (pending/processing) is canceled with a different
 * reason. So this reason + no user cancel identifies a cancellation that is
 * cleanup of a never-sent lease, not a canceled delivery attempt.
 */
function isCanceledSchedulingLease(job: ServiceRecordLinkJob): boolean {
    return job.status === "canceled"
        && job.cancelReason === SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON
        && job.canceledByUser !== true;
}

function isInFlightLinkJob(job: ServiceRecordLinkJob): boolean {
    return job.status === "pending" || job.status === "processing" || job.status === "dispatching";
}
type SignatureDocRow = Prisma.eformsign_docGetPayload<{
    select: {
        employeeScheduleId: true;
        documentId: true;
        statusType: true;
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

@Injectable()
export class AdminServiceRecordService {
    private readonly logger = new Logger(AdminServiceRecordService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly serviceRecordLinkService: ServiceRecordLinkService,
        private readonly messageTriggerService: MessageTriggerService,
        private readonly holidayCalendar: HolidayCalendarService,
        @Optional() private readonly securityEventService?: ServiceRecordSecurityEventService,
        @Optional()
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly editRepository?: IServiceRecordEditRepository,
        @Optional() private readonly periodMismatchService?: ServiceRecordPeriodMismatchService,
        @Optional() private readonly finalizationService?: ServiceRecordFinalizationService,
        @Optional() private readonly linkGroups?: ServiceRecordLinkGroupService,
        @Optional() private readonly lifecycle?: ServiceRecordLifecycleService,
        @Optional() private readonly adminAudit?: AdminAuditEventWriter,
    ) {}

    async adoptLegacyCase(
        scope: { branchId: string; clientId: number; caseId: string; babyId: string },
        actor: ServiceRecordAdminActor,
    ): Promise<{ caseId: string; babyId: string }> {
        if (!scope.branchId || !actor.userId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        const { lifecycle, adminAudit } = this;
        if (!lifecycle || !adminAudit) throw new InternalServerErrorException();

        const calendar = await this.holidayCalendar.forBranch(scope.branchId, { fresh: true });
        return this.prisma.$transaction(async (tx) => {
            const result = await lifecycle.linkLegacyCaseToBaby(scope, tx, calendar);
            await adminAudit.appendInTransaction(tx, {
                action: "service_record.legacy_case_adopt",
                targetType: "service_record_case",
                targetId: result.caseId,
                branchId: scope.branchId,
                actor,
                after: { clientId: scope.clientId, babyId: result.babyId },
                outcome: "success",
            });
            return result;
        });
    }

    async keepPeriodMismatch(branchId: string, clientId: number, sessionIndexes: number[], caseId?: string): Promise<{ keptSessionIndexes: number[] }> {
        if (!branchId) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        return this.prisma.$transaction((tx) => this.periodMismatchService!.keepInTransaction(tx, {
            branchId, clientId, caseId, sessionIndexes, calendar,
        }));
    }

    async fitPeriodMismatch(branchId: string, clientId: number, caseId?: string): Promise<{ startDate: string | null; endDate: string | null }> {
        if (!branchId) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        let committed: { scheduleIds: number[] } | undefined;
        try {
            const result = await this.prisma.$transaction((tx) => this.periodMismatchService!.fitInTransaction(tx, {
                branchId, clientId, caseId, calendar,
            }));
            if (result.changed) committed = { scheduleIds: result.scheduleIds };
            return { startDate: result.startDate, endDate: result.endDate };
        } finally {
            if (committed) {
                for (const scheduleId of committed.scheduleIds) {
                    await this.messageTriggerService.syncEmployeeAssignmentRulesForSchedule(branchId, scheduleId, true)
                        .catch((error) => this.logger.error("Failed to resync assignment trigger rules after period fit", error));
                }
                await this.messageTriggerService.syncClientRulesForClient(branchId, clientId, false)
                    .catch((error) => this.logger.error("Failed to resync client trigger rules after period fit", error));
            }
        }
    }

    async getClientOverview(
        branchId: string,
        clientId: number,
        caseId?: string,
    ): Promise<AdminServiceRecordOverviewDto> {
        return this.loadOverview(branchId, clientId, caseId, false);
    }

    private async loadOverview(
        branchId: string,
        clientId: number,
        caseId: string | undefined,
        includeSignatures: boolean,
    ): Promise<AdminServiceRecordOverviewDto> {
        const scope = { branchId, clientId };
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId, deletedAt: null },
            select: { fetalConfirmation: true, serviceStatus: true, allowSaturdayService: true, allowSundayService: true, allowHolidayService: true },
        });
        if (!client) {
            if (includeSignatures || caseId !== undefined) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            return { record: null, assignments: [], legacyLinkAssignment: null };
        }
        const target = await resolveAdminServiceRecordTarget(
            this.prisma, { ...scope, caseId }, includeSignatures && caseId !== undefined ? "read" : "overview",
        );
        const serviceDays = {
            saturday: client.allowSaturdayService ?? false,
            sunday: client.allowSundayService ?? false,
            holiday: client.allowHolidayService ?? false,
        };
        const branchCalendar = await this.holidayCalendar.forBranch(branchId);
        const calendar = branchCalendar.withServiceDays(serviceDays);
        const [caseRows, babies, activeOwners, currentSchedule] = await Promise.all([
            this.prisma.service_record_case.findMany({
                where: { ...scope, client: { branchId, deletedAt: null } },
                include: { _count: { select: { days: { where: { branchId, locked: true } } } } },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            }),
            this.prisma.client_baby.findMany({
                where: scope,
                select: { id: true, active: true },
                orderBy: { ordinal: "asc" },
            }),
            this.prisma.service_record_baby_assignment.findMany({
                where: { ...scope, activeOwner: true, schedule: { replaced: false, terminatedAt: null } },
                select: {
                    babyId: true, scheduleId: true, version: true, endedAt: true,
                    employee: { select: { id: true, name: true, phone: true, branchId: true, deletedAt: true } },
                    teamSlot: { select: { active: true } },
                },
                orderBy: { scheduleId: "asc" },
            }),
            this.prisma.employee_schedule.findFirst({
                where: { ...scope, replaced: false, terminatedAt: null, client: { branchId, deletedAt: null } },
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    primaryEmployee: { select: { id: true, branchId: true, deletedAt: true } },
                },
            }),
        ]);
        const activeBabies = babies.filter(({ active }) => active);
        const canUseCurrentSchedule = Boolean(currentSchedule) && client.serviceStatus !== "terminated";
        const isWritable = (record: Pick<typeof caseRows[number], "status" | "completedAt" | "finalizedAt">) =>
            !record.completedAt && !record.finalizedAt && !IMMUTABLE_FINALIZATION_STATUSES.has(record.status)
            && record.status !== SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED
            && record.status !== SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED;
        const historical = canUseCurrentSchedule && client.fetalConfirmation === "CONFIRMED"
            && caseRows.length === 1 && caseRows[0]?.babyId && isWritable(caseRows[0])
            ? await readBackfilledScalarHousehold(this.prisma, scope) : null;
        const cases: AdminServiceRecordCaseSummary[] = caseRows.map((record) => {
            const rank = activeBabies.findIndex(({ id }) => id === record.babyId) + 1;
            const owners = activeOwners.filter(({ babyId }) => babyId === record.babyId);
            const assignees = owners.map(({ employee }) => ({ id: employee.id, name: employee.name }));
            const currentOwners = owners.filter(({ scheduleId }) => scheduleId === currentSchedule?.id);
            const [owner] = currentOwners;
            const linkAssignments = historical?.caseId !== record.id && canUseCurrentSchedule && rank > 0 && isWritable(record)
                && client.fetalConfirmation === "CONFIRMED" && currentOwners.length === 1
                && owner && owner.endedAt === null && owner.teamSlot.active
                && owner.employee.branchId === branchId && owner.employee.deletedAt === null
                && owner.version > 0
                ? [{ scheduleId: owner.scheduleId, employeeId: owner.employee.id, assignmentVersion: owner.version }]
                : [];
            return {
                caseId: record.id, babyId: record.babyId, rank: rank || null,
                babyCount: client.fetalConfirmation === "CONFIRMED" ? activeBabies.length : null,
                legacyName: record.babyId === null ? record.babyName : null,
                retired: record.babyId !== null && rank === 0,
                status: record.status,
                linkAssignments,
                assignees: [...new Map(assignees.map((employee) => [employee.id, employee])).values()],
                totalSessions: servicePeriodSessionCount(record.startDate, record.endDate,
                    record.requiredSessionCount, calendar, hasAuthoritativeServiceRecordCount(record)),
                submittedSessions: record._count.days,
            };
        }).sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity));
        // An ambiguous household gets a list only. Never combine unbound schedule data with siblings.
        if (!target && (cases.length > 0 || activeBabies.length > 1)) {
            return { cases, record: null, assignments: [], legacyLinkAssignment: null, serviceDays };
        }

        const selectedId = target?.caseId;
        const legacy = caseRows.length <= 1 && activeBabies.length <= 1
            && target?.kind !== "retired";
        const legacyRecord = caseRows[0];
        const legacyLinkAssignment = legacy && canUseCurrentSchedule && currentSchedule
            && currentSchedule.primaryEmployee.branchId === branchId
            && currentSchedule.primaryEmployee.deletedAt === null
            && (!legacyRecord || (legacyRecord.babyId === null && isWritable(legacyRecord))
                || (historical?.caseId === legacyRecord.id && historical.scheduleId === currentSchedule.id
                    && historical.employeeId === currentSchedule.primaryEmployee.id))
            ? { scheduleId: currentSchedule.id, employeeId: currentSchedule.primaryEmployee.id }
            : null;
        const ownedRecord = selectedId ? await this.prisma.service_record_case.findFirst({
            where: { ...scope, id: selectedId, client: { branchId, deletedAt: null } },
            include: { days: { where: { branchId }, orderBy: { caseSessionIndex: "asc" } } },
        }) : null;
        if (selectedId && !ownedRecord) throw codeOnlyProblemException("RESOURCE_NOT_FOUND");
        const caseFilter: { serviceRecordCaseId: string | null }[] = [
            ...(selectedId ? [{ serviceRecordCaseId: selectedId }] : []),
            ...(legacy ? [{ serviceRecordCaseId: null }] : []),
        ];
        const [scheduleRows, headers, recordAssignments] = await Promise.all([
            this.prisma.employee_schedule.findMany({
                where: { ...scope, client: { branchId, deletedAt: null }, primaryEmployee: { branchId } },
                include: {
                    client: true,
                    primaryEmployee: true,
                    serviceRecordDays: { where: { branchId, OR: caseFilter }, orderBy: { sessionIndex: "asc" } },
                    serviceRecordTokens: {
                        where: { branchId, AND: [{ OR: caseFilter }, { OR: [{ active: true }, { revokedAt: { not: null } }] }] },
                        orderBy: { createdAt: "desc" },
                    },
                },
                orderBy: { startDate: "desc" },
            }),
            this.prisma.service_record.findMany({
                where: { branchId, OR: caseFilter, schedule: { ...scope, client: { branchId, deletedAt: null } } },
            }),
            selectedId ? this.prisma.service_record_assignment.findMany({
                where: { branchId, serviceRecordCaseId: selectedId, employee: { branchId } },
                select: { scheduleId: true, employee: { select: { id: true, name: true, phone: true } } },
            }) : [],
        ]);
        const schedules: ScheduleForOverview[] = scheduleRows.flatMap((schedule) => {
            const historical = recordAssignments.find(({ scheduleId }) => scheduleId === schedule.id);
            const owner = activeOwners.find(({ babyId, scheduleId }) => babyId === target?.babyId && scheduleId === schedule.id);
            if (!legacy && !owner && !historical && schedule.serviceRecordDays.length === 0) return [];
            return [{
                ...schedule,
                serviceRecord: headers.find((header) => header.scheduleId === schedule.id && header.serviceRecordCaseId === selectedId)
                    ?? headers.find((header) => header.scheduleId === schedule.id && header.serviceRecordCaseId === null)
                    ?? null,
                recordEmployee: owner?.employee ?? historical?.employee ?? (legacy ? schedule.primaryEmployee : undefined),
            }];
        }).filter((schedule) => schedule.recordEmployee !== undefined);
        const legacySummary = cases.find((item) => item.caseId === selectedId && item.babyId === null);
        if (legacySummary && legacy) {
            legacySummary.assignees = [...new Map(schedules.filter(({ replaced }) => !replaced)
                .map(({ primaryEmployee: { id, name } }) => [id, { id, name }])).values()];
        }
        const scheduleIds = schedules.map(({ id }) => id);
        const [jobs, signatureDocs] = await Promise.all([
            scheduleIds.length > 0 ? this.prisma.message_trigger_job.findMany({
                where: {
                    branchId, employeeScheduleId: { in: scheduleIds }, ruleId: SERVICE_RECORD_LINK_RULE_ID,
                    ...(legacy ? {} : { recordMembers: { some: { ...scope, serviceRecordCaseId: selectedId } } }),
                },
                orderBy: { createdAt: "desc" },
            }) : [],
            this.findServiceRecordSignatureDocs(branchId, clientId, scheduleIds, selectedId ?? null, legacy),
        ]);
        const jobIds = jobs.map((job) => job.id);
        const logScopes = [
            ...(jobIds.length > 0 ? [{ triggerJobId: { in: jobIds } }] : []),
            ...(legacy ? [{ clientId, triggerJobId: null }] : []),
        ];
        const logs = logScopes.length > 0 ? await this.prisma.message_log.findMany({
            where: { branchId, templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY, OR: logScopes },
            orderBy: { createdAt: "desc" },
        }) : [];
        const signatureDocByScheduleId = latestSignatureDocByScheduleId(signatureDocs);
        const scheduleProjection = this.editRepository
            && selectedId ? await this.loadScheduleProjection(branchId, clientId, calendar, selectedId)
            : undefined;

        return {
            cases,
            legacyLinkAssignment,
            record: ownedRecord ? this.mapCase(ownedRecord, signatureDocs, includeSignatures, calendar) : null,
            assignments: schedules.map((schedule) => this.mapAssignment(
                schedule,
                jobs.filter((job) => job.employeeScheduleId === schedule.id),
                logs.filter((log) => (
                    (log.triggerJobId !== null && jobIdsForSchedule(jobs, schedule.id).has(log.triggerJobId))
                    || (log.triggerJobId === null && logScheduleId(log) === schedule.id)
                )),
                signatureDocByScheduleId.get(schedule.id) ?? null,
                includeSignatures,
                calendar,
            )),
            ...(scheduleProjection ? { scheduleProjection } : {}),
            serviceDays,
        };
    }

    /**
     * Read-only editor access has a stricter not-found contract than the
     * existing overview endpoint.  The overview is intentionally allowed to
     * return an empty result for legacy callers, so assert the branch-owned
     * client before delegating to that existing read path.
     */
    async getClientEditor(branchId: string, clientId: number, caseId?: string): Promise<AdminServiceRecordOverviewDto> {
        const overview = await this.loadOverview(branchId, clientId, caseId, true);
        const selectedId = overview.record?.id;
        if (!selectedId) {
            if (overview.cases?.length) return overview;
            const calendar = await this.holidayCalendar.forBranch(branchId);
            return { ...overview, scheduleProjection: await this.loadScheduleProjection(branchId, clientId, calendar) };
        }
        if (this.editRepository) {
            const revisions = await this.editRepository.listRevisionsForChanges(branchId, clientId, selectedId);
            const confirmedAtBySession = new Map<number, Date>();
            for (const revision of revisions) {
                const changes = buildServiceRecordRevisionChanges(revision);
                for (const { sessionIndex } of changes.sessions) {
                    const previous = confirmedAtBySession.get(sessionIndex);
                    if (!previous || revision.confirmedAt > previous) {
                        confirmedAtBySession.set(sessionIndex, revision.confirmedAt);
                    }
                }
            }
            overview.adminEditConfirmedAtBySession = [...confirmedAtBySession]
                .sort(([left], [right]) => left - right)
                .map(([sessionIndex, confirmedAt]) => ({ sessionIndex, confirmedAt: confirmedAt.toISOString() }));
        }
        // getClientOverview carries the projection for the production DI
        // graph.  Keep the editor's explicit unavailable result for tests or
        // legacy modules that omit the optional edit repository.
        if (overview.scheduleProjection) return overview;
        const branchCalendar = await this.holidayCalendar.forBranch(branchId);
        const calendar = overview.serviceDays ? branchCalendar.withServiceDays(overview.serviceDays) : branchCalendar;
        const scheduleProjection = await this.loadScheduleProjection(branchId, clientId, calendar, selectedId);
        return { ...overview, scheduleProjection };
    }

    /** Read append-only revision history and safe document-operation state. */
    async getRevisionHistory(
        branchId: string,
        clientId: number,
        caseId?: string,
    ): Promise<ServiceRecordRevisionHistoryResponse> {
        const target = await resolveAdminServiceRecordTarget(this.prisma, { branchId, clientId, caseId }, "read");
        const repository = this.getRevisionStatusRepository();
        const result = await repository.listRevisionHistory(branchId, clientId, target?.caseId);
        if (result === null) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return normalizeRevisionHistoryResponse(result);
    }

    async getRevisionChanges(
        branchId: string,
        clientId: number,
        revisionId: string,
        caseId?: string,
    ): Promise<ServiceRecordRevisionChangesResponse> {
        const normalizedRevisionId = normalizePathIdentifier(revisionId);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedRevisionId)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const target = await resolveAdminServiceRecordTarget(this.prisma, { branchId, clientId, caseId }, "read");
        const result = await this.getRevisionStatusRepository().findRevisionForChanges(branchId, clientId, normalizedRevisionId, target?.caseId);
        if (result === null) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return buildServiceRecordRevisionChanges(result);
    }

    /** One caregiver edit (제공인력 수정) of a submitted day. Not a revision. */
    async getCaregiverEditChanges(
        branchId: string,
        clientId: number,
        editId: string,
        caseId?: string,
    ): Promise<ServiceRecordCaregiverEditChangesResponse> {
        const normalizedEditId = normalizePathIdentifier(editId);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedEditId)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const target = await resolveAdminServiceRecordTarget(this.prisma, { branchId, clientId, caseId }, "read");
        const result = await this.getRevisionStatusRepository().findCaregiverEditForChanges(branchId, clientId, normalizedEditId, target?.caseId);
        if (result === null) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return buildServiceRecordCaregiverEditChanges(result);
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
        const normalizedRevisionId = normalizePathIdentifier(revisionId);
        const normalizedDocumentStateId = normalizePathIdentifier(documentStateId);
        const normalizedGeneration = normalizeGeneration(expectedGeneration);
        const repository = this.getRevisionStatusRepository();
        const state = await repository.findRevisionDocumentStateForBranch(
            branchId,
            normalizedRevisionId,
            normalizedDocumentStateId,
        );
        if (state === null) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (state.generation !== normalizedGeneration) {
            // 세대 불일치는 대상 문서 상태가 요청 도중 바뀐 원인이므로 등록된 코드를 재사용해요(EM-CAT-02).
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        if (state.operation === "record_snapshot"
            && isInitialFinalizationWorkflowScopeForRevision(state.workflowScope, normalizedRevisionId)) {
            if (!this.finalizationService) {
                throw codeOnlyProblemException("REQUEST_CONFLICT", { reason: "SERVICE_RECORD_REVISION_GENERATION_UNAVAILABLE" });
            }
            const regenerated = await this.finalizationService.regenerateInitialFinalization(branchId, {
                revisionId: normalizedRevisionId, documentStateId: normalizedDocumentStateId,
                expectedGeneration: normalizedGeneration,
            });
            return { ...normalizeRevisionDocumentSummaryResult(regenerated.state), canRetry: false };

        }

        void actorUserId;
        const result = await this.prisma.$transaction(async (tx) => {
            // Follow the shared retry's case-before-state lock order.
            const ownerCases = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id FROM "service_record_case"
                WHERE id = ${state.serviceRecordCaseId}::uuid
                  AND branch_id = ${branchId}::uuid
                  AND client_id = ${state.clientId}
                  AND EXISTS (SELECT 1 FROM client
                      WHERE client.id = service_record_case.client_id
                        AND client.branch_id = service_record_case.branch_id AND client.deleted_at IS NULL)
                  AND (baby_id IS NULL OR EXISTS (SELECT 1 FROM client_baby
                      WHERE client_baby.id = service_record_case.baby_id AND client_baby.active))
                FOR UPDATE
            `);
            if (!ownerCases[0]) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const currentStates = await tx.$queryRaw<Array<{ status: string; version: number }>>(Prisma.sql`
                SELECT status, version FROM "service_record_revision_document_state"
                WHERE id = ${normalizedDocumentStateId}::uuid
                  AND branch_id = ${branchId}::uuid
                  AND client_id = ${state.clientId}
                  AND service_record_case_id = ${state.serviceRecordCaseId}::uuid
                  AND revision_id = ${normalizedRevisionId}::uuid
                  AND generation = ${normalizedGeneration}
                FOR UPDATE
            `);
            const current = currentStates[0];
            if (!current) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const retried = await repository.retryRevisionDocumentStateInTransaction({ tx }, {
                branchId,
                clientId: state.clientId,
                revisionId: normalizedRevisionId,
                stateId: normalizedDocumentStateId,
                expectedGeneration: normalizedGeneration,
            });
            if (retried === null || (retried.status === current.status && retried.version === current.version)) {
                // 잠근 현재 행과 같으면 이번 재시도가 실행되지 않은 요청 충돌이에요.
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            return retried;
        });
        return normalizeRevisionDocumentSummaryResult(result);
    }

    private getRevisionStatusRepository(): IServiceRecordEditRepository {
        if (!this.editRepository) {
            // 편집 저장소 미바인딩은 모듈 구성 전제 위반이고 상태는 409를 유지해요.
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        return this.editRepository;
    }

    private async loadScheduleProjection(
        branchId: string,
        clientId: number,
        calendar: KrBusinessDayCalendar,
        caseId?: string,
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
        const source = caseId ? await this.editRepository.loadSource(branchId, { clientId, caseId }) : null;
        if (!source) {
            return {
                entries: [],
                blockingReasons: [{
                    code: "SERVICE_RECORD_SOURCE_UNAVAILABLE",
                    message: "서비스 제공기록 원본을 확인할 수 없습니다.",
                }],
            };
        }
        const projection = resolveServiceRecordScheduleProjection(source, calendar);
        return {
            entries: projection.entries,
            blockingReasons: projection.blockingReasons,
        };
    }

    private mapCase(
        record: CaseForOverview,
        signatureDocs: SignatureDocRow[],
        includeSignatures: boolean,
        calendar: KrBusinessDayCalendar,
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
                calendar,
                // A stored N is the case's own count (display must agree with
                // what the caregiver page accepts); a holiday-calendar edit
                // never moves it. The period only derives N when none is stored.
                hasAuthoritativeServiceRecordCount(record),
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
        caseId?: string,
    ): Promise<AdminServiceRecordPreparedLinkDto> {
        await this.assertLinkTarget(branchId, scheduleId, caseId);
        return { kind: "legacy", ...await this.serviceRecordLinkService.prepareLink(scheduleId, recipientPhone) };
    }

    async resetLink(
        branchId: string,
        scheduleId: number,
        actor?: ServiceRecordAdminActor,
    ): Promise<AdminServiceRecordResetLinkDto> {
        if (this.securityEventService && !actor?.userId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        await this.assertLinkTarget(branchId, scheduleId);
        const reset = await this.serviceRecordLinkService.resetLink(scheduleId);
        this.securityEventService?.emit({
            outcome: "link_reissued",
            actorUserId: actor?.userId,
            branchId,
            scheduleId,
        });
        return { kind: "legacy", ...reset };
    }

    async sendLinkNow(
        branchId: string,
        scheduleId: number,
        preparedLinkToken?: string,
        recipientPhone?: string,
        caseId?: string,
        actorUserId?: string,
    ) {
        await this.assertLinkTarget(branchId, scheduleId, caseId);
        const queued = await this.serviceRecordLinkService.sendNow(
            scheduleId,
            preparedLinkToken,
            recipientPhone,
            ...(actorUserId ? [actorUserId] as const : [] as const),
        );
        return this.dispatchRecordLink(branchId, queued);
    }

    private async dispatchRecordLink(branchId: string, queued: { jobId: string; scheduledFor: Date }) {
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

    async listLinkTargets(branchId: string, scheduleId: number) {
        return this.linkGroups!.targets(branchId, scheduleId);
    }

    async prepareLinkGroup(branchId: string, scheduleId: number, input: RecordLinkPrepareSelection) {
        return this.linkGroups!.prepare(branchId, scheduleId, input);
    }

    async sendLinkGroup(branchId: string, scheduleId: number, input: RecordLinkSendSelection, actorUserId: string) {
        if (!actorUserId) throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        const queued = await this.serviceRecordLinkService.sendGroupNow(branchId, scheduleId, input, actorUserId);
        return this.dispatchRecordLink(branchId, queued);
    }

    async resetLinkGroup(branchId: string, scheduleId: number, input: RecordLinkSelection, actor: ServiceRecordAdminActor) {
        if (!actor.userId) throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        const result = await this.linkGroups!.reset(branchId, scheduleId, input);
        this.securityEventService?.emit({
            outcome: "link_reissued", actorUserId: actor.userId, branchId, scheduleId, employeeId: input.employeeId,
        });
        return result;
    }

    private async assertLinkTarget(branchId: string, scheduleId: number, caseId?: string): Promise<void> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId, client: { branchId, deletedAt: null } },
            select: { id: true, clientId: true },
        });
        if (!schedule) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const scope = { branchId, clientId: schedule.clientId };
        if (caseId !== undefined) {
            await resolveAdminServiceRecordTarget(this.prisma, { ...scope, caseId }, "write");
        }
        const cases = await this.prisma.service_record_case.findMany({
            where: scope,
            select: { id: true, babyId: true },
            take: 2,
        });
        const babies = await this.prisma.client_baby.count({ where: { ...scope, active: true } });
        if (cases.length > 1 || babies > 1 || (caseId !== undefined && cases[0]?.id !== caseId)) {
            throw codeOnlyProblemException("REQUEST_CONFLICT", { reason: "SERVICE_RECORD_CASE_SELECTION_REQUIRED" });
        }
        if (cases.length === 1 && cases[0]?.babyId) {
            const owner = await this.prisma.service_record_baby_assignment.findFirst({
                where: { ...scope, scheduleId, babyId: cases[0].babyId, activeOwner: true,
                    schedule: { replaced: false, terminatedAt: null } },
                select: { employeeId: true, schedule: { select: { primaryEmployeeId: true } } },
            });
            if (!owner || owner.employeeId !== owner.schedule.primaryEmployeeId) {
                throw codeOnlyProblemException("REQUEST_CONFLICT", { reason: "SERVICE_RECORD_CASE_SELECTION_REQUIRED" });
            }
        }
    }

    private mapAssignment(
        schedule: ScheduleForOverview,
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        signatureDoc: AdminServiceRecordSignatureDocDto | null,
        includeSignatures: boolean,
        calendar: KrBusinessDayCalendar,
    ): AdminServiceRecordAssignmentDto {
        const employee = schedule.recordEmployee ?? schedule.primaryEmployee;
        return {
            scheduleId: schedule.id,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            replaced: schedule.replaced,
            employee: { id: employee.id, name: employee.name, phone: employee.phone },
            link: this.deriveLink(jobs, logs, schedule.serviceRecordTokens[0] ?? null),
            header: schedule.serviceRecord ? this.mapHeader(schedule.serviceRecord) : null,
            totalSessions: servicePeriodSessionCount(
                schedule.client.startDate ?? schedule.startDate,
                schedule.client.endDate ?? schedule.endDate,
                schedule.client.duration,
                calendar,
            ),
            sessions: schedule.serviceRecordDays.map((session) => this.mapSession(session, includeSignatures)),
            signatureDoc,
        };
    }

    /**
     * The status follows the NEWEST attempt, not the whole history: a failed
     * resend after an old success is a failure, a job that failed while being
     * prepared (no log row) is a failure, a job the scheduler is currently
     * delivering is "sending", and a newer canceled job is "canceled" even
     * after an older success. `sentCount`/`lastSentAt` stay all-time history.
     *
     * Attempt time is `updatedAt` for a job (it moves on every claim, retry
     * and terminal transition) and `lastAttemptAt ?? createdAt` for a log.
     * Rows are compared by that time, never by query order.
     */
    private deriveLink(
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        token: ScheduleForOverview["serviceRecordTokens"][number] | null,
    ): AdminServiceRecordLinkDto {
        const sentLogs = logs
            .filter((log) => log.status === "sent")
            .sort((left, right) => this.logActivityTime(right) - this.logActivityTime(left));
        const sentCount = sentLogs.length;

        // A log never outranks its own job while that job is still in flight:
        // a retried job is pending/processing/dispatching even though its
        // earlier attempt logged a failure.
        const inFlightJobIds = new Set(
            jobs.filter((job) => isInFlightLinkJob(job)).map((job) => job.id),
        );
        // A canceled scheduling lease is cleanup, not an attempt: its cancel
        // bumps updatedAt, which would otherwise outrank a real delivery that
        // succeeded after the lease was created (the lease's only real moment).
        // It is skipped ONLY when such a success exists; with no later success
        // it still counts and shows "canceled", and a genuine canceled resend
        // (any other reason, or canceled by a user) is never skipped.
        const latestSuccessTime = Math.max(
            -Infinity,
            ...logs.filter((log) => log.status === "sent").map((log) => this.logActivityTime(log)),
            ...jobs.filter((job) => job.status === "sent").map((job) => this.jobActivityTime(job)),
        );
        const isSupersededLease = (job: ServiceRecordLinkJob): boolean => (
            isCanceledSchedulingLease(job) && latestSuccessTime > job.createdAt.getTime()
        );
        // A carrier-check failure lands ~30 minutes after the send, flips the log
        // to "failed" and happens after its trigger job already went "sent". That
        // failure is the verdict on THAT job's delivery, so it replaces its own
        // job as an attempt. It deliberately does not lift the log's time: an
        // unrelated newer job (e.g. a link created after the send but before the
        // check) is a newer attempt and must still win.
        const carrierFailedJobIds = new Set(
            logs
                .filter((log) => (
                    (log.status === "sent" || log.status === "failed")
                    && log.carrierResultState === "failed"
                    && log.carrierCheckedAt
                    && log.triggerJobId !== null
                    && !inFlightJobIds.has(log.triggerJobId)
                ))
                .flatMap((log) => {
                    const ownJob = jobs.find((job) => job.id === log.triggerJobId);
                    return ownJob && log.carrierCheckedAt!.getTime() >= this.jobActivityTime(ownJob)
                        ? [ownJob.id]
                        : [];
                }),
        );
        const attempts: LinkAttempt[] = [
            ...jobs
                .filter((job) => !isSupersededLease(job) && !carrierFailedJobIds.has(job.id))
                .map((job): LinkAttempt => ({ kind: "job", time: this.jobActivityTime(job), job })),
            ...logs
                .filter((log) => (
                    (log.status === "sent" || log.status === "failed")
                    && !(log.triggerJobId !== null && inFlightJobIds.has(log.triggerJobId))
                ))
                .map((log): LinkAttempt => ({ kind: "log", time: this.logActivityTime(log), log })),
        ];
        // Equal timestamps: prefer the job (it carries the in-flight state).
        attempts.sort((left, right) => (
            right.time - left.time || Number(right.kind === "job") - Number(left.kind === "job")
        ));
        const newest = attempts[0] ?? null;

        let status: AdminServiceRecordLinkStatus = "none";
        let scheduledFor: Date | null = null;
        if (newest?.kind === "log") {
            status = newest.log.status === "sent" ? "sent" : "failed";
        } else if (newest?.kind === "job") {
            switch (newest.job.status) {
                case "pending":
                    status = "scheduled";
                    scheduledFor = newest.job.scheduledFor;
                    break;
                case "processing":
                case "dispatching":
                    status = "sending";
                    break;
                case "sent":
                    status = "sent";
                    break;
                case "failed":
                    status = "failed";
                    break;
                case "canceled":
                    status = "canceled";
                    break;
                default:
                    break;
            }
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
        if (token.expiresAt.getTime() <= Date.now()) return "expired";
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
            periodMismatchKeptAt: session.periodMismatchKeptAt?.toISOString() ?? null,
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
            statusType: document.statusType,
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

    private jobActivityTime(job: ServiceRecordLinkJob): number {
        return (job.updatedAt ?? job.createdAt).getTime();
    }

    private async findServiceRecordSignatureDocs(
        branchId: string,
        clientId: number,
        scheduleIds: number[],
        serviceRecordCaseId: string | null,
        legacy: boolean,
    ): Promise<SignatureDocRow[]> {
        try {
            return await this.prisma.eformsign_doc.findMany({
                where: {
                    branchId,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                    AND: [{ OR: [{ clientId }, { clientId: null }] }],
                    OR: [
                        ...(serviceRecordCaseId ? [{ serviceRecordCaseId }] : []),
                        ...(legacy && scheduleIds.length > 0 ? [{ serviceRecordCaseId: null, employeeScheduleId: { in: scheduleIds } }] : []),
                    ],
                },
                select: {
                    employeeScheduleId: true,
                    documentId: true,
                    statusType: true,
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

function normalizePathIdentifier(value: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 255) {
        // 경로 식별자는 공개 메시지에 노출하지 않고 등록 코드만 응답해요.
        throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
    }
    return value;
}

function normalizeGeneration(value: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
        // 상태는 409를 유지하고 등록된 충돌 코드로 응답해요.
        throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
    }
    return value;
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
    // A missing field (older repository/read model) is an empty list; a present
    // but malformed one is rejected like any other part of this response.
    const rawCaregiverEdits = readField(row, ["caregiverEdits", "caregiver_edits"]);
    if (rawCaregiverEdits !== undefined && rawCaregiverEdits !== null && !Array.isArray(rawCaregiverEdits)) {
        throw new Error("Invalid service-record caregiver edit history response");
    }
    const caregiverEdits = asRows(rawCaregiverEdits ?? []).map(normalizeCaregiverEditSummary);
    return {
        caseId,
        caseVersion,
        currentRevisionId,
        currentUsableRevisionId,
        revisions,
        caregiverEdits,
    };
}

function normalizeCaregiverEditSummary(row: Record<string, unknown>): ServiceRecordCaregiverEditSummary {
    const id = readStringField(row, ["id"]);
    const editedAt = normalizeIsoDate(readField(row, ["editedAt", "edited_at"]));
    const sessionIndex = readPositiveIntegerField(row, ["sessionIndex", "session_index"]);
    const employeeName = readStringField(row, ["employeeName", "employee_name"]);
    if (!id || !editedAt || sessionIndex === null || !employeeName) {
        throw new Error("Invalid service-record caregiver edit summary response");
    }
    // Only these four fields cross the list boundary; before/after never do.
    return { id, editedAt, sessionIndex, employeeName };
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
    const regenerationBlockedReason = normalizeReasonCode(readField(row, ["regenerationBlockedReason", "regeneration_blocked_reason"]));
    const projection = asObject(row["noProviderDocumentConfirmable"]);
    const revisionId = readStringField(projection ?? {}, ["revisionId"]);
    const suffix = readStringField(projection ?? {}, ["suffix"]);
    const ordinals = projection?.["unlinkedChunkOrdinals"];
    const noProviderDocumentConfirmable = projection?.["stateId"] === id && projection["generation"] === generation
        && revisionId && suffix && Array.isArray(ordinals) && ordinals.every((ordinal): ordinal is string => typeof ordinal === "string")
        ? { stateId: id, generation, revisionId, suffix, unlinkedChunkOrdinals: ordinals } : undefined;
    return {
        id,
        operation,
        generation,
        status,
        documentVersion: readPositiveIntegerField(row, ["documentVersion", "document_version"]),
        canRetry: directCanRetry === true,
        reasonCode,
        ...(regenerationBlockedReason ? { regenerationBlockedReason } : {}),
        ...(noProviderDocumentConfirmable ? { noProviderDocumentConfirmable } : {}),
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
        statusType: doc.statusType,
        statusDetail: doc.statusDetail,
        stepName: doc.stepName,
        createdDate: doc.createdDate,
        updatedDate: doc.updatedDate,
        snapshotVersion: doc.snapshotVersion,
        snapshotChunkIndex: doc.snapshotChunkIndex,
        employeeScheduleId: doc.employeeScheduleId,
    };
}
