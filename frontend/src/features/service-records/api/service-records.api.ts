import { api } from "@/lib/api/client";
import {
    normalizeServiceRecordRevisionDocumentSummary,
    normalizeServiceRecordRevisionHistory,
} from "../types";
import type {
    ApplyServiceScheduleChangeRequest,
    ApplyServiceScheduleChangeResponse,
    PrepareServiceRecordLinkRequest,
    PrepareServiceRecordLinkResponse,
    ResetServiceRecordLinkResponse,
    SendServiceRecordLinkRequest,
    SendServiceRecordLinkResponse,
    ServiceScheduleChangePreviewResponse,
    ServiceRecordEditPreviewBlockingReason,
    ServiceRecordOverview,
    ServiceRecordPlannedSession,
    RetryServiceRecordDocumentInput,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryResponse,
    ServiceRecordScheduleProjection,
} from "../types";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PROJECTION_BLOCKED_MESSAGE = "서비스 예정 회차 근거를 확인할 수 없습니다.";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateOnly(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = value.match(DATE_ONLY_PATTERN);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
        && date.getUTCMonth() === Number(match[2]) - 1
        && date.getUTCDate() === Number(match[3]);
}

function positiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function invalidProjection(): ServiceRecordScheduleProjection {
    return {
        entries: [],
        blockingReasons: [{
            code: "INVALID_SCHEDULE_PROJECTION",
            message: PROJECTION_BLOCKED_MESSAGE,
        }],
    };
}

function normalizeProjectionReason(value: unknown): ServiceRecordEditPreviewBlockingReason | null {
    if (!isRecord(value) || !nonEmptyString(value.code) || !nonEmptyString(value.message)) return null;
    const sessionIndex = value.sessionIndex === undefined || value.sessionIndex === null
        ? undefined
        : positiveInteger(value.sessionIndex) ? value.sessionIndex : null;
    if (sessionIndex === null) return null;
    const assignmentId = value.assignmentId === undefined || value.assignmentId === null
        ? undefined
        : nonEmptyString(value.assignmentId) ? value.assignmentId : null;
    if (assignmentId === null) return null;
    return {
        code: value.code,
        message: value.message,
        ...(sessionIndex === undefined ? {} : { sessionIndex }),
        ...(assignmentId === undefined ? {} : { assignmentId }),
    };
}

function normalizeProjectionEntry(value: unknown): ServiceRecordPlannedSession | null {
    if (!isRecord(value)
        || !positiveInteger(value.sessionIndex)
        || !isDateOnly(value.serviceDate)
        || !isDateOnly(value.originalDate)
        || !nonEmptyString(value.assignmentId)
        || !positiveInteger(value.scheduleId)
        || !positiveInteger(value.employeeId)
        || !nonEmptyString(value.provenanceVersion)) {
        return null;
    }
    return {
        sessionIndex: value.sessionIndex,
        serviceDate: value.serviceDate,
        originalDate: value.originalDate,
        assignmentId: value.assignmentId,
        scheduleId: value.scheduleId,
        employeeId: value.employeeId,
        provenanceVersion: value.provenanceVersion,
    };
}

/**
 * Normalize the optional overview projection without allowing malformed
 * authoritative data to fall back to inferred legacy dates. The regular
 * overview remains renderable so persisted records are still visible while a
 * projection blocker is shown to the administrator.
 */
export function normalizeServiceRecordScheduleProjection(
    value: unknown,
): ServiceRecordScheduleProjection | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.blockingReasons)) {
        return invalidProjection();
    }

    const blockingReasons = value.blockingReasons
        .map(normalizeProjectionReason)
        .filter((reason): reason is ServiceRecordEditPreviewBlockingReason => reason !== null);
    if (blockingReasons.length !== value.blockingReasons.length || blockingReasons.length > 0) {
        return {
            entries: [],
            blockingReasons: blockingReasons.length > 0 ? blockingReasons : invalidProjection().blockingReasons,
        };
    }

    const entries = value.entries
        .map(normalizeProjectionEntry)
        .filter((entry): entry is ServiceRecordPlannedSession => entry !== null)
        .sort((left, right) => left.sessionIndex - right.sessionIndex);
    const complete = entries.length === value.entries.length
        && entries.length > 0
        && entries.every((entry, index) => entry.sessionIndex === index + 1);
    return complete ? { entries, blockingReasons: [] } : invalidProjection();
}

export function normalizeServiceRecordOverview(value: unknown): ServiceRecordOverview {
    if (!isRecord(value)) {
        throw new Error("Invalid service-record overview response");
    }
    const hasProjection = Object.prototype.hasOwnProperty.call(value, "scheduleProjection");
    const scheduleProjection = hasProjection
        ? normalizeServiceRecordScheduleProjection(value.scheduleProjection)
        : undefined;
    return {
        ...value,
        ...(hasProjection ? { scheduleProjection } : {}),
    } as ServiceRecordOverview;
}

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<unknown>(`/admin/service-records/client/${clientId}`).then((response) => ({
            ...response,
            data: normalizeServiceRecordOverview(response.data),
        } as typeof response & { data: ServiceRecordOverview })),
    getClientRevisionHistory: (clientId: number) =>
        api.get<unknown>(`/admin/service-records/clients/${encodeURIComponent(String(clientId))}/revisions`)
            .then((response) => ({
                ...response,
                data: normalizeServiceRecordRevisionHistory(response.data),
            } as typeof response & { data: ServiceRecordRevisionHistoryResponse })),
    retryRevisionDocument: ({ revisionId, documentStateId, expectedGeneration }: RetryServiceRecordDocumentInput) =>
        api.post<unknown>(
            `/admin/service-records/revisions/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(documentStateId)}/retry`,
            { expectedGeneration },
        ).then((response) => ({
            ...response,
            data: normalizeServiceRecordRevisionDocumentSummary(response.data),
        } as typeof response & { data: ServiceRecordRevisionDocumentSummary })),
    prepareLink: (scheduleId: number, request: PrepareServiceRecordLinkRequest = {}) =>
        api.post<PrepareServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/prepare-link`,
            request,
        ),
    resetLink: (scheduleId: number) =>
        api.post<ResetServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/reset-link`,
            {},
        ),
    previewScheduleChange: (scheduleId: number) =>
        api.get<ServiceScheduleChangePreviewResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/preview`,
        ),
    applyScheduleChange: (scheduleId: number, request: ApplyServiceScheduleChangeRequest) =>
        api.post<ApplyServiceScheduleChangeResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/apply`,
            request,
        ),
    sendLink: (scheduleId: number, request: SendServiceRecordLinkRequest = {}) =>
        api.post<SendServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            request,
        ),
};
