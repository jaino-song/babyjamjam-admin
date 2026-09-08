import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

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
    SERVICE_RECORD_EDIT_REPOSITORY,
    type CreateServiceRecordEditDraftInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditDraft,
    type ServiceRecordEditConfirmPlan,
    type ServiceRecordEditConfirmSessionUpdate,
    type ServiceRecordEditJsonObject,
    type ServiceRecordEditJsonValue,
    type ServiceRecordEditSource,
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceSnapshot = ServiceRecordEditSource;

interface LoadedSource {
    source: SourceSnapshot;
    fingerprint: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new BadRequestException({ code: "SERVICE_RECORD_SOURCE_INVALID" });
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

function sourceFingerprint(source: SourceSnapshot): string {
    // Lifecycle/retry timestamps and the optimistic case version are kept in
    // the immutable snapshot but deliberately excluded from this business
    // fingerprint. A status-only transition must not invalidate a draft.
    const fingerprintPayload = jsonValue({
        caseId: source.caseId,
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

function documentStatusForSource(source: ServiceRecordEditSource): ServiceRecordEditConfirmDocumentStatus {
    switch (source.documentScope?.contract.stage) {
        case "in_progress":
            return "waiting_for_completion";
        case "rejected":
            return "pending";
        case "completed":
        case "unknown":
        case null:
        case undefined:
        default:
            return "capability_unverified";
    }
}

const COMPLETE_SERVICE_RECORD_CASE_STATUSES = new Set([
    "READY_TO_FINALIZE",
    "FINALIZING",
    "FINALIZATION_FAILED",
    "DOCUMENTS_CREATED",
    "COMPLETED",
]);

/**
 * A confirm may create a revision while later sessions are still unwritten.
 * Only a source that carries every submitted/signature-bearing row and an
 * observed lifecycle completion state can be handed to a complete document
 * generation worker.  The check is deliberately fail-closed: N, duration,
 * and the editor's planned vector are never inferred from one another.
 */
function revisionCompleteness(source: ServiceRecordEditSource): "complete" | "partial" {
    const required = source.requiredSessionCount;
    if (
        !Number.isInteger(required)
        || required === null
        || required < 1
    ) {
        return "partial";
    }
    if (
        source.sessions.length !== required
        || !COMPLETE_SERVICE_RECORD_CASE_STATUSES.has(source.caseLifecycle?.status ?? "")
        || (source.signatureMetadata && source.signatureMetadata.evidence !== "observed")
    ) {
        return "partial";
    }

    const seen = new Set<number>();
    const completeHeader = Object.values(source.header).every((value) => Boolean(value?.trim()));
    if (!completeHeader) return "partial";

    for (const day of source.sessions) {
        if (
            day.ambiguous
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
        if (!validatedChanges) throw new BadRequestException("Draft changes are required");
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
                throw new BadRequestException({ code: error.code, message: error.message, sessionIndex: error.sessionIndex });
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
            throw new ConflictException({ code: "SERVICE_RECORD_DRAFT_CLOSED" });
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
            throw new ConflictException({
                code: "SERVICE_RECORD_SOURCE_CHANGED",
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
            changes: target.draft.changes,
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
            throw new NotFoundException("Service-record draft not found");
        }
        if (!Number.isInteger(dto.expectedDraftVersion) || dto.expectedDraftVersion < 1) {
            throw new BadRequestException("expectedDraftVersion must be a positive integer");
        }
        if (typeof dto.previewId !== "string" || !/^srp_[0-9a-f]{64}$/i.test(dto.previewId)) {
            throw new BadRequestException("previewId is invalid");
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
                prepare: ({ draft, source }) => this.buildConfirmPlan({
                    draft,
                    source,
                    branchId,
                    draftId,
                    actorUserId,
                    previewId: dto.previewId,
                }),
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            if (error instanceof ServiceRecordEditConflictError) {
                throw new ConflictException({ code: error.code, message: error.message });
            }
            throw error;
        }
    }

    private buildConfirmPlan(args: {
        draft: ServiceRecordEditDraft;
        source: SourceSnapshot;
        branchId: string;
        draftId: string;
        actorUserId: string;
        previewId: string;
    }): ServiceRecordEditConfirmPlan {
        const { draft, source, branchId, draftId, actorUserId, previewId } = args;
        if (draft.status !== "ACTIVE") {
            throw new ConflictException({ code: "SERVICE_RECORD_DRAFT_CLOSED" });
        }

        const fingerprint = sourceFingerprint(source);
        if (draft.sourceFingerprint !== fingerprint) {
            throw new ConflictException({
                code: "SERVICE_RECORD_SOURCE_CHANGED",
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
            changes: draft.changes,
            previewId: "pending",
        });
        const { previewId: _ignoredPreviewId, ...previewValues } = provisional;
        void _ignoredPreviewId;
        const computedPreviewId = `srp_${createHash("sha256")
            .update(stableStringify(jsonValue(previewValues)))
            .digest("hex")}`;
        if (computedPreviewId !== previewId) {
            throw new ConflictException({
                code: "SERVICE_RECORD_PREVIEW_STALE",
                previewId: computedPreviewId,
                sourceCaseVersion: source.caseVersion,
                sourceFingerprint: fingerprint,
            });
        }
        if (provisional.blockingReasons.length > 0) {
            throw new ConflictException({
                code: "SERVICE_RECORD_PREVIEW_BLOCKED",
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
                answers: patch?.answers ?? day.answers,
                etcService: typeof patch?.etcService === "string" ? patch.etcService : day.etcService,
                notes: typeof patch?.notes === "string" ? patch.notes : day.notes,
                paymentConfirmed: typeof patch?.paymentConfirmed === "boolean"
                    ? patch.paymentConfirmed
                    : day.paymentConfirmed,
            };
        });

        const plannedSessions = jsonValue(provisional.after.sessions);
        const beforeByIndex = new Map(provisional.before.sessions.map((entry) => [entry.sessionIndex, entry]));
        const effectiveRows = source.sessions.map((day) => {
            const update = sessions.find((session) => session.sourceRowId === day.sourceRowId);
            const original = beforeByIndex.get(day.sessionIndex)?.originalDate ?? day.serviceDate;
            return {
                sourceRowId: day.sourceRowId,
                sessionIndex: day.sessionIndex,
                serviceDate: update?.serviceDate ?? day.serviceDate,
                originalDate: original,
                answers: update?.answers ?? day.answers,
                etcService: update?.etcService ?? day.etcService,
                notes: update?.notes ?? day.notes,
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
        const completeness = revisionCompleteness(source);
        const revisionPayload = jsonValue({
            caseId: source.caseId,
            clientId: source.client.id,
            requiredSessionCount: provisional.requiredSessionCount,
            startDate: provisional.after.startDate,
            endDate: provisional.after.endDate,
            formVersion: source.formVersion,
            caseLifecycle: source.caseLifecycle,
            header,
            plannedSessions,
            sessions: effectiveRows,
            signatureMetadata: provisional.signatureMetadata,
            documentScope: provisional.documentScope,
            completeness,
        });
        const revisionFingerprint = createHash("sha256")
            .update(stableStringify(revisionPayload))
            .digest("hex");
        const changed = provisional.contentChanges.headerChanged
            || provisional.contentChanges.changedSessionIndexes.length > 0;
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
                    periodChanged: provisional.after.startDate !== source.startDate
                        || provisional.after.endDate !== source.endDate,
                },
                payloadFingerprint: revisionFingerprint,
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
        throw new ConflictException({
            code: error.code,
            message: error.message,
            latestDraft: latest ? mapDraft(latest) : null,
            sourceChanged: latest ? latest.sourceFingerprint !== current.fingerprint : false,
            sourceCaseVersion: current.source.caseVersion,
            sourceFingerprint: current.fingerprint,
        });
    }

    private throwRepositoryNotFound(error: unknown): never {
        if (error instanceof ServiceRecordEditNotFoundError) {
            throw new NotFoundException("Service-record edit resource was not found");
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
        if (!isPlainRecord(raw)) throw new BadRequestException("Draft changes must be an object");

        const serialized = JSON.stringify(raw);
        if (typeof serialized !== "string") throw new BadRequestException("Draft changes must be serializable");
        if (Buffer.byteLength(serialized, "utf8") > MAX_CHANGES_BYTES) {
            throw new BadRequestException("제공기록 초안이 너무 큽니다.");
        }

        const unknownRoot = Object.keys(raw).filter((key) => key !== "header" && key !== "sessions");
        if (unknownRoot.length > 0) {
            throw new BadRequestException(`Unknown service-record draft field: ${unknownRoot[0]}`);
        }

        const rawRecord = raw as unknown as Record<string, unknown>;
        const output: ServiceRecordEditJsonObject = {};
        if (rawRecord["header"] !== undefined) output["header"] = this.validateHeader(rawRecord["header"]);
        if (rawRecord["sessions"] !== undefined) output["sessions"] = this.validateSessions(rawRecord["sessions"], source);
        return output;
    }

    private validateHeader(raw: unknown): ServiceRecordEditJsonValue {
        if (!isPlainRecord(raw)) throw new BadRequestException("Draft header must be an object");
        const output: Record<string, ServiceRecordEditJsonValue> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!EDITABLE_HEADER_KEYS.has(key)) {
                throw new BadRequestException(`Unknown service-record header field: ${key}`);
            }
            if (typeof value !== "string" || value.length > 120) {
                throw new BadRequestException(`Invalid service-record header field: ${key}`);
            }
            output[key] = value.trim();
        }
        return output;
    }

    private validateSessions(raw: unknown, source: SourceSnapshot): ServiceRecordEditJsonValue {
        if (!Array.isArray(raw)) throw new BadRequestException("Draft sessions must be an array");
        if (raw.length > 100) throw new BadRequestException("Too many service-record sessions");

        const maxSessionIndex = source.requiredSessionCount ?? source.sessions.reduce(
            (max, session) => Math.max(max, session.sessionIndex),
            0,
        );
        const seen = new Set<number>();
        const sessions: ServiceRecordEditJsonValue[] = [];
        for (const value of raw) {
            if (!isPlainRecord(value)) throw new BadRequestException("Draft session must be an object");
            const unknownFields = Object.keys(value).filter((key) => !EDITABLE_SESSION_KEYS.has(key));
            if (unknownFields.length > 0) {
                throw new BadRequestException(`Unknown service-record session field: ${unknownFields[0]}`);
            }
            const sessionIndex = value["sessionIndex"];
            if (typeof sessionIndex !== "number" || !Number.isInteger(sessionIndex) || sessionIndex < 1 || sessionIndex > maxSessionIndex) {
                throw new BadRequestException(`Session ${String(sessionIndex)} is outside the contracted range 1..${maxSessionIndex}`);
            }
            if (source.sessions.some((session) => session.sessionIndex === sessionIndex && session.ambiguous)) {
                throw new BadRequestException(`Session ${sessionIndex} has ambiguous legacy source rows`);
            }
            if (seen.has(sessionIndex)) throw new BadRequestException(`Duplicate service-record session: ${sessionIndex}`);
            seen.add(sessionIndex);

            const session: Record<string, ServiceRecordEditJsonValue> = { sessionIndex };
            if (value["serviceDate"] !== undefined) session["serviceDate"] = this.validateDate(value["serviceDate"]);
            if (value["answers"] !== undefined) session["answers"] = jsonValue(validateServiceRecordAnswers(value["answers"]));
            if (value["etcService"] !== undefined) session["etcService"] = validateServiceRecordEditText(value["etcService"], "etcService");
            if (value["notes"] !== undefined) session["notes"] = validateServiceRecordEditText(value["notes"], "notes");
            if (value["paymentConfirmed"] !== undefined) {
                if (typeof value["paymentConfirmed"] !== "boolean") throw new BadRequestException("paymentConfirmed must be boolean");
                session["paymentConfirmed"] = value["paymentConfirmed"];
            }
            sessions.push(session);
        }
        return sessions;
    }

    private validateDate(value: unknown): string {
        if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
            throw new BadRequestException("서비스 제공일자는 YYYY-MM-DD 형식이어야 합니다.");
        }
        const parts = value.split("-").map(Number);
        const year = parts[0]!;
        const month = parts[1]!;
        const day = parts[2]!;
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            throw new BadRequestException("서비스 제공일자가 올바르지 않습니다.");
        }
        return value;
    }

    private async resolveDraftTarget(
        branchId: string,
        draftId: string,
    ): Promise<{ loaded: LoadedSource; draft: ServiceRecordEditDraft }> {
        if (!UUID_PATTERN.test(draftId)) throw new NotFoundException("Service-record draft not found");
        if (typeof this.repository.loadDraftWithSource === "function") {
            const target = await this.repository.loadDraftWithSource(branchId, draftId);
            if (!target) throw new NotFoundException("Service-record draft not found");
            return {
                draft: target.draft,
                loaded: { source: target.source, fingerprint: sourceFingerprint(target.source) },
            };
        }
        const draft = await this.repository.findDraftById(branchId, draftId);
        if (!draft) throw new NotFoundException("Service-record draft not found");
        return { draft, loaded: await this.loadSource(branchId, { caseId: draft.serviceRecordCaseId }) };
    }

    private async loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<LoadedSource> {
        const source = await this.repository.loadSource(branchId, target);
        if (!source) throw new NotFoundException("Service-record source was not found");
        return { source, fingerprint: sourceFingerprint(source) };
    }
}
