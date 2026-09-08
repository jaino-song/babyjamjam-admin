import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditChanges,
    type AdminServiceRecordEditDateMove,
    type AdminServiceRecordEditDraft,
    type AdminServiceRecordEditState,
    type ServiceRecordEditPreviewResponse,
    type ServiceRecordPlannedSession,
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
    const sessionIndex = asNumber(value.sessionIndex);
    const scheduleId = asNumber(value.scheduleId);
    const employeeId = asNumber(value.employeeId);
    const serviceDate = asString(value.serviceDate);
    const originalDate = asString(value.originalDate);
    const assignmentId = asString(value.assignmentId);
    const provenanceVersion = asString(value.provenanceVersion);
    if (
        sessionIndex < 1
        || scheduleId < 1
        || employeeId < 1
        || !serviceDate
        || !originalDate
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

function normalizePreviewVector(value: unknown): ServiceRecordEditPreviewResponse["before"] {
    const record = isRecord(value) ? value : {};
    return {
        startDate: typeof record.startDate === "string" ? record.startDate : null,
        endDate: typeof record.endDate === "string" ? record.endDate : null,
        sessions: Array.isArray(record.sessions)
            ? record.sessions.flatMap((session) => {
                const normalized = normalizePreviewSession(session);
                return normalized ? [normalized] : [];
            })
            : [],
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
    const rawReasons = Array.isArray(payload.blockingReasons) ? payload.blockingReasons : [];
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
    const provenance = Array.isArray(payload.provenance)
        ? payload.provenance.flatMap((item) => {
            if (!isRecord(item)) return [];
            const assignmentId = asString(item.assignmentId);
            const scheduleId = asNumber(item.scheduleId);
            const employeeId = asNumber(item.employeeId);
            const startDate = asString(item.startDate);
            const endDate = asString(item.endDate);
            const provenanceVersion = asString(item.provenanceVersion);
            if (!assignmentId || scheduleId < 1 || employeeId < 1 || !startDate || !endDate || !provenanceVersion) return [];
            return [{ assignmentId, scheduleId, employeeId, startDate, endDate, provenanceVersion }];
        })
        : [];
    const hasPreviewEnvelope = isRecord(value)
        && typeof payload.previewId === "string"
        && typeof payload.draftId === "string"
        && isRecord(payload.before)
        && isRecord(payload.after);
    const normalizedReasons = blockingReasons.length > 0
        ? blockingReasons
        : hasPreviewEnvelope
            ? []
            : [{ code: "INVALID_PREVIEW_RESPONSE", message: "미리보기 응답을 확인할 수 없습니다." }];
    return {
        previewId: asString(payload.previewId),
        draftId: asString(payload.draftId),
        draftVersion: asNumber(payload.draftVersion),
        sourceCaseVersion: asNumber(payload.sourceCaseVersion),
        sourceFingerprint: asString(payload.sourceFingerprint),
        requiredSessionCount: typeof payload.requiredSessionCount === "number" ? payload.requiredSessionCount : null,
        calendarVersion: asString(payload.calendarVersion),
        before: normalizePreviewVector(payload.before),
        after: normalizePreviewVector(payload.after),
        provenance,
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
