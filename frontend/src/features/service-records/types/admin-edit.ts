/**
 * Frontend representation of the administrator draft contract.  The source
 * snapshot is provenance owned by the backend and is intentionally opaque to
 * the editor; only `changes` is applied to the form.
 */
export type AdminServiceRecordEditDraftStatus = "ACTIVE" | "DISCARDED";

export interface AdminServiceRecordEditHeaderChanges {
    momName?: string;
    momBirth?: string;
    babyName?: string;
    babyBirth?: string;
    deliveryType?: string;
    babyWeight?: string;
}
export interface AdminServiceRecordEditSessionChanges {
    sessionIndex: number;
    serviceDate?: string;
    answers?: Record<string, unknown>;
    etcService?: string;
    notes?: string;
    paymentConfirmed?: boolean;
}

export interface AdminServiceRecordEditDateMove {
    sessionIndex: number;
    toDate: string;
}

export interface AdminServiceRecordEditChanges {
    header?: AdminServiceRecordEditHeaderChanges;
    sessions?: AdminServiceRecordEditSessionChanges[];
}

export interface AdminServiceRecordEditDraft {
    id: string;
    branchId: string;
    serviceRecordCaseId: string;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    sourceSnapshot: unknown;
    changes: AdminServiceRecordEditChanges;
    draftVersion: number;
    status: AdminServiceRecordEditDraftStatus;
    createdByUserId: string;
    updatedByUserId: string;
    discardedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    discardedAt: string | null;
}

export interface AdminServiceRecordEditState {
    draft: AdminServiceRecordEditDraft | null;
    sourceChanged: boolean;
    sourceCaseVersion: number;
    sourceFingerprint: string;
}

export class AdminServiceRecordEditApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(`Service record draft request failed (${status})`);
        this.name = "AdminServiceRecordEditApiError";
        this.status = status;
        this.body = body;
    }
}
