import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import {
    UnsupportedKoreanHolidayYearError,
    type KrBusinessDayCalendar,
} from "@babyjamjam/shared/utils/business-days";
import { isValidBirthdayIsoDate, normalizeContractBirthday } from "@babyjamjam/shared/utils/birthday";
import { getServiceRecordHeaderFieldError } from "@babyjamjam/shared/utils/service-record-input";

import { IMMUTABLE_FINALIZATION_STATUSES } from "application/services/service-record-lifecycle.service";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { configuredServiceRecordTemplateIds } from "application/utils/eformsign-document-kind";
import { serviceRecordSignatureFingerprint } from "application/utils/service-record-signature-fingerprint";
import {
    validateServiceRecordAnswers,
    validateServiceRecordEditText,
} from "application/policies/service-record-answer-validation.policy";
import {
    buildServiceRecordEditPreview,
    confirmAssignmentWrites,
    draftResumeReplan,
    draftServiceDays,
    normalizeServiceRecordEditChanges,
    resolveResumeReplan,
    sameServiceDays,
    ServiceRecordResumeAssignmentError,
    ServiceRecordScheduleValidationError,
    storedServiceDays,
    type ServiceRecordEditDateMove,
    type ServiceRecordEditResumeReplan,
    type ServiceRecordEditScheduleReplacement,
} from "application/policies/service-record-edit-preview.policy";
import {
    ServiceRecordEditConflictError,
    ServiceRecordEditNotFoundError,
    ServiceRecordRevisionOperationUnresolvedError,
    SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE,
    SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE,
} from "domain/errors/service-record-edit.error";
import {
    buildServiceRecordContractRevisionSnapshot,
} from "application/services/service-record-revision-document-coordinator.service";
import {
    buildServiceRecordRevisionTargetFieldMap,
    captureServiceRecordRevisionFacts,
    type ServiceRecordRevisionFactsResult,
} from "application/policies/service-record-revision-facts.policy";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type CreateServiceRecordEditDraftInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditDraft,
    type ServiceRecordEditConfirmPlan,
    type ServiceRecordEditConfirmOperationPlan,
    type ServiceRecordEditConfirmNewSession,
    type ServiceRecordEditConfirmSessionUpdate,
    type ServiceRecordEditJsonObject,
    type ServiceRecordEditJsonValue,
    type ServiceRecordEditSource,
    type ServiceRecordEditSourceDay,
    type ServiceRecordEditRevisionFactsSource,
} from "domain/repositories/service-record-edit.repository.interface";
import type {
    ServiceRecordEditConfirmDocumentStatus,
    ServiceRecordEditConfirmResponse,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";
import type {
    AdminServiceRecordEditChangesDto,
    AdminServiceRecordEditStateDto,
    ConfirmServiceRecordEditDraftDto,
    CreateServiceRecordEditDraftDto,
    DiscardServiceRecordEditDraftDto,
    PreviewServiceRecordEditDraftDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { ServiceRecordCaseEventBus } from "application/services/service-record-case-event-bus.service";
import { getServiceRecordFinalizationDueAt } from "domain/constants/service-record-link-message";


const EDITABLE_HEADER_KEYS = new Set([
    "momName",
    "momBirth",
    "babyName",
    "babyBirth",
    "deliveryType",
    "babyWeight",
]);
const EDITABLE_SESSION_KEYS = new Set([
    "sessionIndex",
    "serviceDate",
    "answers",
    "etcService",
    "notes",
    "paymentConfirmed",
]);
const MAX_CHANGES_BYTES = 64 * 1024;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_RECORD_HEADER_LEGACY_DATE_PATTERN = /^\d{6}$/;
const SERVICE_RECORD_HEADER_WEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceSnapshot = ServiceRecordEditSource;

interface LoadedSource {
    source: SourceSnapshot;
    fingerprint: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * New saves are ISO (YYYY-MM-DD) and must be a real calendar date between
 * 1900-01-01 and today (Korean calendar, shared ISO input policy). Legacy
 * six-digit writes stay valid during the client rollout with the same
 * century-pivot and range semantics as before.
 */
function isValidServiceRecordBirthday(value: string): boolean {
    return isValidBirthdayIsoDate(value)
        || (SERVICE_RECORD_HEADER_LEGACY_DATE_PATTERN.test(value) && normalizeContractBirthday(value) !== null);
}

function validateServiceRecordHeaderValue(key: string, value: string): void {
    if (!value) return;

    if (key === "momBirth" || key === "babyBirth") {
        if (!value.trim()) return; // whitespace-only stays an explicit blank clear
        // The supplied string must be valid exactly as sent: a padded value is
        // rejected rather than trimmed into a valid date.
        if (value !== value.trim() || !isValidServiceRecordBirthday(value)) {
            throw new BadRequestException({
                code: "SERVICE_RECORD_HEADER_DATE_INVALID",
                message: key === "momBirth"
                    ? "산모 생년월일은 YYYY-MM-DD 형식의 유효한 날짜로 입력해 주세요."
                    : "신생아 출생일자는 YYYY-MM-DD 형식의 유효한 날짜로 입력해 주세요.",
            });
        }
        return;
    }

    if (key === "momName" || key === "babyName" || key === "deliveryType") {
        // Same shared field policy the employee service-record header write
        // path enforces (spacing rules, 분만형태 options).
        const policyError = getServiceRecordHeaderFieldError(key, value);
        if (policyError) {
            throw new BadRequestException({
                code: key === "deliveryType" ? "SERVICE_RECORD_HEADER_DELIVERY_TYPE_INVALID" : "SERVICE_RECORD_HEADER_NAME_INVALID",
                message: policyError,
            });
        }
        return;
    }

    if (key === "babyWeight") {
        const numeric = Number(value);
        if (!SERVICE_RECORD_HEADER_WEIGHT_PATTERN.test(value) || !Number.isFinite(numeric) || numeric <= 0) {
            throw new BadRequestException({
                code: "SERVICE_RECORD_HEADER_WEIGHT_INVALID",
                message: "신생아 몸무게는 0보다 큰 숫자로 입력해 주세요.",
            });
        }
    }
}

function jsonValue(value: unknown): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((item) => jsonValue(item));
    if (isPlainRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, jsonValue(item)]),
        );
    }
    // 저장된 원본 스냅숏이 JSON으로 정준화되지 못하는 데이터 무결성 거절이므로
    // 요청 필드 사유 없이 등록 코드만 응답해요.
    throw new BadRequestException(codeOnlyProblemBody("VALIDATION_FAILED"));
}

