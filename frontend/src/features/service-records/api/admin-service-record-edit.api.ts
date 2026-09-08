import type { ServiceRecordEditContractStage } from "@babyjamjam/shared/types/service-record";

import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditChanges,
    type AdminServiceRecordEditDateMove,
    type AdminServiceRecordEditDraft,
    type AdminServiceRecordEditState,
    type ServiceRecordEditDocumentChunk,
    type ServiceRecordEditDocumentScope,
    type ServiceRecordEditPreviewResponse,
    type ServiceRecordPlannedSession,
    type ServiceRecordEditSignatureMetadata,
    type ServiceRecordEditSignatureSessionMetadata,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDateOnly(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

function positiveInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const SERVICE_RECORD_EDIT_CONTRACT_STAGES = ["completed", "rejected", "in_progress", "unknown"] as const;
type KnownServiceRecordEditContractStage = Exclude<ServiceRecordEditContractStage, null>;

function normalizeContractStage(value: unknown): { value: ServiceRecordEditContractStage; valid: boolean } {
    if (value === null) return { value: null, valid: true };
    if (typeof value !== "string") return { value: null, valid: false };
    return SERVICE_RECORD_EDIT_CONTRACT_STAGES.includes(value as KnownServiceRecordEditContractStage)
        ? { value: value as KnownServiceRecordEditContractStage, valid: true }
        : { value: null, valid: false };
}

function normalizeDraft(value: unknown): AdminServiceRecordEditDraft | null {
    if (!isRecord(value) || typeof value.id !== "string") return null;
    const changes = isRecord(value.changes) ? value.changes : {};
    const status = value.status === "DISCARDED" ? "DISCARDED" : "ACTIVE";
    return {
        id: value.id,
        branchId: asString(value.branchId),
        serviceRecordCaseId: asString(value.serviceRecordCaseId),
        sourceCaseVersion: asNumber(value.sourceCaseVersion),
        sourceFingerprint: asString(value.sourceFingerprint),
        sourceSnapshot: value.sourceSnapshot,
        changes: changes as AdminServiceRecordEditChanges,
        draftVersion: asNumber(value.draftVersion),
        status,
        createdByUserId: asString(value.createdByUserId),
        updatedByUserId: asString(value.updatedByUserId),
        discardedByUserId: typeof value.discardedByUserId === "string" ? value.discardedByUserId : null,
        createdAt: asString(value.createdAt),
        updatedAt: asString(value.updatedAt),
        discardedAt: typeof value.discardedAt === "string" ? value.discardedAt : null,
    };
}

function normalizePreviewSession(value: unknown): ServiceRecordPlannedSession | null {
    if (!isRecord(value)) return null;
    const sessionIndex = positiveInteger(value.sessionIndex);
    const scheduleId = positiveInteger(value.scheduleId);
    const employeeId = positiveInteger(value.employeeId);
    const serviceDate = asString(value.serviceDate);
    const originalDate = asString(value.originalDate);
    const assignmentId = asString(value.assignmentId);
    const provenanceVersion = asString(value.provenanceVersion);
    if (
        sessionIndex === null
        || scheduleId === null
        || employeeId === null
        || !isValidDateOnly(serviceDate)
        || !isValidDateOnly(originalDate)
        || !assignmentId
        || !provenanceVersion
    ) return null;
    return {
        sessionIndex,
        serviceDate,
        originalDate,
        assignmentId,
        scheduleId,
        employeeId,
        provenanceVersion,
    };
}

interface NormalizedPreviewVector {
    vector: ServiceRecordEditPreviewResponse["before"];
    valid: boolean;
    hasEntries: boolean;
    hadRawEntries: boolean;
    shapeValid: boolean;
}

function normalizePreviewVectorStrict(value: unknown, expectedCount: number | null): NormalizedPreviewVector {
    if (!isRecord(value) || !Array.isArray(value.sessions)) {
        return {
            vector: { startDate: null, endDate: null, sessions: [] },
            valid: false,
            hasEntries: false,
            hadRawEntries: false,
            shapeValid: false,
        };
    }

    let valid = true;
    let shapeValid = true;
    const startDate = value.startDate === null || value.startDate === undefined
        ? null
        : isValidDateOnly(value.startDate) ? value.startDate : null;
    const endDate = value.endDate === null || value.endDate === undefined
        ? null
        : isValidDateOnly(value.endDate) ? value.endDate : null;
    if ((value.startDate !== null && value.startDate !== undefined && startDate === null)
        || (value.endDate !== null && value.endDate !== undefined && endDate === null)) {
        valid = false;
        shapeValid = false;
    }
    if (startDate && endDate && startDate > endDate) {
        valid = false;
        shapeValid = false;
    }

    const seenIndexes = new Set<number>();
    const seenServiceDates = new Set<string>();
    const sessions: ServiceRecordPlannedSession[] = [];
    for (const rawSession of value.sessions) {
        const normalized = normalizePreviewSession(rawSession);
        if (!normalized || seenIndexes.has(normalized.sessionIndex)) {
            valid = false;
            shapeValid = false;
            continue;
        }
        if (seenServiceDates.has(normalized.serviceDate)) {
            valid = false;
            shapeValid = false;
            continue;
        }
        seenIndexes.add(normalized.sessionIndex);
        seenServiceDates.add(normalized.serviceDate);
        sessions.push(normalized);
    }
    sessions.sort((left, right) => left.sessionIndex - right.sessionIndex);
    if (expectedCount !== null) {
        if (sessions.length !== expectedCount
            || sessions.some((session, index) => session.sessionIndex !== index + 1)) {
            valid = false;
        }
    }
    if (sessions.length > 0 && (!startDate || !endDate)) valid = false;
    if (startDate && endDate) {
        for (const session of sessions) {
            if (session.serviceDate < startDate || session.serviceDate > endDate) {
                valid = false;
            }
        }
    }
    return {
        vector: { startDate, endDate, sessions },
        valid,
        hasEntries: sessions.length > 0,
        hadRawEntries: value.sessions.length > 0,
        shapeValid,
    };
}

interface NormalizedPreviewProvenance {
    items: ServiceRecordEditPreviewResponse["provenance"];
    valid: boolean;
}

function normalizePreviewProvenance(value: unknown): NormalizedPreviewProvenance {
    if (!Array.isArray(value)) return { items: [], valid: false };
    let valid = true;
    const items: ServiceRecordEditPreviewResponse["provenance"] = [];
    const seen = new Set<string>();
    for (const rawItem of value) {
        if (!isRecord(rawItem)) {
            valid = false;
            continue;
        }
        const assignmentId = asString(rawItem.assignmentId);
        const scheduleId = positiveInteger(rawItem.scheduleId);
        const employeeId = positiveInteger(rawItem.employeeId);
        const startDate = asString(rawItem.startDate);
        const endDate = asString(rawItem.endDate);
        const provenanceVersion = asString(rawItem.provenanceVersion);
        const key = `${assignmentId}:${scheduleId ?? ""}:${employeeId ?? ""}:${provenanceVersion}`;
        if (!assignmentId || scheduleId === null || employeeId === null
            || !isValidDateOnly(startDate) || !isValidDateOnly(endDate)
            || startDate > endDate || !provenanceVersion || seen.has(key)) {
            valid = false;
            continue;
        }
        seen.add(key);
        items.push({ assignmentId, scheduleId, employeeId, startDate, endDate, provenanceVersion });
    }
    return { items, valid };
}

function hasCompleteProvenance(
    beforeSessions: ServiceRecordPlannedSession[],
    afterSessions: ServiceRecordPlannedSession[],
    provenance: ServiceRecordEditPreviewResponse["provenance"],
): boolean {
    const hasIdentity = (session: ServiceRecordPlannedSession) => provenance.some((range) => (
        range.assignmentId === session.assignmentId
        && range.scheduleId === session.scheduleId
        && range.employeeId === session.employeeId
        && range.provenanceVersion === session.provenanceVersion
    ));
    const hasAfterDateCoverage = (session: ServiceRecordPlannedSession) => provenance.some((range) => (
        range.assignmentId === session.assignmentId
        && range.scheduleId === session.scheduleId
        && range.employeeId === session.employeeId
        && range.provenanceVersion === session.provenanceVersion
        && session.serviceDate >= range.startDate
        && session.serviceDate <= range.endDate
    ));
    return [...beforeSessions, ...afterSessions].every(hasIdentity)
        && afterSessions.every(hasAfterDateCoverage);
}

const UNKNOWN_SIGNATURE_METADATA: ServiceRecordEditSignatureMetadata = {
    treatment: "manual_review",
    evidence: "unverified",
    sessions: [],
};

const UNKNOWN_DOCUMENT_SCOPE: ServiceRecordEditDocumentScope = {
    evidence: "unverified",
    serviceRecordSnapshot: {
        documentIds: [],
        snapshotVersion: null,
        chunks: [],
    },
    currentRevision: {
        id: null,
        revisionNumber: null,
        formVersion: null,
    },
    form: { version: null },
    contract: {
        currentDocumentId: null,
        stage: "unknown",
    },
};

function nullablePositiveInteger(value: unknown): { value: number | null; valid: boolean } {
    if (value === null) return { value: null, valid: true };
    const normalized = positiveInteger(value);
    return normalized === null ? { value: null, valid: false } : { value: normalized, valid: true };
}

function nullableNonNegativeInteger(value: unknown): { value: number | null; valid: boolean } {
    if (value === null) return { value: null, valid: true };
    const normalized = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return normalized === null ? { value: null, valid: false } : { value: normalized, valid: true };
}

function nullableIsoTimestamp(value: unknown): { value: string | null; valid: boolean } {
    if (value === null) return { value: null, valid: true };
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return { value: null, valid: false };
    return { value, valid: true };
}

interface NormalizedSignatureMetadata {
    metadata: ServiceRecordEditSignatureMetadata;
    valid: boolean;
}

function normalizeSignatureMetadata(value: unknown): NormalizedSignatureMetadata {
    if (!isRecord(value)
        || (value.treatment !== "preserve_existing" && value.treatment !== "manual_review")
        || (value.evidence !== "observed" && value.evidence !== "unverified")
        || !Array.isArray(value.sessions)) {
        return { metadata: UNKNOWN_SIGNATURE_METADATA, valid: false };
    }
    let valid = true;
    const sessions: ServiceRecordEditSignatureSessionMetadata[] = [];
    const seen = new Set<number>();
    for (const rawSession of value.sessions) {
        if (!isRecord(rawSession)) {
            valid = false;
            continue;
        }
        const sessionIndex = positiveInteger(rawSession.sessionIndex);
        const signedAt = nullableIsoTimestamp(rawSession.signedAt);
        const submittedAt = nullableIsoTimestamp(rawSession.submittedAt);
        if (sessionIndex === null
            || typeof rawSession.hasSignature !== "boolean"
            || !signedAt.valid
            || !submittedAt.valid
            || seen.has(sessionIndex)) {
            valid = false;
            continue;
        }
        seen.add(sessionIndex);
        sessions.push({
            sessionIndex,
            hasSignature: rawSession.hasSignature,
            signedAt: signedAt.value,
            submittedAt: submittedAt.value,
        });
    }
    sessions.sort((left, right) => left.sessionIndex - right.sessionIndex);
    return {
        metadata: {
            treatment: value.treatment,
            evidence: value.evidence,
            sessions,
        },
        valid,
    };
}

interface NormalizedDocumentScope {
    scope: ServiceRecordEditDocumentScope;
    valid: boolean;
}

function normalizeDocumentScope(value: unknown): NormalizedDocumentScope {
    if (!isRecord(value)
        || (value.evidence !== "observed" && value.evidence !== "unverified")
        || !isRecord(value.serviceRecordSnapshot)
        || !isRecord(value.currentRevision)
        || !isRecord(value.form)
        || !isRecord(value.contract)
        || !Array.isArray(value.serviceRecordSnapshot.documentIds)
        || !Array.isArray(value.serviceRecordSnapshot.chunks)) {
        return { scope: UNKNOWN_DOCUMENT_SCOPE, valid: false };
    }
    let valid = true;
    const documentIds = value.serviceRecordSnapshot.documentIds.filter((id): id is string => {
        const validId = typeof id === "string" && id.length > 0;
        if (!validId) valid = false;
        return validId;
    });
    const snapshotVersion = nullablePositiveInteger(value.serviceRecordSnapshot.snapshotVersion);
    if (!snapshotVersion.valid) valid = false;
    const chunks: ServiceRecordEditDocumentChunk[] = [];
    const seenChunks = new Set<string>();
    for (const rawChunk of value.serviceRecordSnapshot.chunks) {
        if (!isRecord(rawChunk)) {
            valid = false;
            continue;
        }
        const documentId = asString(rawChunk.documentId);
        const chunkSnapshotVersion = nullablePositiveInteger(rawChunk.snapshotVersion);
        const snapshotChunkIndex = nullableNonNegativeInteger(rawChunk.snapshotChunkIndex);
        const key = `${documentId}:${chunkSnapshotVersion.value ?? ""}:${snapshotChunkIndex.value ?? ""}`;
        if (!documentId || !chunkSnapshotVersion.valid || !snapshotChunkIndex.valid || seenChunks.has(key)) {
            valid = false;
            continue;
        }
        seenChunks.add(key);
        chunks.push({
            documentId,
            snapshotVersion: chunkSnapshotVersion.value,
            snapshotChunkIndex: snapshotChunkIndex.value,
        });
    }
    const revisionId = value.currentRevision.id === null ? null : asString(value.currentRevision.id);
    const revisionNumber = nullablePositiveInteger(value.currentRevision.revisionNumber);
    const revisionFormVersion = nullablePositiveInteger(value.currentRevision.formVersion);
    const formVersion = nullablePositiveInteger(value.form.version);
    const currentDocumentId = value.contract.currentDocumentId === null ? null : asString(value.contract.currentDocumentId);
    const stageResult = normalizeContractStage(value.contract.stage);
    if ((value.currentRevision.id !== null && !revisionId)
        || !revisionNumber.valid
        || !revisionFormVersion.valid
        || !formVersion.valid
        || (value.contract.currentDocumentId !== null && !currentDocumentId)
        || !stageResult.valid) {
        valid = false;
    }
    return {
        scope: {
            evidence: value.evidence,
            serviceRecordSnapshot: { documentIds, snapshotVersion: snapshotVersion.value, chunks },
            currentRevision: { id: revisionId, revisionNumber: revisionNumber.value, formVersion: revisionFormVersion.value },
            form: { version: formVersion.value },
            contract: { currentDocumentId, stage: stageResult.value },
        },
        valid,
    };
}

function stripServiceDateSnapshots(changes: AdminServiceRecordEditChanges): AdminServiceRecordEditChanges {
    return {
        ...(changes.header ? { header: { ...changes.header } } : {}),
        ...(changes.sessions
            ? {
                sessions: changes.sessions.map((session) => ({
                    sessionIndex: session.sessionIndex,
                    ...(session.answers ? { answers: { ...session.answers } } : {}),
                    ...(session.etcService !== undefined ? { etcService: session.etcService } : {}),
                    ...(session.notes !== undefined ? { notes: session.notes } : {}),
                    ...(session.paymentConfirmed !== undefined ? { paymentConfirmed: session.paymentConfirmed } : {}),
                })),
            }
            : {}),
    };
}

export function normalizeAdminServiceRecordEditPreview(value: unknown): ServiceRecordEditPreviewResponse {
    const payload = isRecord(value) ? value : {};
    const blockingReasonsPresent = Array.isArray(payload.blockingReasons);
    const rawReasons: unknown[] = Array.isArray(payload.blockingReasons) ? payload.blockingReasons : [];
    const malformedBlockingReason = !blockingReasonsPresent
        || rawReasons.some((reason) => !isRecord(reason) || !asString(reason.code) || !asString(reason.message));
    const blockingReasons = rawReasons.flatMap((reason): ServiceRecordEditPreviewResponse["blockingReasons"] => {
        if (!isRecord(reason)) return [];
        const code = asString(reason.code);
        const message = asString(reason.message);
        if (!code || !message) return [];
        return [{
            code,
            message,
            ...(typeof reason.sessionIndex === "number" ? { sessionIndex: reason.sessionIndex } : {}),
            ...(typeof reason.assignmentId === "string" ? { assignmentId: reason.assignmentId } : {}),
        }];
    });
    const contentChanges = isRecord(payload.contentChanges) ? payload.contentChanges : {};
    const requiredSessionCount = payload.requiredSessionCount === null
        ? null
        : positiveInteger(payload.requiredSessionCount);
    const beforeResult = normalizePreviewVectorStrict(payload.before, requiredSessionCount);
    const afterResult = normalizePreviewVectorStrict(payload.after, requiredSessionCount);
    const provenanceResult = normalizePreviewProvenance(payload.provenance);
    const signatureResult = normalizeSignatureMetadata(payload.signatureMetadata);
    const documentResult = normalizeDocumentScope(payload.documentScope);
    const draftVersion = positiveInteger(payload.draftVersion);
    const sourceCaseVersion = nonNegativeInteger(payload.sourceCaseVersion);
    const sourceFingerprint = typeof payload.sourceFingerprint === "string" && payload.sourceFingerprint.length > 0;
    const calendarVersion = typeof payload.calendarVersion === "string" && payload.calendarVersion.length > 0;
    const hasPreviewEnvelope = isRecord(value)
        && typeof payload.previewId === "string"
        && payload.previewId.length > 0
        && typeof payload.draftId === "string"
        && payload.draftId.length > 0
        && isRecord(payload.before)
        && isRecord(payload.after)
        && draftVersion !== null
        && sourceCaseVersion !== null
        && sourceFingerprint
        && calendarVersion;
    const hasLegitimateBlockingProjection = blockingReasons.length > 0
        && beforeResult.hadRawEntries === false
        && afterResult.hadRawEntries === false
        && beforeResult.shapeValid
        && afterResult.shapeValid
        && provenanceResult.items.length === 0
        && hasPreviewEnvelope;
    const vectorCoverageInvalid = requiredSessionCount === null
        || !beforeResult.valid
        || !afterResult.valid
        || !hasCompleteProvenance(
            beforeResult.vector.sessions,
            afterResult.vector.sessions,
            provenanceResult.items,
        );
    const envelopeOrMetadataInvalid = malformedBlockingReason
        || !hasPreviewEnvelope
        || !provenanceResult.valid
        || !signatureResult.valid
        || !documentResult.valid;
    const invalidPreview = envelopeOrMetadataInvalid
        || (!hasLegitimateBlockingProjection && vectorCoverageInvalid);
    const normalizedReasons = [
        ...blockingReasons,
        ...(invalidPreview
            ? [{ code: "INVALID_PREVIEW_RESPONSE", message: "미리보기 응답을 확인할 수 없습니다." }]
            : []),
    ];
    return {
        previewId: asString(payload.previewId),
        draftId: asString(payload.draftId),
        draftVersion: asNumber(payload.draftVersion),
        sourceCaseVersion: asNumber(payload.sourceCaseVersion),
        sourceFingerprint: asString(payload.sourceFingerprint),
        requiredSessionCount,
        calendarVersion: asString(payload.calendarVersion),
        before: beforeResult.vector,
        after: afterResult.vector,
        provenance: provenanceResult.items,
        contentChanges: {
            headerChanged: contentChanges.headerChanged === true,
            changedSessionIndexes: Array.isArray(contentChanges.changedSessionIndexes)
                ? contentChanges.changedSessionIndexes.filter((index): index is number => typeof index === "number" && Number.isInteger(index))
                : [],
        },
        impactedAssignments: Array.isArray(payload.impactedAssignments)
            ? payload.impactedAssignments.filter((assignmentId): assignmentId is string => typeof assignmentId === "string")
            : [],
        blockingReasons: normalizedReasons,
        signatureMetadata: signatureResult.metadata,
        documentScope: documentResult.scope,
    };
}

export function normalizeAdminServiceRecordEditState(value: unknown): AdminServiceRecordEditState {
    const payload = isRecord(value) ? value : {};
    return {
        draft: normalizeDraft(payload.draft),
        sourceChanged: payload.sourceChanged === true,
        sourceCaseVersion: asNumber(payload.sourceCaseVersion),
        sourceFingerprint: asString(payload.sourceFingerprint),
    };
}

async function readBody(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
        cache: "no-store",
        ...init,
        headers: {
            Accept: "application/json",
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers ?? {}),
        },
    });
    const body = await readBody(response);
    if (!response.ok) throw new AdminServiceRecordEditApiError(response.status, body);
    return body as T;
}

