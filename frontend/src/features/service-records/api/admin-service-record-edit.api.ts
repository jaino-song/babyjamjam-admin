import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditChanges,
    type AdminServiceRecordEditDraft,
    type AdminServiceRecordEditState,
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
    ): Promise<AdminServiceRecordEditState> {
        const body = await request<unknown>(draftIdPath(draftId), {
            method: "PATCH",
            body: JSON.stringify({ expectedDraftVersion, changes }),
        });
        return normalizeAdminServiceRecordEditState(body);
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
