import type {
  ServiceRecordEditSchedule,
  ServiceRecordOverview,
  ServiceRecordEditServiceDays,
} from "@babyjamjam/shared/types/service-record";

import { api } from "@/lib/api/client";

/**
 * The admin service-record draft API used by the 제공기록지 일정 변경 sheet. Every call goes through
 * the Next.js `/api/admin/service-records` proxy. Responses are read defensively: a missing or
 * malformed member degrades to an empty value, which the sheet treats as "cannot continue".
 */

/** The editor overview: the service-record overview plus the client's service-day toggles. */
export type ServiceRecordScheduleEditorOverview = ServiceRecordOverview & {
  serviceDays?: ServiceRecordEditServiceDays;
};

export interface ScheduleDraft {
  id: string;
  status: "ACTIVE" | "DISCARDED" | "CONFIRMED";
  draftVersion: number;
  sourceCaseVersion: number;
  sourceFingerprint: string;
  /** The server's own `changes` object; only "is it empty" matters here. */
  changes: Record<string, unknown>;
}

export interface ScheduleDraftState {
  draft: ScheduleDraft | null;
  sourceChanged: boolean;
  sourceCaseVersion: number;
  sourceFingerprint: string;
}

export interface ScheduleBlockingReason {
  code: string;
  sessionIndex?: number;
}

export interface SchedulePreview {
  previewId: string;
  draftId: string;
  draftVersion: number;
  blockingReasons: ScheduleBlockingReason[];
}

export interface ScheduleConfirmResult {
  status: string;
  caseVersion: number;
}

export interface ScheduleEditErrorInfo {
  status: number | null;
  /** A validated `scheduleCode` extension of a 400/409 problem. */
  scheduleCode: string | null;
  /** `blockingReasons[]` of a 400/409 problem. */
  blockingReasons: ScheduleBlockingReason[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeBlockingReasons(value: unknown): ScheduleBlockingReason[] {
  if (!Array.isArray(value)) return [];
  const reasons: ScheduleBlockingReason[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.code !== "string" || entry.code.length === 0) continue;
    const sessionIndex = typeof entry.sessionIndex === "number" && Number.isSafeInteger(entry.sessionIndex)
      && entry.sessionIndex > 0 ? entry.sessionIndex : undefined;
    reasons.push(sessionIndex === undefined ? { code: entry.code } : { code: entry.code, sessionIndex });
  }
  return reasons;
}

function normalizeDraft(value: unknown): ScheduleDraft | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  const status = value.status === "DISCARDED" ? "DISCARDED" : value.status === "CONFIRMED" ? "CONFIRMED" : "ACTIVE";
  return {
    id: value.id,
    status,
    draftVersion: asNumber(value.draftVersion),
    sourceCaseVersion: asNumber(value.sourceCaseVersion),
    sourceFingerprint: asString(value.sourceFingerprint),
    changes: isRecord(value.changes) ? value.changes : {},
  };
}

export function normalizeScheduleDraftState(value: unknown): ScheduleDraftState {
  const payload = isRecord(value) ? value : {};
  return {
    draft: normalizeDraft(payload.draft),
    sourceChanged: payload.sourceChanged === true,
    sourceCaseVersion: asNumber(payload.sourceCaseVersion),
    sourceFingerprint: asString(payload.sourceFingerprint),
  };
}

function normalizePreview(value: unknown): SchedulePreview {
  const payload = isRecord(value) ? value : {};
  return {
    previewId: asString(payload.previewId),
    draftId: asString(payload.draftId),
    draftVersion: asNumber(payload.draftVersion),
    blockingReasons: normalizeBlockingReasons(payload.blockingReasons),
  };
}

function normalizeConfirm(value: unknown): ScheduleConfirmResult {
  const payload = isRecord(value) ? value : {};
  return { status: asString(payload.status), caseVersion: asNumber(payload.caseVersion) };
}

function clientPath(clientId: number): string {
  return `/admin/service-records/client/${encodeURIComponent(String(clientId))}`;
}

function draftPath(draftId: string): string {
  return `/admin/service-records/drafts/${encodeURIComponent(draftId)}`;
}

/** Reads what a failed draft call says about itself, from an axios error or a bare `{ response }`. */
export function readScheduleEditError(error: unknown): ScheduleEditErrorInfo {
  const response = isRecord(error) && isRecord(error.response) ? error.response : null;
  const status = response && typeof response.status === "number" ? response.status : null;
  const data = response && isRecord(response.data) ? response.data : null;
  return {
    status,
    scheduleCode: data && typeof data.scheduleCode === "string" ? data.scheduleCode : null,
    blockingReasons: data ? normalizeBlockingReasons(data.blockingReasons) : [],
  };
}

export const adminServiceRecordScheduleApi = {
  async getEditor(clientId: number): Promise<ServiceRecordScheduleEditorOverview> {
    const { data } = await api.get<ServiceRecordScheduleEditorOverview>(`${clientPath(clientId)}/editor`);
    return data;
  },

  async getDraft(clientId: number): Promise<ScheduleDraftState> {
    const { data } = await api.get<unknown>(`${clientPath(clientId)}/draft`);
    return normalizeScheduleDraftState(data);
  },

  async startDraft(clientId: number): Promise<ScheduleDraftState> {
    const { data } = await api.post<unknown>(`${clientPath(clientId)}/draft`, {});
    return normalizeScheduleDraftState(data);
  },

  /** Replaces every session date at once; `changes` stays empty. */
  async updateDraft(
    draftId: string,
    expectedDraftVersion: number,
    changes: Record<string, never>,
    schedule: ServiceRecordEditSchedule,
  ): Promise<ScheduleDraftState> {
    const { data } = await api.patch<unknown>(draftPath(draftId), { expectedDraftVersion, changes, schedule });
    return normalizeScheduleDraftState(data);
  },

  async previewDraft(draftId: string, expectedDraftVersion: number): Promise<SchedulePreview> {
    const { data } = await api.post<unknown>(`${draftPath(draftId)}/preview`, { expectedDraftVersion });
    return normalizePreview(data);
  },

  async confirmDraft(
    draftId: string,
    expectedDraftVersion: number,
    previewId: string,
    idempotencyKey: string,
  ): Promise<ScheduleConfirmResult> {
    const { data } = await api.post<unknown>(`${draftPath(draftId)}/confirm`, {
      expectedDraftVersion,
      previewId,
      idempotencyKey,
    });
    return normalizeConfirm(data);
  },

  async discardDraft(draftId: string, expectedDraftVersion: number): Promise<ScheduleDraftState> {
    const { data } = await api.post<unknown>(`${draftPath(draftId)}/discard`, { expectedDraftVersion });
    return normalizeScheduleDraftState(data);
  },
};

export type AdminServiceRecordScheduleApi = typeof adminServiceRecordScheduleApi;