function stableStringify(value: ServiceRecordEditJsonValue): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    if (isPlainRecord(value)) {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function jsonFingerprint(value: ServiceRecordEditJsonValue): string {
    return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function sourceFingerprint(source: SourceSnapshot): string {
    // Lifecycle/retry timestamps and the optimistic case version are kept in
    // the immutable snapshot but deliberately excluded from this business
    // fingerprint. A status-only transition must not invalidate a draft.
    const serviceDays = storedServiceDays(source);
    const fingerprintPayload = jsonValue({
        caseId: source.caseId,
        branchName: source.branchName ?? null,
        formVersion: source.formVersion,
        requiredSessionCount: source.requiredSessionCount,
        startDate: source.startDate,
        endDate: source.endDate,
        client: {
            id: source.client.id,
            name: source.client.name,
            duration: source.client.duration,
            startDate: source.client.startDate,
            endDate: source.client.endDate,
            // Keyed only when a toggle is on, so a draft saved before the toggles existed
            // (every client all-false) keeps the fingerprint it was saved with.
            ...(serviceDays.saturday || serviceDays.sunday || serviceDays.holiday ? { serviceDays } : {}),
        },
        header: source.header,
        sessions: source.sessions,
        assignments: source.assignments,
        plannedSessions: source.plannedSessions,
        signatureMetadata: source.signatureMetadata ?? null,
        documentScope: source.documentScope ?? null,
    });
    return createHash("sha256").update(stableStringify(fingerprintPayload)).digest("hex");
}

function mapDraft(draft: ServiceRecordEditDraft): ServiceRecordEditDraft {
    return draft;
}

function asJsonRecord(value: ServiceRecordEditJsonValue | undefined): Record<string, ServiceRecordEditJsonValue> | null {
    return isPlainRecord(value) ? value as Record<string, ServiceRecordEditJsonValue> : null;
}

interface ConfirmSessionPatch {
    sessionIndex: number;
    serviceDate?: string;
    answers?: ServiceRecordEditJsonValue;
    etcService?: string;
    notes?: string;
    paymentConfirmed?: boolean;
}

function sessionChangeMap(value: ServiceRecordEditJsonValue | undefined): Map<number, ConfirmSessionPatch> {
    if (!Array.isArray(value)) return new Map();
        const result = new Map<number, ConfirmSessionPatch>();
        for (const item of value) {
            const record = asJsonRecord(item);
            if (!record) continue;
            const index = record["sessionIndex"];
            if (typeof index !== "number" || !Number.isInteger(index) || index < 1) continue;
            const patch: ConfirmSessionPatch = { sessionIndex: index };
            if (typeof record["serviceDate"] === "string") patch.serviceDate = record["serviceDate"];
            if (record["answers"] !== undefined) patch.answers = record["answers"];
            if (typeof record["etcService"] === "string") patch.etcService = record["etcService"];
            if (typeof record["notes"] === "string") patch.notes = record["notes"];
            if (typeof record["paymentConfirmed"] === "boolean") patch.paymentConfirmed = record["paymentConfirmed"];
            result.set(index, patch);
        }
    return result;
}

function hasEffectiveFutureContent(patch: ConfirmSessionPatch): boolean {
    let hasAnswers = false;
    if (patch.answers !== undefined) {
        if (Array.isArray(patch.answers)) hasAnswers = patch.answers.length > 0;
        else if (isPlainRecord(patch.answers)) hasAnswers = Object.keys(patch.answers).length > 0;
        else hasAnswers = patch.answers !== null;
    }
    return hasAnswers
        || (typeof patch.etcService === "string" && patch.etcService.trim().length > 0)
        || (typeof patch.notes === "string" && patch.notes.trim().length > 0)
        || patch.paymentConfirmed === true;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
    if (left === undefined || right === undefined) return left === right;
    try {
        return stableStringify(jsonValue(left)) === stableStringify(jsonValue(right));
    } catch {
        return false;
    }
}

function hasExistingContentDifference(
    source: ServiceRecordEditSourceDay,
    patch: ConfirmSessionPatch,
): boolean {
    const effectiveAnswers = patch.answers === undefined
        ? source.answers
        : mergeSparseAnswers(source.answers, patch.answers);
    return (
        patch.answers !== undefined && !sameJsonValue(effectiveAnswers, source.answers)
        || patch.etcService !== undefined && !sameJsonValue(patch.etcService, source.etcService)
        || patch.notes !== undefined && !sameJsonValue(patch.notes, source.notes)
        || patch.paymentConfirmed !== undefined && !sameJsonValue(patch.paymentConfirmed, source.paymentConfirmed)
    );
}

function mergeSparseAnswers(
    source: ServiceRecordEditJsonValue,
    patch: ServiceRecordEditJsonValue | undefined,
): ServiceRecordEditJsonValue {
    if (patch === undefined) return source;
    const patchRecord = asJsonRecord(patch);
    if (!patchRecord) return patch;
    return jsonValue({
        ...(asJsonRecord(source) ?? {}),
        ...patchRecord,
    });
}

function effectivePreviewChanges(
    source: ServiceRecordEditSource,
    changes: ServiceRecordEditJsonValue,
): ServiceRecordEditJsonValue {
    const changesRecord = asJsonRecord(changes);
    if (!changesRecord || !Array.isArray(changesRecord["sessions"])) return changes;

    const sessions = changesRecord["sessions"].map((value) => {
        const patch = asJsonRecord(value);
        if (!patch) return value;
        const sessionIndex = patch["sessionIndex"];
        if (typeof sessionIndex !== "number" || !Number.isInteger(sessionIndex)) return value;
        const sourceDay = source.sessions.find((day) => day.sessionIndex === sessionIndex);
        if (!sourceDay || patch["answers"] === undefined) return value;
        return {
            ...patch,
            answers: mergeSparseAnswers(sourceDay.answers, patch["answers"]),
        };
    });

    return jsonValue({ ...changesRecord, sessions });
}

function hasPlannedDateDifference(
    before: Array<{ sessionIndex: number; serviceDate: string }>,
    after: Array<{ sessionIndex: number; serviceDate: string }>,
): boolean {
    return after.some((entry) => before.find((candidate) => candidate.sessionIndex === entry.sessionIndex)?.serviceDate !== entry.serviceDate);
}

function hasPlannedOwnerDifference(
    before: Array<{ sessionIndex: number; assignmentId: string }>,
    after: Array<{ sessionIndex: number; assignmentId: string }>,
): boolean {
    return after.some((entry) => before.find((candidate) => candidate.sessionIndex === entry.sessionIndex)?.assignmentId !== entry.assignmentId);
}

function sameInstant(left: string | null, right: string | null): boolean {
    if (left === null || right === null) return left === right;
    return new Date(left).getTime() === new Date(right).getTime();
}

function buildFutureContentSession(
    source: ServiceRecordEditSource,
    projected: {
        sessionIndex: number;
        serviceDate: string;
        originalDate: string;
        assignmentId: string;
        scheduleId: number;
        employeeId: number;
        provenanceVersion: string;
    },
    beforeOriginalDate: string | undefined,
    patch: ConfirmSessionPatch,
): ServiceRecordEditConfirmNewSession {
    const assignment = source.assignments.find((candidate) => candidate.id === projected.assignmentId);
    const employeeName = assignment?.employeeName ?? assignment?.primaryEmployeeName;
    const canonicalBranchId = source.client.branchId;
    if (
        !canonicalBranchId
        || !assignment
        || !assignment.id
        || assignment.branchId !== canonicalBranchId
        || assignment.serviceRecordCaseId !== source.caseId
        || assignment.scheduleId !== projected.scheduleId
        || assignment.employeeId !== projected.employeeId
        || !Number.isInteger(projected.scheduleId)
        || projected.scheduleId < 1
        || !Number.isInteger(projected.employeeId)
        || projected.employeeId < 1
        || typeof employeeName !== "string"
        || employeeName.trim().length === 0
        || !Number.isInteger(source.formVersion)
        || source.formVersion < 1
        || typeof beforeOriginalDate !== "string"
        || beforeOriginalDate.length === 0
        || typeof projected.assignmentId !== "string"
        || projected.assignmentId.length === 0
        || typeof projected.provenanceVersion !== "string"
        || projected.provenanceVersion.length === 0
    ) {
        // 향후 회차 근거(배정·일정 투영)를 확인할 수 없는 상태 충돌이므로 등록 코드로
        // 응답해요. sessionIndex는 실행시점 데이터라 카탈로그에 넣지 않고(EM-CAT-04)
        // 호환 별칭으로만 유지해요.
        throw new ConflictException({
            ...codeOnlyProblemBody("REQUEST_CONFLICT"),
            sessionIndex: projected.sessionIndex,
        });
    }

    return {
        sourceRowId: randomUUID(),
        sessionIndex: projected.sessionIndex,
        serviceDate: projected.serviceDate,
        originalDate: beforeOriginalDate,
        assignmentId: projected.assignmentId,
        provenanceVersion: projected.provenanceVersion,
        answers: patch.answers ?? {},
        etcService: patch.etcService ?? null,
        notes: patch.notes ?? null,
        paymentConfirmed: patch.paymentConfirmed ?? false,
        momApproval: null,
        clientSignature: null,
        clientSignedAt: null,
        locked: false,
        submittedAt: null,
        scheduleId: projected.scheduleId,
        employeeId: projected.employeeId,
        employeeNameSnapshot: employeeName,
        formVersion: source.formVersion,
    };
}

function documentStatusForSource(source: ServiceRecordEditSource): ServiceRecordEditConfirmDocumentStatus {
    // Phase0 has not proved that a revised record can be rendered and
    // delivered by the provider. Contract stage is therefore presentation
    // metadata only; it must never authorize a new revision operation.
    void source;
    return "capability_unverified";
}

const COMPLETE_SERVICE_RECORD_CASE_STATUSES = new Set([
    "READY_TO_FINALIZE",
    "FINALIZING",
    "FINALIZATION_FAILED",
    "DOCUMENTS_CREATED",
    "COMPLETED",
]);

interface RevisionCompletenessSession {
    sourceRowId: string;
    sessionIndex: number;
    locked: boolean;
    submittedAt: string | null;
    clientSignature: string | null;
    clientSignedAt: string | null;
    momApproval: string | null;
    employeeId: number | null;
    employeeNameSnapshot: string | null;
    scheduleId: number | null;
    formVersion: number;
}

/**
 * A confirm may create a revision while later sessions are still unwritten.
 * Only a source that carries every submitted/signature-bearing row and an
 * observed lifecycle completion state can be handed to a complete document
 * generation worker.  The check is deliberately fail-closed: N, duration,
 * and the editor's planned vector are never inferred from one another.
 */
function revisionCompleteness(
    source: ServiceRecordEditSource,
    header: ServiceRecordEditSource["header"] = source.header,
    sessions: readonly RevisionCompletenessSession[] = source.sessions,
): "complete" | "partial" {
    const required = source.requiredSessionCount;
    if (
        !Number.isInteger(required)
        || required === null
        || required < 1
    ) {
        return "partial";
    }
    if (
        sessions.length !== required
        || !COMPLETE_SERVICE_RECORD_CASE_STATUSES.has(source.caseLifecycle?.status ?? "")
        || (source.signatureMetadata && source.signatureMetadata.evidence !== "observed")
    ) {
        return "partial";
    }

    const seen = new Set<number>();
    const completeHeader = Object.values(header).every((value) => Boolean(value?.trim()));
    if (!completeHeader) return "partial";

    const sourceRows = new Map(source.sessions.map((day) => [day.sourceRowId, day]));
    for (const day of sessions) {
        const sourceDay = sourceRows.get(day.sourceRowId);
        if (
            sourceDay?.ambiguous
            || !Number.isInteger(day.sessionIndex)
            || day.sessionIndex < 1
            || day.sessionIndex > required
            || seen.has(day.sessionIndex)
            || !day.locked
            || !day.submittedAt
            || !day.clientSignature
            || !day.clientSignedAt
            || day.momApproval !== "approved"
            || !Number.isInteger(day.employeeId)
            || (day.employeeId ?? 0) < 1
            || !Number.isInteger(day.scheduleId)
            || (day.scheduleId ?? 0) < 1
            || !day.employeeNameSnapshot
            || !Number.isInteger(day.formVersion)
            || day.formVersion < 1
        ) {
            return "partial";
        }
        seen.add(day.sessionIndex);
    }

    for (let sessionIndex = 1; sessionIndex <= required; sessionIndex += 1) {
        if (!seen.has(sessionIndex)) return "partial";
    }
    return "complete";
}

@Injectable()
export class AdminServiceRecordEditService {
    constructor(
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly repository: IServiceRecordEditRepository,
        private readonly holidayCalendar: HolidayCalendarService,
        @Optional() private readonly caseEventBus?: ServiceRecordCaseEventBus,
        // Optional so positional construction in specs keeps working; without it the template
        // ids fall back to process.env exactly like `configuredServiceRecordTemplateIds()`.
        @Optional() private readonly configService?: ConfigService,
    ) {}

    private readonly logger = new Logger(AdminServiceRecordEditService.name);

    async startDraft(
        branchId: string,
        clientId: number,
        actorUserId: string,
        dto: CreateServiceRecordEditDraftDto = {},
    ): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const validatedChanges = this.validateChanges(dto.changes, loaded.source);
        if (this.changesCarryServiceDate(validatedChanges)) {
            const existing = await this.repository.findActiveDraft(branchId, loaded.source.caseId);
            // createOrResumeDraft ignores input.changes on ACTIVE rows. Resume that
            // row without normalizing dates which will never be applied.
            if (existing) return this.state(existing, loaded);
        }
        const changes = await this.normalizeStartChanges(branchId, loaded.source, validatedChanges);
        const input: CreateServiceRecordEditDraftInput = {
            branchId,
            serviceRecordCaseId: loaded.source.caseId,
            actorUserId,
            sourceCaseVersion: loaded.source.caseVersion,
            sourceFingerprint: loaded.fingerprint,
            sourceSnapshot: jsonValue({ ...loaded.source, caseVersion: loaded.source.caseVersion }),
            ...(changes ? { changes } : {}),
        };
        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.createOrResumeDraft(input);
        } catch (error) {
            this.throwRepositoryNotFound(error);
        }
        return this.state(draft, loaded);
    }

    /**
     * Like `startDraft`, but only ever returns a draft this call created. When the case already
     * has an ACTIVE draft (including one created a moment ago by the same person) it answers 409
     * REQUEST_CONFLICT and touches nothing, so a caller that updates or discards what it started
     * can never act on somebody else's draft.
     */
    async startOwnDraft(
        branchId: string,
        clientId: number,
        actorUserId: string,
        dto: CreateServiceRecordEditDraftDto = {},
    ): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const changes = await this.normalizeStartChanges(
            branchId, loaded.source, this.validateChanges(dto.changes, loaded.source),
        );
        const input: CreateServiceRecordEditDraftInput = {
            branchId,
            serviceRecordCaseId: loaded.source.caseId,
            actorUserId,
            sourceCaseVersion: loaded.source.caseVersion,
            sourceFingerprint: loaded.fingerprint,
            sourceSnapshot: jsonValue({ ...loaded.source, caseVersion: loaded.source.caseVersion }),
            ...(changes ? { changes } : {}),
        };
        let draft: ServiceRecordEditDraft | null;
        try {
            draft = await this.repository.createDraftIfNoneActive(input);
        } catch (error) {
            this.throwRepositoryNotFound(error);
        }
        if (!draft) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        return this.state(draft, loaded);
    }

    async getDraft(branchId: string, clientId: number): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const draft = await this.repository.findActiveDraft(branchId, loaded.source.caseId);
        return this.state(draft, loaded);
    }

    /**
     * Read-only lookup of a confirmed draft's stored response by the idempotency key the caller
     * confirmed with. Lets a caller that lost the confirm response find out whether it landed,
     * without confirming again.
     */
    async findConfirmedResponseByIdempotencyKey(
        branchId: string,
        actorUserId: string,
        idempotencyKey: string,
    ): Promise<unknown | null> {
        const found = await this.repository.findConfirmedDraftByIdempotencyKey(branchId, actorUserId, idempotencyKey);
        return found?.confirmationResponse ?? null;
    }

    async updateDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: UpdateServiceRecordEditDraftDto,
    ): Promise<AdminServiceRecordEditStateDto> {
        if (dto.schedule !== undefined && dto.dateMove !== undefined) {
            throw this.scheduleRejection(
                "SCHEDULE_WITH_DATE_MOVE",
                "/schedule",
                "일정 전체 변경과 단일 날짜 이동은 함께 요청할 수 없어요.",
            );
        }
        if (dto.resumeReplan !== undefined && (dto.schedule !== undefined || dto.dateMove !== undefined)) {
            throw this.scheduleRejection(
                "RESUME_REPLAN_COMBINATION",
                "/resumeReplan",
                "재개 일정 재배치는 일정 전체 변경이나 단일 날짜 이동과 함께 요청할 수 없어요.",
            );
        }
        const target = await this.resolveDraftTarget(branchId, draftId);
        const validatedChanges = this.validateChanges(dto.changes, target.loaded.source);
        const schedule = dto.schedule === undefined ? undefined : this.validateSchedule(dto.schedule);
        const resumeReplan = dto.resumeReplan === undefined ? undefined : this.validateResumeReplan(dto.resumeReplan);
        if (schedule && this.changesCarryServiceDate(validatedChanges)) {
            throw this.scheduleRejection(
                "SCHEDULE_WITH_DATE_MOVE",
                "/changes/sessions",
                "일정 전체 변경과 회차별 날짜 변경은 함께 요청할 수 없어요.",
            );
        }
        if (!validatedChanges) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "REQUIRED",
                detail: "저장할 변경 내용을 입력해 주세요.",
                location: "body",
            }));
        }
        // The normalized dates are persisted into the draft, so they are SAVED computations.
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        const changes = this.normalizeChanges(
            target.loaded.source,
            target.draft.changes,
            validatedChanges,
            calendar,
            dto.dateMove as ServiceRecordEditDateMove | undefined,
            schedule,
            resumeReplan,
        );

        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.updateDraft({
                branchId,
                serviceRecordCaseId: target.loaded.source.caseId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                actorUserId,
                changes,
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            await this.throwConflictWithLatest(branchId, target.loaded.source.caseId, draftId, error);
            throw error;
        }
        const latest = await this.loadSource(branchId, { caseId: target.loaded.source.caseId });
        return this.state(draft, latest);
    }

    async previewDraft(
        branchId: string,
        draftId: string,
        _actorUserId: string,
        dto: PreviewServiceRecordEditDraftDto,
    ) {
        const target = await this.resolveDraftTarget(branchId, draftId);
        if (target.draft.status !== "ACTIVE") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
        }
        if (target.draft.draftVersion !== dto.expectedDraftVersion) {
            await this.throwConflictWithLatest(
                branchId,
                target.loaded.source.caseId,
                draftId,
                new ServiceRecordEditConflictError("The service-record draft version is stale"),
            );
        }
        if (target.draft.sourceFingerprint !== target.loaded.fingerprint) {
            // 원본이 임시 저장 이후 바뀐 충돌은 등록된 대상 변경 코드로 응답하고
            // 화면 복구에 쓰이는 최신 상태는 호환 별칭으로 유지해요.
            throw new ConflictException({
                ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
                sourceChanged: true,
                sourceCaseVersion: target.loaded.source.caseVersion,
                sourceFingerprint: target.loaded.fingerprint,
                draft: mapDraft(target.draft),
            });
        }

        // The preview id hashes the calendar version, so confirm must see the same calendar state.
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        const provisional = buildServiceRecordEditPreview({
            calendar,
            draftId,
            draftVersion: target.draft.draftVersion,
            sourceCaseVersion: target.loaded.source.caseVersion,
            sourceFingerprint: target.loaded.fingerprint,
            source: target.loaded.source,
            changes: effectivePreviewChanges(target.loaded.source, target.draft.changes),
            previewId: "pending",
        });
        const { previewId: _provisionalPreviewId, ...previewValues } = provisional;
        void _provisionalPreviewId;
        const previewFingerprint = jsonValue(previewValues);
        const previewId = `srp_${createHash("sha256").update(stableStringify(previewFingerprint)).digest("hex")}`;
        return { ...provisional, previewId };
    }

    /**
     * Confirm a server-produced preview. The repository owns the transaction,
     * lock order, fresh reread, idempotency replay, and all durable writes;
     * this callback only derives a typed plan from that locked snapshot.
     */
    async confirmDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: ConfirmServiceRecordEditDraftDto,
    ): Promise<ServiceRecordEditConfirmResponse> {
        if (!UUID_PATTERN.test(draftId) || !UUID_PATTERN.test(dto.idempotencyKey)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (!Number.isInteger(dto.expectedDraftVersion) || dto.expectedDraftVersion < 1) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/expectedDraftVersion",
                code: "INVALID_FORMAT",
                detail: "임시 저장 버전은 1 이상의 정수여야 해요.",
                location: "body",
            }));
        }
        if (typeof dto.previewId !== "string" || !/^srp_[0-9a-f]{64}$/i.test(dto.previewId)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/previewId",
                code: "INVALID_FORMAT",
                detail: "미리보기 식별자가 올바르지 않아요.",
                location: "body",
            }));
        }

        const requestFingerprint = createHash("sha256")
            .update(stableStringify(jsonValue({
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                previewId: dto.previewId,
                idempotencyKey: dto.idempotencyKey,
            })))
            .digest("hex");

        // Loaded before the repository transaction: its `prepare` callback is synchronous.
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });

        let confirmed: ServiceRecordEditConfirmResponse;
        try {
            confirmed = await this.repository.confirmDraft({
                branchId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                previewId: dto.previewId,
                idempotencyKey: dto.idempotencyKey,
                requestFingerprint,
                actorUserId,
                serviceRecordTemplateIds: [...configuredServiceRecordTemplateIds(this.configService)],
                prepare: ({ draft, source, revisionFactsSource }) => this.buildConfirmPlan({
                    draft,
                    source,
                    revisionFactsSource,
                    branchId,
                    draftId,
                    actorUserId,
                    previewId: dto.previewId,
                    calendar,
                }),
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            if (error instanceof ServiceRecordRevisionOperationUnresolvedError) {
                throw new ConflictException({
                    ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
                    blockingOperation: {
                        operation: error.operation,
                        status: error.status,
                        lastErrorCode: error.lastErrorCode,
                    },
                });
            }
            if (error instanceof ServiceRecordEditConflictError) {
                // 저장소 충돌 전체(버전 경합·문서 상태 경합)는 "작업 대상 변경"의
                // 동일 원인이라 등록된 코드를 재사용해요(EM-CAT-02).
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            throw error;
        }
        this.emitCaseChanged(branchId, confirmed);
        return confirmed;
    }

    /**
     * Read-only dry run of the confirm: the plan `confirmDraft` would build for this draft and
     * preview right now, from the same `buildConfirmPlan` with the same inputs (draft, source,
     * private revision facts, fresh branch calendar). It writes nothing and takes no lock, so a
     * concurrent writer can still change the answer before a real confirm; the confirm remains
     * the authority. Errors are mapped exactly as the confirm maps them.
     */
    async planConfirmDryRun(
        branchId: string,
        draftId: string,
        actorUserId: string,
        previewId: string,
    ): Promise<ServiceRecordEditConfirmPlan> {
        if (!UUID_PATTERN.test(draftId)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (typeof previewId !== "string" || !/^srp_[0-9a-f]{64}$/i.test(previewId)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/previewId",
                code: "INVALID_FORMAT",
                detail: "미리보기 식별자가 올바르지 않아요.",
                location: "body",
            }));
        }
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        try {
            const snapshot = await this.repository.loadConfirmSnapshot(
                branchId,
                draftId,
                [...configuredServiceRecordTemplateIds(this.configService)],
            );
            if (!snapshot) throw new ServiceRecordEditNotFoundError();
            return this.buildConfirmPlan({
                draft: snapshot.draft,
                source: snapshot.source,
                ...(snapshot.revisionFactsSource ? { revisionFactsSource: snapshot.revisionFactsSource } : {}),
                branchId,
                draftId,
                actorUserId,
                previewId,
                calendar,
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            if (error instanceof ServiceRecordEditConflictError) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            throw error;
        }
    }

    /** Tell open editors the case changed; a bus failure must never fail the confirm. */
    private emitCaseChanged(branchId: string, confirmed: ServiceRecordEditConfirmResponse): void {
        if (!this.caseEventBus) return;
        try {
            this.caseEventBus.emit({
                branchId,
                clientId: confirmed.clientId,
                caseId: confirmed.caseId,
                caseVersion: confirmed.caseVersion,
            });
        } catch (error) {
            this.logger.warn(
                `case-changed emit failed case=${confirmed.caseId}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private buildConfirmPlan(args: {
        draft: ServiceRecordEditDraft;
        source: SourceSnapshot;
        revisionFactsSource?: ServiceRecordEditRevisionFactsSource;
        branchId: string;
        draftId: string;
        actorUserId: string;
        previewId: string;
        calendar: KrBusinessDayCalendar;
    }): ServiceRecordEditConfirmPlan {
        const { draft, source, revisionFactsSource, branchId, draftId, actorUserId, previewId, calendar } = args;
        if (draft.status !== "ACTIVE") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
        }

        const fingerprint = sourceFingerprint(source);
        const buildProvisional = () => buildServiceRecordEditPreview({
            calendar,
            draftId,
            draftVersion: draft.draftVersion,
            sourceCaseVersion: source.caseVersion,
            sourceFingerprint: fingerprint,
            source,
            changes: effectivePreviewChanges(source, draft.changes),
            previewId: "pending",
        });
        // A schedule replacement must not move a session locked or submitted since the preview.
        // Locking changes the source fingerprint, so this hard stop is judged against the rows
        // read inside the confirm transaction BEFORE the stale-source rejection below, which
        // would otherwise hide it behind the generic write-target response. A dateMove draft
        // is not held to it.
        const isScheduleDraft = draftServiceDays(draft.changes) !== null;
        const isResumeDraft = draftResumeReplan(draft.changes) !== null;
        let provisional = isScheduleDraft || isResumeDraft ? buildProvisional() : null;
        if (provisional) {
            // A resume replan is likewise refused outright once the case is finalized, whatever the preview said.
            const hardStops = provisional.blockingReasons.filter((entry) =>
                entry.code === "LOCKED_SESSION_DATE_CHANGED" || entry.code === "CASE_FINALIZED");
            if (hardStops.length > 0) {
                throw new ConflictException({
                    ...codeOnlyProblemBody("REQUEST_CONFLICT"),
                    blockingReasons: hardStops,
                });
            }
        }
        if (draft.sourceFingerprint !== fingerprint) {
            throw new ConflictException({
                ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
                sourceChanged: true,
                sourceCaseVersion: source.caseVersion,
                sourceFingerprint: fingerprint,
            });
        }

        provisional ??= buildProvisional();
        const { previewId: _ignoredPreviewId, ...previewValues } = provisional;
        void _ignoredPreviewId;
        const computedPreviewId = `srp_${createHash("sha256")
            .update(stableStringify(jsonValue(previewValues)))
            .digest("hex")}`;
        if (computedPreviewId !== previewId) {
            // 제출된 미리보기가 현재 원본/변경 내용과 어긋난 요청이라 등록된
            // 요청-만료 코드로 응답해요(EM-CAT-03: 기존 REQUEST_STALE 재사용).
            throw new ConflictException({
                ...codeOnlyProblemBody("REQUEST_STALE"),
                previewId: computedPreviewId,
                sourceCaseVersion: source.caseVersion,
                sourceFingerprint: fingerprint,
            });
        }
        if (provisional.blockingReasons.length > 0) {
            throw new ConflictException({
                ...codeOnlyProblemBody("REQUEST_CONFLICT"),
                blockingReasons: provisional.blockingReasons,
            });
        }

        const sourceChanges = asJsonRecord(draft.changes);
        const headerChanges = asJsonRecord(sourceChanges?.["header"]);
        const header = {
            momName: source.header.momName,
            momBirth: source.header.momBirth,
            babyName: source.header.babyName,
            babyBirth: source.header.babyBirth,
            deliveryType: source.header.deliveryType,
            babyWeight: source.header.babyWeight,
        };
        if (headerChanges) {
            for (const key of Object.keys(header)) {
                const value = headerChanges[key];
                if (typeof value === "string") header[key as keyof typeof header] = value;
            }
        }

        // The boundary writes come from the same plan the preview's assignmentPeriods showed.
        const resumePlan = isResumeDraft ? resolveResumeReplan(source, draft.changes, calendar)?.plan ?? null : null;
        if (isResumeDraft && !resumePlan) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const bySession = sessionChangeMap(sourceChanges?.["sessions"]);
        const afterByIndex = new Map(provisional.after.sessions.map((entry) => [entry.sessionIndex, entry]));
        const sessions: ServiceRecordEditConfirmSessionUpdate[] = source.sessions.map((day) => {
            const patch = bySession.get(day.sessionIndex);
            const projected = afterByIndex.get(day.sessionIndex);
            return {
                sourceRowId: day.sourceRowId,
                serviceDate: projected?.serviceDate ?? day.serviceDate,
                answers: mergeSparseAnswers(day.answers, patch?.answers),
                etcService: typeof patch?.etcService === "string" ? patch.etcService : day.etcService,
                notes: typeof patch?.notes === "string" ? patch.notes : day.notes,
                paymentConfirmed: typeof patch?.paymentConfirmed === "boolean"
                    ? patch.paymentConfirmed
                    : day.paymentConfirmed,
            };
        });

        const beforeByIndex = new Map(provisional.before.sessions.map((entry) => [entry.sessionIndex, entry]));
        const newSessions: ServiceRecordEditConfirmNewSession[] = [];
        for (const patch of bySession.values()) {
            if (source.sessions.some((day) => day.sessionIndex === patch.sessionIndex)) continue;
            if (!hasEffectiveFutureContent(patch)) continue;
            const projected = afterByIndex.get(patch.sessionIndex);
            if (!projected) {
                throw new ConflictException({
                    ...codeOnlyProblemBody("REQUEST_CONFLICT"),
                    sessionIndex: patch.sessionIndex,
                });
            }
            newSessions.push(buildFutureContentSession(
                source,
                projected,
                beforeByIndex.get(patch.sessionIndex)?.originalDate,
                patch,
            ));
        }
        newSessions.sort((left, right) => left.sessionIndex - right.sessionIndex);

        const plannedSessions = jsonValue(provisional.after.sessions);
        const effectiveRows = source.sessions.map((day) => {
            const update = sessions.find((session) => session.sourceRowId === day.sourceRowId);
            const original = beforeByIndex.get(day.sessionIndex)?.originalDate ?? day.serviceDate;
            return {
                sourceRowId: day.sourceRowId,
                sessionIndex: day.sessionIndex,
                serviceDate: update?.serviceDate ?? day.serviceDate,
                originalDate: original,
                answers: update?.answers ?? day.answers,
                etcService: update ? update.etcService : day.etcService,
                notes: update ? update.notes : day.notes,
                paymentConfirmed: update?.paymentConfirmed ?? day.paymentConfirmed,
                locked: day.locked,
                momApproval: day.momApproval,
                employeeId: day.employeeId,
                employeeNameSnapshot: day.employeeNameSnapshot,
                scheduleId: day.scheduleId,
                formVersion: day.formVersion,
                clientSignature: day.clientSignature,
                submittedAt: day.submittedAt,
                clientSignedAt: day.clientSignedAt,
            };
        });
        const futureRows = newSessions.map((session) => ({
            sourceRowId: session.sourceRowId,
            sessionIndex: session.sessionIndex,
            serviceDate: session.serviceDate,
            originalDate: session.originalDate,
            assignmentId: session.assignmentId,
            provenanceVersion: session.provenanceVersion,
            answers: session.answers,
            etcService: session.etcService,
            notes: session.notes,
            paymentConfirmed: session.paymentConfirmed,
            locked: session.locked,
            momApproval: session.momApproval,
            employeeId: session.employeeId,
            employeeNameSnapshot: session.employeeNameSnapshot,
            scheduleId: session.scheduleId,
            formVersion: session.formVersion,
            clientSignature: session.clientSignature,
            submittedAt: session.submittedAt,
            clientSignedAt: session.clientSignedAt,
        }));
        const revisionSessions = [...effectiveRows, ...futureRows]
            .sort((left, right) => left.sessionIndex - right.sessionIndex);
        const completeness = revisionCompleteness(source, header, revisionSessions);
        const revisionPayload = jsonValue({
            caseId: source.caseId,
            // A missing branch name is retained as explicit unknown evidence;
            // no provider identity is invented for renderer eligibility.
            branchName: source.branchName ?? null,
            clientId: source.client.id,
            requiredSessionCount: provisional.requiredSessionCount,
            startDate: provisional.after.startDate,
            endDate: provisional.after.endDate,
            formVersion: source.formVersion,
            caseLifecycle: source.caseLifecycle,
            header,
            plannedSessions,
            sessions: revisionSessions,
            newSessions: futureRows,
            signatureMetadata: provisional.signatureMetadata,
            documentScope: provisional.documentScope,
            completeness,
        });
        const revisionFingerprint = createHash("sha256")
            .update(stableStringify(revisionPayload))
            .digest("hex");
        const contentChanged = [...bySession.values()].some((patch) => {
            const sourceDay = source.sessions.find((day) => day.sessionIndex === patch.sessionIndex);
            return sourceDay
                ? hasExistingContentDifference(sourceDay, patch)
                : hasEffectiveFutureContent(patch);
        });
        // A resume replan can have work left even when the session dates already match: an assignment
        // boundary that still has to move, a handover of planned owners, a due time that is not yet
        // the one for the new end date. Each of them is a write the preview showed.
        const endDateChanged = provisional.after.endDate !== source.endDate;
        const finalizationDueAt = !IMMUTABLE_FINALIZATION_STATUSES.has(source.caseLifecycle.status)
            && provisional.after.endDate && (resumePlan !== null || endDateChanged)
            ? getServiceRecordFinalizationDueAt(new Date(`${provisional.after.endDate}T00:00:00.000Z`)).toISOString()
            : null;
        const resumeWritesPending = resumePlan !== null && (
            resumePlan.assignmentWrites.some((write) => write.datesChanged === true)
            || hasPlannedOwnerDifference(provisional.before.sessions, provisional.after.sessions)
            || !sameInstant(source.caseLifecycle.finalizationDueAt, finalizationDueAt)
        );
        const changed = provisional.contentChanges.headerChanged
            || contentChanged
            || hasPlannedDateDifference(provisional.before.sessions, provisional.after.sessions)
            || resumeWritesPending;
        const periodChanged = provisional.after.startDate !== source.startDate
            || provisional.after.endDate !== source.endDate;
        const documentStatus = completeness === "partial"
            ? "waiting_for_completion"
            : documentStatusForSource(source);
        const dispatchContext: ServiceRecordRevisionDispatchContext | null = changed
            ? {
                branchId,
                clientId: source.client.id,
                serviceRecordCaseId: source.caseId,
                revisionId: null,
                revisionNumber: null,
                businessFingerprint: revisionFingerprint,
                plannedSessionCount: provisional.requiredSessionCount,
                plannedSessionDates: provisional.after.sessions.map((entry) => ({
                    sessionIndex: entry.sessionIndex,
                    serviceDate: entry.serviceDate,
                })),
                documentSyncStatus: documentStatus,
                lifecycleStatus: source.caseLifecycle.status,
                formVersion: source.formVersion,
            }
            : null;
        const documentJob = changed && dispatchContext
            ? {
                requestKey: `service-record-revision:${source.caseId}:${draft.id}`,
                activeKey: `service-record-revision:${source.caseId}`,
                payload: {
                    kind: "service_record_revision",
                    revisionId: null,
                    revisionNumber: null,
                    context: dispatchContext,
                    immutablePayload: revisionPayload,
                    payloadFingerprint: revisionFingerprint,
                    completeness,
                    manualReviewRequired: completeness === "partial"
                        || documentStatus === "capability_unverified",
                    periodChanged,
                },
                payloadFingerprint: revisionFingerprint,
            }
            : null;

        /**
         * Contract and receipt synchronization are independent of record
         * completeness.  The current local document scope intentionally
         * exposes only identity/stage, so a linked contract is preserved as a
         * durable manual-review marker until an authoritative provider fact
         * capture is available.  A missing contract/token is an explicit
         * not-required outcome and does not block a later confirmation.
         */
        const documentScope = provisional.documentScope;
        const contractDocumentId = documentScope.contract.currentDocumentId;
        const contractScopeKnown = documentScope.evidence === "observed";
        // Contract/receipt facts are captured by the repository only after the
        // common document locks.  A missing carrier or a malformed provider
        // detail remains manual review; it must never be replaced with
        // duration, pricing, client, or live-provider defaults.
        const targetFieldMap = periodChanged && revisionFactsSource
            ? buildServiceRecordRevisionTargetFieldMap(
                revisionFactsSource.document,
                provisional.after.startDate,
                provisional.after.endDate,
            )
            : { fields: null, missingFacts: [] };
        const targetPeriod = {
            startDate: provisional.after.startDate,
            endDate: provisional.after.endDate,
            receiptPeriod: provisional.after.startDate && provisional.after.endDate
                ? `${provisional.after.startDate}~${provisional.after.endDate}`
                : "",
            fields: targetFieldMap.fields ?? {},
        };
        const factsResult: ServiceRecordRevisionFactsResult = periodChanged && revisionFactsSource
            ? captureServiceRecordRevisionFacts({
                document: revisionFactsSource.document,
                receiptTokens: revisionFactsSource.receiptTokens,
                targetPeriod,
            })
            : { facts: null, receiptInput: null, missingFacts: [] };
        // The receipt refresh reads its facts from the receipt document: the client's CURRENT
        // contract as `selectCurrentContractDocument` resolves it (the same rule the client
        // summary uses). That can differ from the `client.eDocId`-pinned contract document above
        // while that pointer lags a re-issued contract, and from the document the receipt tokens
        // are attached to: receipt links are stable, so the token stays on its original document
        // and promotion refreshes it from the target document. Promotion requires only that this
        // target (receipt-facts) document is still the client's current contract, checked under
        // the client-first lock order (client row first, then the client's document rows in id order).
        // Contract-revision planning keeps using `document` untouched: it WRITES to eformsign, so
        // its target is deliberately not retargeted here. When the receipt document is the same
        // document (the common case) the single capture above already answers both.
        const receiptDocument = revisionFactsSource?.receiptDocument;
        const receiptFactsResult: ServiceRecordRevisionFactsResult = periodChanged
            && revisionFactsSource
            && receiptDocument !== undefined
            && receiptDocument !== revisionFactsSource.document
            ? captureServiceRecordRevisionFacts({
                document: receiptDocument,
                receiptTokens: revisionFactsSource.receiptTokens,
                targetPeriod: {
                    ...targetPeriod,
                    fields: buildServiceRecordRevisionTargetFieldMap(
                        receiptDocument,
                        provisional.after.startDate,
                        provisional.after.endDate,
                    ).fields ?? {},
                },
            })
            : factsResult;
        const builtContractSnapshot = factsResult.facts
            ? buildServiceRecordContractRevisionSnapshot(factsResult.facts)
            : { snapshot: null, reason: null };
        const contractFactsAvailable = builtContractSnapshot.snapshot !== null;
        // An observed null pointer proves that this client has no linked
        // contract.  An unverified scope is an unknown source and must remain
        // a manual-review marker whenever the period changes.
        const contractRequiresSync = periodChanged
            && (!contractScopeKnown || contractDocumentId !== null);
        const contractOperationStatus: ServiceRecordEditConfirmOperationPlan["status"] = contractRequiresSync
            ? contractFactsAvailable ? "pending" : "manual_review"
            : "not_required";
        const contractSnapshot = builtContractSnapshot.snapshot;
        const contractOperation: ServiceRecordEditConfirmOperationPlan | null = changed
            ? {
                operation: "contract_period",
                immutableInput: jsonValue(contractSnapshot && contractFactsAvailable
                    ? {
                        ...contractSnapshot,
                        kind: "contract_period",
                        businessFingerprint: revisionFingerprint,
                        periodChanged,
                        revision: revisionPayload,
                    }
                    : {
                        kind: "contract_period",
                        businessFingerprint: revisionFingerprint,
                        sourceDocumentId: contractDocumentId,
                        sourceStage: documentScope.contract.stage,
                        sourceEvidence: documentScope.evidence,
                        targetPeriod: {
                            startDate: provisional.after.startDate,
                            endDate: provisional.after.endDate,
                        },
                        periodChanged,
                        revision: revisionPayload,
                    }),
                status: contractOperationStatus,
                step: contractOperationStatus,
                lastErrorCode: contractRequiresSync && !contractFactsAvailable
                    ? SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE
                    : null,
                documentVersion: contractSnapshot?.original.documentVersion ?? null,
                sourceDocumentId: contractSnapshot?.original.documentId ?? contractDocumentId,
                targetDocumentId: null,
                templateId: contractSnapshot?.original.templateId ?? null,
                templateVersion: contractSnapshot?.original.templateVersion ?? null,
                workflowScope: contractSnapshot
                    ? jsonValue(contractSnapshot.original.workflowScope)
                    : jsonValue({
                        stage: documentScope.contract.stage,
                        evidence: documentScope.evidence,
                    }),
                mirrorGeneration: contractSnapshot?.original.mirrorGeneration ?? null,
            }
            : null;

        const receiptScope = documentScope.receipt;
        const receiptTokenIds = receiptScope?.tokenIds ?? [];
        const receiptScopeKnown = receiptScope?.evidence === "observed";
        // Empty tokens are `not_required` only after the branch/client-scoped
        // lookup explicitly returned an observed empty set.  Missing or
        // unverified receipt scope remains unknown when the period changes.
        const receiptRequiresSync = periodChanged
            && (!receiptScopeKnown || receiptTokenIds.length > 0);
        const receiptInput = receiptFactsResult.receiptInput;
        const receiptOperationStatus: ServiceRecordEditConfirmOperationPlan["status"] = receiptRequiresSync
            ? receiptInput ? "pending" : "manual_review"
            : "not_required";
        const receiptOperation: ServiceRecordEditConfirmOperationPlan | null = changed
            ? {
                operation: "receipt_refresh",
                immutableInput: jsonValue(receiptInput
                    ? {
                        kind: "receipt_refresh",
                        businessFingerprint: revisionFingerprint,
                        ...receiptInput,
                        periodChanged,
                        revision: revisionPayload,
                    }
                    : {
                        kind: "receipt_refresh",
                        businessFingerprint: revisionFingerprint,
                        expected: {
                            serviceStartDate: provisional.after.startDate,
                            serviceEndDate: provisional.after.endDate,
                            receivedDate: null,
                            amount: null,
                        },
                        tokens: {
                            eformsignDocId: receiptScope?.eformsignDocId ?? null,
                            tokenIds: receiptTokenIds,
                        },
                        source: {
                            documentId: receiptScope?.sourceDocumentId ?? null,
                            documentVersion: null,
                            templateId: null,
                            templateVersion: null,
                            mirrorGeneration: null,
                        },
                        periodChanged,
                        revision: revisionPayload,
                    }),
                status: receiptOperationStatus,
                step: receiptOperationStatus,
                lastErrorCode: receiptRequiresSync && !receiptInput
                    ? SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE
                    : null,
                documentVersion: receiptInput?.source.documentVersion ?? null,
                sourceDocumentId: receiptInput?.source.documentId ?? receiptScope?.sourceDocumentId ?? null,
                targetDocumentId: null,
                templateId: receiptInput?.source.templateId ?? null,
                templateVersion: receiptInput?.source.templateVersion ?? null,
                workflowScope: jsonValue({
                    evidence: receiptScope?.evidence ?? "unverified",
                    eformsignDocId: receiptScope?.eformsignDocId ?? null,
                }),
                mirrorGeneration: receiptInput?.source.mirrorGeneration ?? null,
            }
            : null;

        // The draft's toggles replace the client's only when they differ; a toggle-only save is
        // not a "change" (no revision, no document) but the repository still stores the flags.
        const pendingServiceDays = draftServiceDays(draft.changes);
        const clientServiceDays = pendingServiceDays && !sameServiceDays(pendingServiceDays, storedServiceDays(source))
            ? pendingServiceDays
            : undefined;
        // A legacy case (no stored vector) derives its dates on read, so flipping the toggles under
        // dates that merely equal the old projection would re-project them. Store the selected
        // vector next to the flags; a case that already stores a vector keeps flags-only.
        const materializedPlannedSessions = clientServiceDays && !changed && source.plannedSessions == null
            ? {
                plannedSessions,
                endDate: provisional.after.sessions
                    .map((entry) => entry.serviceDate)
                    .reduce<string | null>((latest, date) => (latest === null || date > latest ? date : latest), null),
            }
            : undefined;

        return {
            status: changed ? "confirmed" : "no_changes",
            sourceFingerprint: fingerprint,
            caseId: source.caseId,
            clientId: source.client.id,
            formVersion: source.formVersion,
            requiredSessionCount: provisional.requiredSessionCount,
            startDate: provisional.after.startDate,
            endDate: provisional.after.endDate,
            header,
            plannedSessions,
            sessions,
            newSessions,
            // A resume replan writes the boundary the preview showed (same function); every
            // other change keeps the outer-edge rule.
            assignments: resumePlan
                ? resumePlan.assignmentWrites
                : confirmAssignmentWrites(source, provisional.after.sessions),
            revision: changed
                ? {
                    branchId,
                    serviceRecordCaseId: source.caseId,
                    actorUserId,
                    payload: revisionPayload,
                    beforeSnapshot: jsonValue({
                        snapshotVersion: 1,
                        startDate: source.startDate,
                        endDate: source.endDate,
                        header: source.header,
                        plannedSessions: provisional.before.sessions,
                        sessions: source.sessions.map((session) => ({
                            sessionIndex: session.sessionIndex,
                            serviceDate: session.serviceDate,
                            answers: session.answers,
                            etcService: session.etcService,
                            notes: session.notes,
                            paymentConfirmed: session.paymentConfirmed,
                            employeeId: session.employeeId,
                            employeeNameSnapshot: session.employeeNameSnapshot,
                            clientSignatureFingerprint: serviceRecordSignatureFingerprint(session.clientSignature),
                        })),
                    }),
                    plannedSessions,
                    provenance: jsonValue(provisional.provenance),
                    formVersionAtConfirm: source.formVersion,
                    snapshotReference: null,
                }
                : null,
            dispatchContext,
            documentStatus,
            documentJob,
            contractOperation,
            receiptOperation,
            ...(clientServiceDays ? { clientServiceDays } : {}),
            ...(materializedPlannedSessions ? { materializedPlannedSessions } : {}),
            ...(finalizationDueAt && (changed || resumePlan || materializedPlannedSessions) ? { finalizationDueAt } : {}),
            ...(resumePlan ? { tokenExpiryMode: "raise_only" as const } : {}),
        };
    }

    async discardDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: DiscardServiceRecordEditDraftDto,
    ): Promise<AdminServiceRecordEditStateDto> {
        const target = await this.resolveDraftTarget(branchId, draftId);
        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.discardDraft({
                branchId,
                serviceRecordCaseId: target.loaded.source.caseId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                actorUserId,
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            await this.throwConflictWithLatest(branchId, target.loaded.source.caseId, draftId, error);
            throw error;
        }
        const latest = await this.loadSource(branchId, { caseId: target.loaded.source.caseId });
        return this.state(draft, latest);
    }

    private async throwConflictWithLatest(
        branchId: string,
        caseId: string,
        draftId: string,
        error: unknown,
    ): Promise<never> {
        if (!(error instanceof ServiceRecordEditConflictError)) throw error;
        const latest = await this.repository.findDraft(branchId, caseId, draftId);
        const current = await this.loadSource(branchId, { caseId });
        // 최신 임시 저장 상태는 409 복구 흐름에서 쓰이므로 호환 별칭으로 유지해요.
        // 문제 본문 자체는 등록된 대상 변경 코드로 응답해요.
        throw new ConflictException({
            ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
            latestDraft: latest ? mapDraft(latest) : null,
            sourceChanged: latest ? latest.sourceFingerprint !== current.fingerprint : false,
            sourceCaseVersion: current.source.caseVersion,
            sourceFingerprint: current.fingerprint,
        });
    }

    private throwRepositoryNotFound(error: unknown): never {
        if (error instanceof ServiceRecordEditNotFoundError) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        throw error;
    }

    private state(draft: ServiceRecordEditDraft | null, loaded: LoadedSource): AdminServiceRecordEditStateDto {
        return {
            draft: draft ? mapDraft(draft) : null,
            sourceChanged: draft ? draft.sourceFingerprint !== loaded.fingerprint : false,
            sourceCaseVersion: loaded.source.caseVersion,
            sourceFingerprint: loaded.fingerprint,
        };
    }

    private validateChanges(
        raw: AdminServiceRecordEditChangesDto | undefined,
        source: SourceSnapshot,
    ): ServiceRecordEditJsonObject | undefined {
        if (raw === undefined) return undefined;
        if (!isPlainRecord(raw)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "INVALID_FORMAT",
                detail: "임시 저장 변경 내용은 객체여야 해요.",
                location: "body",
            }));
        }

        const serialized = JSON.stringify(raw);
        if (typeof serialized !== "string") {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "INVALID_VALUE",
                detail: "임시 저장 변경 내용을 저장할 수 없어요.",
                location: "body",
            }));
        }
        if (Buffer.byteLength(serialized, "utf8") > MAX_CHANGES_BYTES) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "OUT_OF_RANGE",
                detail: "제공기록 초안이 너무 커요.",
                location: "body",
            }));
        }

        const unknownRoot = Object.keys(raw).filter((key) => key !== "header" && key !== "sessions");
        if (unknownRoot.length > 0) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: `/changes/${unknownRoot[0]}`,
                code: "UNEXPECTED_FIELD",
                detail: `허용되지 않는 임시 저장 항목이에요: ${unknownRoot[0]}`,
                location: "body",
            }));
        }

        const rawRecord = raw as unknown as Record<string, unknown>;
        const output: ServiceRecordEditJsonObject = {};
        if (rawRecord["header"] !== undefined) output["header"] = this.validateHeader(rawRecord["header"]);
        if (rawRecord["sessions"] !== undefined) output["sessions"] = this.validateSessions(rawRecord["sessions"], source);
        return output;
    }

    private scheduleRejection(
        scheduleCode: string,
        pointer: string,
        detail: string,
        message: string = detail,
    ): BadRequestException {
        return new BadRequestException({
            ...problemBody("VALIDATION_FAILED", { pointer, code: "INVALID_VALUE", detail, location: "body" }),
            message,
            scheduleCode,
        });
    }

    private normalizeChanges(
        ...args: Parameters<typeof normalizeServiceRecordEditChanges>
    ): ServiceRecordEditJsonObject {
        try {
            return normalizeServiceRecordEditChanges(...args).changes;
        } catch (error) {
            if (error instanceof ServiceRecordScheduleValidationError) {
                // 일정 벡터 사유 코드는 카탈로그에 없는 실행시점 표기라서(EM-CAT-01)
                // 등록된 검증 코드로 응답하고, 구체 사유는 호환 확장 키 scheduleCode로
                // 전달해 화면이 사유를 구분할 수 있게 해요. 원인 텍스트는 호환 message로만 남겨요.
                throw new BadRequestException({
                    ...problemBody("VALIDATION_FAILED", {
                        pointer: "/changes",
                        code: "INVALID_VALUE",
                        detail: "제공기록 일정 변경을 적용할 수 없어요.",
                        location: "body",
                    }),
                    message: error.message,
                    sessionIndex: error.sessionIndex,
                    scheduleCode: error.code,
                    // The chat agent asks the operator and retries with an explicit incomingAssignmentId.
                    ...(error instanceof ServiceRecordResumeAssignmentError ? { candidates: error.candidates } : {}),
                });
            }
            if (error instanceof UnsupportedKoreanHolidayYearError) {
                // 공휴일 데이터가 없는 연도의 날짜는 서버 오류가 아니라 입력 거절이에요.
                throw this.scheduleRejection(
                    "UNSUPPORTED_HOLIDAY_YEAR",
                    "/changes",
                    "공휴일 정보가 없는 연도의 날짜는 선택할 수 없어요.",
                    error.message,
                );
            }
            throw error;
        }
    }

    private async normalizeStartChanges(
        branchId: string,
        source: ServiceRecordEditSource,
        changes: ServiceRecordEditJsonObject | undefined,
    ): Promise<ServiceRecordEditJsonObject | undefined> {
        if (!this.changesCarryServiceDate(changes)) return changes;
        const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
        return this.normalizeChanges(source, undefined, changes!, calendar);
    }

    private changesCarryServiceDate(changes: ServiceRecordEditJsonObject | undefined): boolean {
        const sessions = changes?.["sessions"];
        return Array.isArray(sessions) && sessions.some((session) => (
            isPlainRecord(session) && session["serviceDate"] !== undefined
        ));
    }

    /**
     * Shape of a whole-set schedule replacement. Real calendar days, order,
     * uniqueness and count are judged against the case by the schedule policy.
     */
    private validateSchedule(raw: unknown): ServiceRecordEditScheduleReplacement {
        const invalid = (pointer: string, code: "REQUIRED" | "INVALID_FORMAT" | "OUT_OF_RANGE", detail: string) =>
            new BadRequestException(problemBody("VALIDATION_FAILED", { pointer, code, detail, location: "body" }));
        if (!isPlainRecord(raw)) {
            throw invalid("/schedule", "INVALID_FORMAT", "일정 변경은 객체여야 해요.");
        }
        const serviceDays = raw["serviceDays"];
        if (!isPlainRecord(serviceDays)) {
            throw invalid("/schedule/serviceDays", "REQUIRED", "토요일·일요일·공휴일 제공 여부를 입력해 주세요.");
        }
        for (const key of ["saturday", "sunday", "holiday"] as const) {
            if (typeof serviceDays[key] !== "boolean") {
                throw invalid(`/schedule/serviceDays/${key}`, "INVALID_FORMAT", "제공 여부는 참·거짓 값이어야 해요.");
            }
        }
        const dates = raw["dates"];
        if (!Array.isArray(dates) || dates.length < 1) {
            throw invalid("/schedule/dates", "REQUIRED", "서비스 제공일자를 입력해 주세요.");
        }
        if (dates.length > 366) {
            throw invalid("/schedule/dates", "OUT_OF_RANGE", "서비스 제공일자가 너무 많아요.");
        }
        for (const [index, date] of dates.entries()) {
            if (typeof date !== "string" || !DATE_ONLY_PATTERN.test(date)) {
                throw invalid(`/schedule/dates/${index}`, "INVALID_FORMAT", "서비스 제공일자는 YYYY-MM-DD 형식이어야 해요.");
            }
        }
        return {
            serviceDays: {
                saturday: serviceDays["saturday"] as boolean,
                sunday: serviceDays["sunday"] as boolean,
                holiday: serviceDays["holiday"] as boolean,
            },
            dates: dates as string[],
        };
    }

    /** Shape of a resume replan; the dates are judged against the case by the schedule policy. */
    private validateResumeReplan(raw: unknown): ServiceRecordEditResumeReplan {
        const invalid = (pointer: string, code: "REQUIRED" | "INVALID_FORMAT", detail: string) =>
            new BadRequestException(problemBody("VALIDATION_FAILED", { pointer, code, detail, location: "body" }));
        if (!isPlainRecord(raw)) {
            throw invalid("/resumeReplan", "INVALID_FORMAT", "재개 일정 재배치는 객체여야 해요.");
        }
        const fromSessionIndex = raw["fromSessionIndex"];
        if (typeof fromSessionIndex !== "number" || !Number.isInteger(fromSessionIndex) || fromSessionIndex < 1) {
            throw invalid("/resumeReplan/fromSessionIndex", "INVALID_FORMAT", "시작 회차는 1 이상의 정수여야 해요.");
        }
        const resumeDate = raw["resumeDate"];
        if (typeof resumeDate !== "string" || !DATE_ONLY_PATTERN.test(resumeDate)) {
            throw invalid("/resumeReplan/resumeDate", "INVALID_FORMAT", "재개일은 YYYY-MM-DD 형식이어야 해요.");
        }
        const outgoing = raw["outgoingLastServedDate"];
        if (outgoing !== undefined && (typeof outgoing !== "string" || !DATE_ONLY_PATTERN.test(outgoing))) {
            throw invalid(
                "/resumeReplan/outgoingLastServedDate",
                "INVALID_FORMAT",
                "이전 관리사의 마지막 제공일은 YYYY-MM-DD 형식이어야 해요.",
            );
        }
        const incoming = raw["incomingAssignmentId"];
        if (incoming !== undefined && (typeof incoming !== "string" || incoming.length === 0 || incoming.length > 64)) {
            throw invalid(
                "/resumeReplan/incomingAssignmentId",
                "INVALID_FORMAT",
                "새로 맡는 관리사 배정 ID가 올바르지 않아요.",
            );
        }
        return {
            fromSessionIndex,
            resumeDate,
            ...(outgoing === undefined ? {} : { outgoingLastServedDate: outgoing as string }),
            ...(incoming === undefined ? {} : { incomingAssignmentId: incoming as string }),
        };
    }

    private validateHeader(raw: unknown): ServiceRecordEditJsonValue {
        if (!isPlainRecord(raw)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes/header",
                code: "INVALID_FORMAT",
                detail: "임시 저장 헤더는 객체여야 해요.",
                location: "body",
            }));
        }
        const output: Record<string, ServiceRecordEditJsonValue> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!EDITABLE_HEADER_KEYS.has(key)) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: `/changes/header/${key}`,
                    code: "UNEXPECTED_FIELD",
                    detail: `허용되지 않는 헤더 항목이에요: ${key}`,
                    location: "body",
                }));
            }
            if (typeof value !== "string" || value.length > 120) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: `/changes/header/${key}`,
                    code: "INVALID_FORMAT",
                    detail: "헤더 항목은 120자 이하의 문자열이어야 해요.",
                    location: "body",
                }));
            }
            const normalized = value.trim();
            if (key === "momBirth" || key === "babyBirth") {
                // Fixed-width birthdays are validated exactly as supplied, so a
                // padded value can never be trimmed into a valid date; the
                // stored value is identical because accepted values are
                // trim-stable. Whitespace-only stays an explicit blank clear.
                validateServiceRecordHeaderValue(key, value);
            } else {
                validateServiceRecordHeaderValue(key, normalized);
            }
            output[key] = normalized;
        }
        return output;
    }

    private validateSessions(raw: unknown, source: SourceSnapshot): ServiceRecordEditJsonValue {
        if (!Array.isArray(raw)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes/sessions",
                code: "INVALID_FORMAT",
                detail: "임시 저장 회차는 배열이어야 해요.",
                location: "body",
            }));
        }
        if (raw.length > 100) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes/sessions",
                code: "OUT_OF_RANGE",
                detail: "회차 항목이 너무 많아요.",
                location: "body",
            }));
        }

        const maxSessionIndex = source.requiredSessionCount ?? source.sessions.reduce(
            (max, session) => Math.max(max, session.sessionIndex),
            0,
        );
        const seen = new Set<number>();
        const sessions: ServiceRecordEditJsonValue[] = [];
        for (const value of raw) {
            if (!isPlainRecord(value)) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/changes/sessions",
                    code: "INVALID_FORMAT",
                    detail: "각 회차는 객체여야 해요.",
                    location: "body",
                }));
            }
            const unknownFields = Object.keys(value).filter((key) => !EDITABLE_SESSION_KEYS.has(key));
            if (unknownFields.length > 0) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: `/changes/sessions/${unknownFields[0]}`,
                    code: "UNEXPECTED_FIELD",
                    detail: `허용되지 않는 회차 항목이에요: ${unknownFields[0]}`,
                    location: "body",
                }));
            }
            const sessionIndex = value["sessionIndex"];
            if (typeof sessionIndex !== "number" || !Number.isInteger(sessionIndex) || sessionIndex < 1 || sessionIndex > maxSessionIndex) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/changes/sessions",
                    code: "OUT_OF_RANGE",
                    detail: "회차 번호가 계약 범위를 벗어났어요.",
                    location: "body",
                }));
            }
            if (source.sessions.some((session) => session.sessionIndex === sessionIndex && session.ambiguous)) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/changes/sessions",
                    code: "INVALID_VALUE",
                    detail: "해당 회차는 계통이 불명확한 기존 데이터가 있어 수정할 수 없어요.",
                    location: "body",
                }));
            }
            if (seen.has(sessionIndex)) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/changes/sessions",
                    code: "INVALID_VALUE",
                    detail: "같은 회차가 여러 번 있어요.",
                    location: "body",
                }));
            }
            seen.add(sessionIndex);

            const session: Record<string, ServiceRecordEditJsonValue> = { sessionIndex };
            if (value["serviceDate"] !== undefined) session["serviceDate"] = this.validateDate(value["serviceDate"]);
            if (value["answers"] !== undefined) session["answers"] = jsonValue(validateServiceRecordAnswers(value["answers"]));
            if (value["etcService"] !== undefined) session["etcService"] = validateServiceRecordEditText(value["etcService"], "etcService");
            if (value["notes"] !== undefined) session["notes"] = validateServiceRecordEditText(value["notes"], "notes");
            if (value["paymentConfirmed"] !== undefined) {
                if (typeof value["paymentConfirmed"] !== "boolean") {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/changes/sessions/paymentConfirmed",
                        code: "INVALID_FORMAT",
                        detail: "결제 확인 여부는 참·거짓 값이어야 해요.",
                        location: "body",
                    }));
                }
                session["paymentConfirmed"] = value["paymentConfirmed"];
            }
            sessions.push(session);
        }
        return sessions;
    }

    private validateDate(value: unknown): string {
        if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes/sessions/serviceDate",
                code: "INVALID_FORMAT",
                detail: "서비스 제공일자는 YYYY-MM-DD 형식이어야 해요.",
                location: "body",
            }));
        }
        const parts = value.split("-").map(Number);
        const year = parts[0]!;
        const month = parts[1]!;
        const day = parts[2]!;
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes/sessions/serviceDate",
                code: "INVALID_VALUE",
                detail: "서비스 제공일자가 올바르지 않아요.",
                location: "body",
            }));
        }
        return value;
    }

    private async resolveDraftTarget(
        branchId: string,
        draftId: string,
    ): Promise<{ loaded: LoadedSource; draft: ServiceRecordEditDraft }> {
        if (!UUID_PATTERN.test(draftId)) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        if (typeof this.repository.loadDraftWithSource === "function") {
            const target = await this.repository.loadDraftWithSource(branchId, draftId);
            if (!target) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            return {
                draft: target.draft,
                loaded: { source: target.source, fingerprint: sourceFingerprint(target.source) },
            };
        }
        const draft = await this.repository.findDraftById(branchId, draftId);
        if (!draft) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return { draft, loaded: await this.loadSource(branchId, { caseId: draft.serviceRecordCaseId }) };
    }

    private async loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<LoadedSource> {
        const source = await this.repository.loadSource(branchId, target);
        if (!source) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return { source, fingerprint: sourceFingerprint(source) };
    }
}
