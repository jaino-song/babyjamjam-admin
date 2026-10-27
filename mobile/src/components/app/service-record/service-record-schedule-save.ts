import type { ServiceRecordEditSchedule } from "@babyjamjam/shared/types/service-record";

import {
  readScheduleEditError,
  type AdminServiceRecordScheduleApi,
  type ScheduleBlockingReason,
  type ScheduleDraftState,
} from "@/features/service-records/api/admin-service-record-schedule.api";

/**
 * The save sequence of the 제공기록지 일정 변경 sheet, in the same API order as the admin wizard's
 * commit: getDraft -> (discard an active draft) -> startDraft -> updateDraft(schedule) ->
 * previewDraft -> confirmDraft. Nothing here touches React.
 */

export interface ScheduleSourceIdentity {
  sourceFingerprint: string;
  sourceCaseVersion: number;
}

export type ScheduleSaveResult =
  /** The schedule is stored. */
  | { kind: "saved"; caseVersion: number }
  /** The record changed since the sheet opened; nothing was saved and the sheet must reload. */
  | { kind: "source-changed" }
  /** Someone else's draft is in the way; it was left untouched. */
  | { kind: "draft-in-use" }
  /** The server would not start from a clean draft. */
  | { kind: "draft-start-failed" }
  /** The preview or confirm named reasons the schedule cannot be stored. */
  | { kind: "blocked"; reasons: ScheduleBlockingReason[] };

export function sourceIdentityOf(state: ScheduleDraftState): ScheduleSourceIdentity {
  return { sourceFingerprint: state.sourceFingerprint, sourceCaseVersion: state.sourceCaseVersion };
}

export function sameScheduleSource(identity: ScheduleSourceIdentity, state: ScheduleDraftState): boolean {
  return Boolean(identity.sourceFingerprint && state.sourceFingerprint)
    && identity.sourceFingerprint === state.sourceFingerprint
    && identity.sourceCaseVersion === state.sourceCaseVersion;
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface SaveInput {
  api: AdminServiceRecordScheduleApi;
  clientId: number;
  source: ScheduleSourceIdentity;
  schedule: ServiceRecordEditSchedule;
}

async function attemptSave({ api, clientId, source, schedule }: SaveInput): Promise<ScheduleSaveResult> {
  const existing = await api.getDraft(clientId);
  if (!sameScheduleSource(source, existing)) return { kind: "source-changed" };
  // A draft left by an earlier session must not leak into this one.
  if (existing.draft?.status === "ACTIVE") {
    await api.discardDraft(existing.draft.id, existing.draft.draftVersion);
  }

  const started = await api.startDraft(clientId);
  const draft = started.draft;
  if (!draft || draft.status !== "ACTIVE") return { kind: "draft-start-failed" };
  // Only a clean draft of this very source is ours to build on; anything else is left alone.
  if (Object.keys(draft.changes).length > 0) return { kind: "draft-in-use" };
  if (!sameScheduleSource(source, started) || started.sourceChanged
    || draft.sourceFingerprint !== source.sourceFingerprint
    || draft.sourceCaseVersion !== source.sourceCaseVersion) {
    return { kind: "source-changed" };
  }

  let prepared = { id: draft.id, version: draft.draftVersion };
  const discardPrepared = () => api.discardDraft(prepared.id, prepared.version).catch(() => undefined);
  try {
    const updated = await api.updateDraft(prepared.id, prepared.version, {}, schedule);
    if (!updated.draft || updated.draft.status !== "ACTIVE") {
      await discardPrepared();
      return { kind: "draft-start-failed" };
    }
    prepared = { id: updated.draft.id, version: updated.draft.draftVersion };

    const preview = await api.previewDraft(prepared.id, prepared.version);
    if (preview.draftId !== prepared.id || preview.draftVersion !== prepared.version) {
      await discardPrepared();
      return { kind: "source-changed" };
    }
    if (preview.blockingReasons.length > 0) {
      await discardPrepared();
      return { kind: "blocked", reasons: preview.blockingReasons };
    }

    const confirmed = await api.confirmDraft(prepared.id, prepared.version, preview.previewId, createIdempotencyKey());
    return { kind: "saved", caseVersion: confirmed.caseVersion };
  } catch (error) {
    const info = readScheduleEditError(error);
    // A confirm refused with reasons (a session locked after the preview) is an answer, not a failure.
    if (info.status === 409 && info.blockingReasons.length > 0) {
      await discardPrepared();
      return { kind: "blocked", reasons: info.blockingReasons };
    }
    await discardPrepared();
    throw error;
  }
}

/**
 * Runs the save. Only a version conflict is retried, once, from the top, where the source check
 * runs again: a record that changed in the meantime reloads instead. A 409 that names blocking
 * reasons, a still-running earlier edit (`blockingOperation`) or a schedule code is an answer about
 * the request itself, so repeating it cannot help and it is surfaced as it is.
 */
export async function saveServiceRecordSchedule(input: SaveInput): Promise<ScheduleSaveResult> {
  try {
    return await attemptSave(input);
  } catch (error) {
    const info = readScheduleEditError(error);
    if (
      info.status === 409
      && info.blockingReasons.length === 0
      && !info.blockingOperation
      && info.scheduleCode === null
    ) {
      return attemptSave(input);
    }
    throw error;
  }
}
