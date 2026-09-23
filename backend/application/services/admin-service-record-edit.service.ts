import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { isValidBirthdayIsoDate, normalizeContractBirthday } from "@babyjamjam/shared/utils/birthday";
import { getServiceRecordHeaderFieldError } from "@babyjamjam/shared/utils/service-record-input";

import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import {
    validateServiceRecordAnswers,
    validateServiceRecordEditText,
} from "application/policies/service-record-answer-validation.policy";
import {
    buildServiceRecordEditPreview,
    normalizeServiceRecordEditChanges,
    ServiceRecordScheduleValidationError,
    type ServiceRecordEditDateMove,
} from "application/policies/service-record-edit-preview.policy";
import {
    ServiceRecordEditConflictError,
    ServiceRecordEditNotFoundError,
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
    ) {}

    async startDraft(
        branchId: string,
        clientId: number,
        actorUserId: string,
        dto: CreateServiceRecordEditDraftDto = {},
    ): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const changes = this.validateChanges(dto.changes, loaded.source);
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

    async getDraft(branchId: string, clientId: number): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const draft = await this.repository.findActiveDraft(branchId, loaded.source.caseId);
        return this.state(draft, loaded);
    }

    async updateDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: UpdateServiceRecordEditDraftDto,
    ): Promise<AdminServiceRecordEditStateDto> {
        const target = await this.resolveDraftTarget(branchId, draftId);
        const validatedChanges = this.validateChanges(dto.changes, target.loaded.source);
        if (!validatedChanges) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "REQUIRED",
                detail: "저장할 변경 내용을 입력해 주세요.",
                location: "body",
            }));
        }
        let changes: ServiceRecordEditJsonObject;
        try {
            changes = normalizeServiceRecordEditChanges(
                target.loaded.source,
                target.draft.changes,
                validatedChanges,
                dto.dateMove as ServiceRecordEditDateMove | undefined,
            ).changes;
        } catch (error) {
            if (error instanceof ServiceRecordScheduleValidationError) {
                // 일정 벡터 사유 코드는 카탈로그에 없는 실행시점 표기라서(EM-CAT-01)
                // 등록된 검증 코드로 응답하고 원인 텍스트는 호환 message로만 남겨요.
                throw new BadRequestException({
                    ...problemBody("VALIDATION_FAILED", {
                        pointer: "/changes",
                        code: "INVALID_VALUE",
                        detail: "제공기록 일정 변경을 적용할 수 없어요.",
                        location: "body",
                    }),
                    message: error.message,
                    sessionIndex: error.sessionIndex,
                });
            }
            throw error;
        }

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

        const provisional = buildServiceRecordEditPreview({
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

        try {
            return await this.repository.confirmDraft({
                branchId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                previewId: dto.previewId,
                idempotencyKey: dto.idempotencyKey,
                requestFingerprint,
                actorUserId,
                prepare: ({ draft, source, revisionFactsSource }) => this.buildConfirmPlan({
                    draft,
                    source,
                    revisionFactsSource,
                    branchId,
                    draftId,
                    actorUserId,
                    previewId: dto.previewId,
                }),
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            if (error instanceof ServiceRecordEditConflictError) {
                // 저장소 충돌 전체(버전 경합·문서 상태 경합)는 "작업 대상 변경"의
                // 동일 원인이라 등록된 코드를 재사용해요(EM-CAT-02).
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            throw error;
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
    }): ServiceRecordEditConfirmPlan {
        const { draft, source, revisionFactsSource, branchId, draftId, actorUserId, previewId } = args;
        if (draft.status !== "ACTIVE") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_NOT_PENDING"));
        }

        const fingerprint = sourceFingerprint(source);
        if (draft.sourceFingerprint !== fingerprint) {
            throw new ConflictException({
                ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
                sourceChanged: true,
                sourceCaseVersion: source.caseVersion,
                sourceFingerprint: fingerprint,
            });
        }

        const provisional = buildServiceRecordEditPreview({
            draftId,
            draftVersion: draft.draftVersion,
            sourceCaseVersion: source.caseVersion,
            sourceFingerprint: fingerprint,
            source,
            changes: effectivePreviewChanges(source, draft.changes),
            previewId: "pending",
        });
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
        const changed = provisional.contentChanges.headerChanged
            || contentChanged
            || hasPlannedDateDifference(provisional.before.sessions, provisional.after.sessions);
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
                    ? "SERVICE_RECORD_CONTRACT_FACTS_UNAVAILABLE"
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
        const receiptInput = factsResult.receiptInput;
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
                    ? "SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE"
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
            assignments: provisional.provenance.map((range) => ({
                assignmentId: range.assignmentId,
                scheduleId: range.scheduleId,
                startDate: range.startDate,
                endDate: range.endDate,
            })),
            revision: changed
                ? {
                    branchId,
                    serviceRecordCaseId: source.caseId,
                    actorUserId,
                    payload: revisionPayload,
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