function draftPath(clientId: string): string {
    return `/api/admin/service-records/client/${encodeURIComponent(clientId)}/draft`;
}

function draftIdPath(draftId: string): string {
    return `/api/admin/service-records/drafts/${encodeURIComponent(draftId)}`;
}

export const adminServiceRecordEditApi = {
    async getDraft(clientId: string): Promise<AdminServiceRecordEditState> {
        const body = await request<unknown>(draftPath(clientId), { method: "GET" });
        return normalizeAdminServiceRecordEditState(body);
    },

    async startDraft(
        clientId: string,
        changes?: AdminServiceRecordEditChanges,
    ): Promise<AdminServiceRecordEditState> {
        const body = await request<unknown>(draftPath(clientId), {
            method: "POST",
            body: JSON.stringify(changes ? { changes } : {}),
        });
        return normalizeAdminServiceRecordEditState(body);
    },

    async updateDraft(
        draftId: string,
        expectedDraftVersion: number,
        changes: AdminServiceRecordEditChanges,
        dateMove?: AdminServiceRecordEditDateMove,
    ): Promise<AdminServiceRecordEditState> {
        const body = await request<unknown>(draftIdPath(draftId), {
            method: "PATCH",
            body: JSON.stringify({
                expectedDraftVersion,
                changes: stripServiceDateSnapshots(changes),
                ...(dateMove ? { dateMove } : {}),
            }),
        });
        return normalizeAdminServiceRecordEditState(body);
    },

    async previewDraft(
        draftId: string,
        expectedDraftVersion: number,
    ): Promise<ServiceRecordEditPreviewResponse> {
        const body = await request<unknown>(`${draftIdPath(draftId)}/preview`, {
            method: "POST",
            body: JSON.stringify({ expectedDraftVersion }),
        });
        return normalizeAdminServiceRecordEditPreview(body);
    },

    async discardDraft(
        draftId: string,
        expectedDraftVersion: number,
    ): Promise<AdminServiceRecordEditState> {
        const body = await request<unknown>(`${draftIdPath(draftId)}/discard`, {
            method: "POST",
            body: JSON.stringify({ expectedDraftVersion }),
        });
        return normalizeAdminServiceRecordEditState(body);
    },
};
