/**
 * Frontend representation of the administrator draft contract.  The source
 * snapshot is provenance owned by the backend and is intentionally opaque to
 * the editor; only `changes` is applied to the form.
 */
export type AdminServiceRecordEditDraftStatus = "ACTIVE" | "DISCARDED" | "CONFIRMED";

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
    shiftFollowing?: boolean;
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

/**
 * Schedule-replacement rejection codes the browser may see in a problem's
 * `scheduleCode` extension. The shared problem sanitizer drops unknown
 * members, so each proxy re-attaches exactly this closed set. The first group
 * is the vector validator's, the second the draft/preview policy's, the last
 * the client-update refusal that sends the admin to the schedule dialog.
 */
export const SERVICE_RECORD_SCHEDULE_CODES = [
    "INVALID_DATE",
    "NON_BUSINESS_DATE",
    "INVALID_SESSION_COUNT",
    "INVALID_SESSION_INDEX",
    "DUPLICATE_SESSION_INDEX",
    "DUPLICATE_SERVICE_DATE",
    "INVERTED_SERVICE_DATES",
    "INCOMPLETE_VECTOR",
    "MISSING_ASSIGNMENT_PROVENANCE",
    "MISSING_PROVENANCE_VERSION",
    "SCHEDULE_COUNT_MISMATCH",
    "SCHEDULE_WITH_DATE_MOVE",
    "UNSUPPORTED_HOLIDAY_YEAR",
    "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
] as const;

export type ServiceRecordScheduleCode = (typeof SERVICE_RECORD_SCHEDULE_CODES)[number];

/** A blocking reason reduced to what the browser needs: a code and the session it concerns. */
export interface ServiceRecordScheduleBlockingReasonRef {
    code: string;
    sessionIndex?: number;
}

const BLOCKING_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_BLOCKING_REASON_REFS = 50;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body's `scheduleCode` when it is one of the known codes; anything else reads as absent. */
export function readServiceRecordScheduleCode(body: unknown): ServiceRecordScheduleCode | null {
    if (!isPlainRecord(body)) return null;
    const { scheduleCode } = body;
    return typeof scheduleCode === "string"
        && (SERVICE_RECORD_SCHEDULE_CODES as readonly string[]).includes(scheduleCode)
        ? scheduleCode as ServiceRecordScheduleCode
        : null;
}

/** The body's `blockingReasons`, each cut down to a well-formed code and an optional session index. */
export function readServiceRecordScheduleBlockingReasons(body: unknown): ServiceRecordScheduleBlockingReasonRef[] {
    if (!isPlainRecord(body) || !Array.isArray(body.blockingReasons)) return [];
    const reasons: ServiceRecordScheduleBlockingReasonRef[] = [];
    for (const entry of body.blockingReasons) {
        if (reasons.length >= MAX_BLOCKING_REASON_REFS) break;
        if (!isPlainRecord(entry) || typeof entry.code !== "string" || !BLOCKING_REASON_CODE_PATTERN.test(entry.code)) continue;
        const { sessionIndex } = entry;
        reasons.push({
            code: entry.code,
            ...(typeof sessionIndex === "number" && Number.isSafeInteger(sessionIndex) && sessionIndex > 0
                ? { sessionIndex }
                : {}),
        });
    }
    return reasons;
}

/**
 * What a Next.js proxy re-attaches to a sanitized 400/409 problem: the
 * validated `scheduleCode` and the reduced `blockingReasons`. `null` when the
 * upstream error carries neither, or is not a 400/409.
 */
export function pickServiceRecordScheduleErrorExtension(error: unknown): {
    scheduleCode?: ServiceRecordScheduleCode;
    blockingReasons?: ServiceRecordScheduleBlockingReasonRef[];
} | null {
    const response = isPlainRecord(error) && isPlainRecord(error.response) ? error.response : null;
    if (!response || (response.status !== 400 && response.status !== 409)) return null;
    const scheduleCode = readServiceRecordScheduleCode(response.data);
    const blockingReasons = readServiceRecordScheduleBlockingReasons(response.data);
    if (!scheduleCode && blockingReasons.length === 0) return null;
    return {
        ...(scheduleCode ? { scheduleCode } : {}),
        ...(blockingReasons.length > 0 ? { blockingReasons } : {}),
    };
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

    /** The known schedule rejection code the server attached, if any. */
    get scheduleCode(): ServiceRecordScheduleCode | null {
        return readServiceRecordScheduleCode(this.body);
    }

    /** Blocking reasons a 409 carried (e.g. a session locked after the preview). */
    get blockingReasons(): ServiceRecordScheduleBlockingReasonRef[] {
        return readServiceRecordScheduleBlockingReasons(this.body);
    }
}
