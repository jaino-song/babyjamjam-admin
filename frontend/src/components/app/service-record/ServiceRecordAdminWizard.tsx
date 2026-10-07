/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
    DAY_PAGES,
    ServiceRecordWizard,
    formatShortDate,
    getServiceRecordHeaderErrors,
    hasInvalidServiceRecordNumericAnswers,
    hasServiceRecordHeaderValues,
} from "@babyjamjam/service-record-ui";
import type {
    ServiceRecordContext,
    ServiceRecordHeaderErrors,
    SignatureSlotProps,
} from "@babyjamjam/service-record-ui";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { CalendarLoadNotice } from "@/components/app/holidays/CalendarLoadNotice";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import {
    adminServiceRecordEditApi,
} from "@/features/service-records/api/admin-service-record-edit.api";
import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditChanges,
    type AdminServiceRecordEditDateMove,
    type AdminServiceRecordEditHeaderChanges,
    type ServiceRecordEditPreviewResponse,
    type AdminServiceRecordEditSessionChanges,
    type AdminServiceRecordEditState,
    type ServiceRecordEditPreviewBlockingReason,
    type ServiceRecordPlannedSession,
} from "@/features/service-records/types";
import { subscribeServiceRecordCaseChanges } from "@/features/service-records/case-events";
import { useUnsavedChangesGuard } from "@/features/service-records/hooks/use-unsaved-changes-guard";
import {
    publishServiceRecordRevisionSync,
    subscribeServiceRecordRevisionSync,
    type ServiceRecordRevisionSyncEvent,
} from "@/features/service-records/revision-sync";

import { ServiceRecordEditPreviewDialog } from "./ServiceRecordEditPreviewDialog";
import { ServiceRecordDateSelectionDialog } from "./ServiceRecordDateSelectionDialog";
import { moveServiceRecordSessionDate } from "@babyjamjam/shared/utils/service-record-schedule";

import type {
    ServiceRecordAssignment,
    ServiceRecordCase,
    ServiceRecordHeader,
    ServiceRecordOverview,
    ServiceRecordSession,
} from "@/features/service-records/types";

type EditorSession = ServiceRecordSession & {
    clientSignature?: string | null;
    clientSignedAt?: string | null;
};

type EditorCase = Omit<ServiceRecordCase, "sessions"> & {
    sessions: EditorSession[];
};

type EditorAssignment = Omit<ServiceRecordAssignment, "sessions"> & {
    sessions: EditorSession[];
};

export type AdminServiceRecordEditorOverview = Omit<ServiceRecordOverview, "record" | "assignments"> & {
    record?: EditorCase | null;
    assignments: EditorAssignment[];
};

const ADMIN_WIZARD_COMPONENT = "desktop_service-record-admin_wizard";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDateString(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    return "";
}

function normalizeSession(session: EditorSession): EditorSession {
    return {
        ...session,
        serviceDate: asDateString(session.serviceDate),
        submittedAt: session.submittedAt ? asDateString(session.submittedAt) : null,
        updatedAt: asDateString(session.updatedAt),
        clientSignedAt: session.clientSignedAt ? asDateString(session.clientSignedAt) : null,
        answers: isRecord(session.answers) ? session.answers : {},
    };
}

function normalizeHeader(header: ServiceRecordHeader | null | undefined): Record<string, unknown> | null {
    if (!header) return null;
    return {
        momName: header.momName,
        momBirth: header.momBirth,
        babyName: header.babyName,
        babyBirth: header.babyBirth,
        deliveryType: header.deliveryType,
        babyWeight: header.babyWeight,
    };
}

function headerToInput(header: Record<string, unknown> | null): Record<string, string> {
    if (!header) return { deliveryType: "자연분만" };
    return Object.fromEntries(
        Object.entries(header).map(([key, value]) => [key, value == null ? "" : String(value)]),
    );
}

/**
 * The shared validator reads a plain `Record<string, unknown>`; an interface
 * patch type carries no index signature, so map every editable key explicitly
 * instead of casting. Changed fields stay validated, omitted fields stay
 * omitted (absent keys read as `undefined`, which the validator treats as
 * "not supplied").
 */
function headerChangesToValidationRecord(changes: AdminServiceRecordEditHeaderChanges): Record<string, unknown> {
    return {
        momName: changes.momName,
        momBirth: changes.momBirth,
        babyName: changes.babyName,
        babyBirth: changes.babyBirth,
        deliveryType: changes.deliveryType,
        babyWeight: changes.babyWeight,
    };
}

export interface AdminServiceRecordSessionVariant {
    key: string;
    sourceLabel: string;
    sessionIndex: number;
    session: EditorSession;
}

export interface AdminServiceRecordView {
    context: ServiceRecordContext;
    supplementalSessions: AdminServiceRecordSessionVariant[];
    plannedSessions: ServiceRecordPlannedSession[];
    scheduleProjectionBlockingReasons: ServiceRecordEditPreviewBlockingReason[];
}

function sessionFingerprint(session: EditorSession): string {
    const answers = isRecord(session.answers)
        ? Object.fromEntries(Object.entries(session.answers).sort(([left], [right]) => left.localeCompare(right)))
        : {};
    return JSON.stringify({
        sessionIndex: session.sessionIndex,
        serviceDate: session.serviceDate,
        locked: session.locked,
        submittedAt: session.submittedAt,
        answers,
        etcService: session.etcService,
        notes: session.notes,
        paymentConfirmed: session.paymentConfirmed,
        hasMomApproval: session.hasMomApproval,
        clientSignature: session.clientSignature,
        clientSignedAt: session.clientSignedAt,
        employeeId: session.employeeId,
        employeeName: session.employeeName,
    });
}

function dateOnly(value: unknown): string {
    const normalized = asDateString(value);
    return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function isOutsidePeriod(serviceDate: string, startDate: unknown, endDate: unknown): boolean {
    const date = dateOnly(serviceDate);
    if (!date) return false;
    const start = dateOnly(startDate);
    const end = dateOnly(endDate);
    return Boolean((start && date < start) || (end && date > end));
}

/**
 * Case rows are the canonical aggregate. Assignment rows fill gaps for old
 * records, and distinct or out-of-period projections are retained as
 * selectable supplemental rows instead of being silently dropped.
 */
export function buildAdminServiceRecordView(
    overview: AdminServiceRecordEditorOverview,
): AdminServiceRecordView {
    const record = overview.record ?? null;
    const assignments = overview.assignments ?? [];
    const scheduleProjection = overview.scheduleProjection;
    const projectionEntries = scheduleProjection?.entries ?? [];
    const projectionHasBlockingReasons = (scheduleProjection?.blockingReasons.length ?? 0) > 0;
    const projectionIndexes = new Set(projectionEntries.map((entry) => entry.sessionIndex));
    const projectionIsComplete = projectionEntries.length > 0
        && !projectionHasBlockingReasons
        && projectionEntries.every((entry, index) => entry.sessionIndex === index + 1)
        && projectionIndexes.size === projectionEntries.length;
    const recordTotalSessions = typeof record?.totalSessions === "number" ? Math.max(record.totalSessions, 0) : null;
    const assignmentTotalSessions = Math.max(
        ...assignments.map((assignment) => assignment.totalSessions ?? 0),
        0,
    );
    const observedSessionMax = Math.max(
        ...[
            ...(record?.sessions ?? []),
            ...assignments.flatMap((assignment) => assignment.sessions ?? []),
        ].map((session) => session.sessionIndex),
        0,
    );
    const totalSessions = projectionIsComplete
        ? projectionEntries.length
        : recordTotalSessions
            ?? (scheduleProjection
                ? 0
                : assignmentTotalSessions > 0 ? assignmentTotalSessions : observedSessionMax);
    const sessionByIndex = new Map<number, EditorSession>();
    const canonicalSourceKindByIndex = new Map<number, "case" | "assignment">();
    const fingerprintsByIndex = new Map<number, Set<string>>();
    const fingerprintsBySource = new Map<string, Set<string>>();
    const caseDuplicateFingerprintsConsumed = new Set<string>();
    const supplementalSessions: AdminServiceRecordSessionVariant[] = [];

    const appendSession = (
        session: EditorSession,
        sourceLabel: string,
        sourceKey: string,
        sourceKind: "case" | "assignment",
        periodStart: unknown,
        periodEnd: unknown,
    ) => {
        const normalized = normalizeSession(session);
        const fingerprint = sessionFingerprint(normalized);
        const outsideRange = normalized.sessionIndex < 1 || normalized.sessionIndex > totalSessions;
        const outsidePeriod = isOutsidePeriod(normalized.serviceDate, periodStart, periodEnd);
        if (outsideRange || outsidePeriod) {
            supplementalSessions.push({
                key: `${sourceKey}-${normalized.sessionIndex}-${supplementalSessions.length + 1}`,
                sourceLabel: `${sourceLabel} · 기간 밖 보관회차`,
                sessionIndex: normalized.sessionIndex,
                session: normalized,
            });
            return;
        }

        const fingerprints = fingerprintsByIndex.get(normalized.sessionIndex) ?? new Set<string>();
        const sourceFingerprints = fingerprintsBySource.get(sourceKey) ?? new Set<string>();
        if (sourceFingerprints.has(fingerprint)) return;
        if (!sessionByIndex.has(normalized.sessionIndex)) {
            sessionByIndex.set(normalized.sessionIndex, normalized);
            canonicalSourceKindByIndex.set(normalized.sessionIndex, sourceKind);
        } else if (
            sourceKind === "assignment"
            && canonicalSourceKindByIndex.get(normalized.sessionIndex) === "case"
            && fingerprints.has(fingerprint)
            && !caseDuplicateFingerprintsConsumed.has(`${normalized.sessionIndex}:${fingerprint}`)
            && sourceKey.startsWith("assignment-")
        ) {
            // The case aggregate normally mirrors the first assignment row.
            // Consume one such projection, then retain additional assignment
            // provenance even when its values happen to be identical.
            const canonicalSourceKey = `${normalized.sessionIndex}:${fingerprint}`;
            caseDuplicateFingerprintsConsumed.add(canonicalSourceKey);
            sourceFingerprints.add(fingerprint);
            fingerprintsBySource.set(sourceKey, sourceFingerprints);
            return;
        } else {
            supplementalSessions.push({
                key: `${sourceKey}-${normalized.sessionIndex}-${supplementalSessions.length + 1}`,
                sourceLabel,
                sessionIndex: normalized.sessionIndex,
                session: normalized,
            });
        }
        fingerprints.add(fingerprint);
        fingerprintsByIndex.set(normalized.sessionIndex, fingerprints);
        sourceFingerprints.add(fingerprint);
        fingerprintsBySource.set(sourceKey, sourceFingerprints);
    };

    for (const [sessionOrdinal, session] of (record?.sessions ?? []).entries()) {
        appendSession(
            session,
            "통합 기록",
            `case-${sessionOrdinal}`,
            "case",
            record?.startDate,
            record?.endDate,
        );
    }
    for (const assignment of assignments) {
        for (const [sessionOrdinal, session] of (assignment.sessions ?? []).entries()) {
            appendSession(
                session,
                `배정 #${assignment.scheduleId}`,
                `assignment-${assignment.scheduleId}-${sessionOrdinal}`,
                "assignment",
                record?.startDate ?? assignment.startDate,
                record?.endDate ?? assignment.endDate,
            );
        }
    }

    const sessions = [...sessionByIndex.values()].sort((left, right) => left.sessionIndex - right.sessionIndex);
    const firstAssignment = assignments[0];
    const header = normalizeHeader(
        record?.header ?? assignments.find((assignment) => assignment.header)?.header ?? null,
    );
    const sessionEmployee = sessions.find((session) => session.employeeId != null && session.employeeName);
    const firstEmployee = firstAssignment?.employee
        ?? (sessionEmployee?.employeeId != null && sessionEmployee.employeeName
            ? { id: sessionEmployee.employeeId, name: sessionEmployee.employeeName }
            : undefined);
    return {
        context: {
            org: undefined,
            employee: firstEmployee,
            client: undefined,
            totalSessions,
            startDate: asDateString(record?.startDate ?? firstAssignment?.startDate ?? null) || null,
            header,
            sessions,
            recordStatus: record?.status ?? null,
            pendingScheduleChange: null,
        },
        supplementalSessions,
        plannedSessions: projectionIsComplete ? [...projectionEntries].sort((left, right) => left.sessionIndex - right.sessionIndex) : [],
        scheduleProjectionBlockingReasons: scheduleProjection?.blockingReasons ?? [],
    };
}

export function buildAdminServiceRecordContext(
    overview: AdminServiceRecordEditorOverview,
): ServiceRecordContext {
    return buildAdminServiceRecordView(overview).context;
}

function draftForSession(session: {
    serviceDate: string;
    answers?: Record<string, unknown>;
    etcService?: string | null;
    notes?: string | null;
    paymentConfirmed?: boolean;
} | undefined): Record<string, unknown> {
    if (!session) return {};
    return {
        _date: session.serviceDate ? session.serviceDate.slice(0, 10) : "",
        ...(isRecord(session.answers) ? session.answers : {}),
        etcService: session.etcService ?? "",
        notes: session.notes ?? "",
        paymentConfirmed: Boolean(session.paymentConfirmed),
    };
}

function dateYears(values: ReadonlyArray<unknown>): number[] {
    const years = new Set<number>();
    for (const value of values) {
        const match = /^(\d{4})-\d{2}-\d{2}/.exec(asDateString(value));
        if (match) years.add(Number(match[1]));
    }
    return [...years];
}

function ReadOnlySignature({
    "data-component": dataComponent,
    value,
    signedAt,
}: SignatureSlotProps) {
    // One message in the label row: when it was signed, else what the field holds.
    const message = signedAt
        ? `${formatShortDate(signedAt)} 서명`
        : value ? "서명 원본이에요" : "저장된 서명이 없어요";
    return (
        <div data-component={dataComponent} data-slot="signature" className="sign-fld locked">
            <div data-component={`${dataComponent}_label-row`} data-slot="lab-row" className="lab-row">
                <span data-slot="lab" className="lab">산모 서명</span>
                <span
                    id={`${dataComponent}_message`}
                    data-component={`${dataComponent}_helper`}
                    data-slot="lab-msg"
                    className="lab-msg hint"
                    aria-live="polite"
                    title={message}
                >
                    {message}
                </span>
            </div>
            <div data-slot="signature-image-wrap" className="padwrap locked">
                {value ? (
                    <img
                        data-slot="signature-image"
                        className="admin-signature-image"
                        src={value}
                        alt="산모 서명"
                        aria-describedby={`${dataComponent}_message`}
                    />
                ) : (
                    <canvas data-slot="signature-empty" className="pad" aria-hidden="true" />
                )}
            </div>
        </div>
    );
}

function draftErrorMessage(status: number): string {
    if (status === 401) return "로그인이 필요합니다. 초안 입력은 유지됩니다.";
    if (status === 403) return "초안 접근 권한이 없습니다. 현재 입력은 유지됩니다.";
    if (status === 404) return "초안을 찾을 수 없습니다. 현재 입력은 유지됩니다.";
    if (status === 409) return "다른 관리자의 변경으로 저장되지 않았습니다. 입력은 유지되었습니다. 최신 초안을 불러오거나 내 입력을 유지하세요.";
    return "초안을 저장하지 못했습니다. 입력은 유지됩니다.";
}

type PlannedVector = ReturnType<typeof moveServiceRecordSessionDate>["entries"];

/** Confirmed (수정 확인) edits that live in this tab until 수정 확정 saves them all. */
interface PendingEdits {
    /** Content patches, one merged entry per session. */
    sessions: AdminServiceRecordEditSessionChanges[];
    header: AdminServiceRecordEditHeaderChanges;
    /** Date moves in the order they were made; the server applies each on top of the last. */
    moves: AdminServiceRecordEditDateMove[];
    /** Session dates after every move, as the editor calculated them. */
    vector: PlannedVector | null;
}

const EMPTY_PENDING: PendingEdits = { sessions: [], header: {}, moves: [], vector: null };

function mergeSessionPatch(
    sessions: AdminServiceRecordEditSessionChanges[],
    patch: AdminServiceRecordEditSessionChanges,
): AdminServiceRecordEditSessionChanges[] {
    const existing = sessions.find((session) => session.sessionIndex === patch.sessionIndex);
    const merged: AdminServiceRecordEditSessionChanges = { ...existing, ...patch };
    if (existing?.answers || patch.answers) merged.answers = { ...existing?.answers, ...patch.answers };
    return [...sessions.filter((session) => session.sessionIndex !== patch.sessionIndex), merged]
        .sort((left, right) => left.sessionIndex - right.sessionIndex);
}

/** What the screens show: content patches plus the moved dates. */
function pendingToOverlay(pending: PendingEdits, baseVector: PlannedVector): AdminServiceRecordEditChanges {
    const sessions = new Map(pending.sessions.map((session) => [session.sessionIndex, session]));
    for (const entry of pending.vector ?? []) {
        const base = baseVector.find((item) => item.sessionIndex === entry.sessionIndex);
        if (!base || dateOnly(base.serviceDate) === dateOnly(entry.serviceDate)) continue;
        sessions.set(entry.sessionIndex, {
            ...sessions.get(entry.sessionIndex),
            sessionIndex: entry.sessionIndex,
            serviceDate: entry.serviceDate,
        });
    }
    return { header: pending.header, sessions: [...sessions.values()] };
}

/** What `startDraft` receives; date moves go through `updateDraft` one by one. */
function pendingToChanges(pending: PendingEdits): AdminServiceRecordEditChanges | undefined {
    const changes: AdminServiceRecordEditChanges = {};
    if (Object.keys(pending.header).length > 0) changes.header = pending.header;
    if (pending.sessions.length > 0) changes.sessions = pending.sessions;
    return changes.header || changes.sessions ? changes : undefined;
}

type BlockingOperationName = "contract_period" | "receipt_refresh" | "record_snapshot";

/** A 409 that says an earlier edit's follow-up work is still running (not a stale record). */
function readBlockingOperation(body: unknown): BlockingOperationName | null {
    if (!isRecord(body) || !isRecord(body.blockingOperation)) return null;
    const { operation } = body.blockingOperation;
    return operation === "contract_period" || operation === "receipt_refresh" || operation === "record_snapshot"
        ? operation : null;
}

function blockingOperationMessage(operation: BlockingOperationName): string {
    if (operation === "contract_period") return "이전 수정의 계약서 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요.";
    if (operation === "receipt_refresh") return "이전 수정의 영수증 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요.";
    return "이전 수정의 기록 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요.";
}

function createIdempotencyKey(): string {
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

function sameSource(left: AdminServiceRecordEditState | null, right: AdminServiceRecordEditState | null): boolean {
    return Boolean(left?.sourceFingerprint && right?.sourceFingerprint
        && left.sourceFingerprint === right.sourceFingerprint
        && left.sourceCaseVersion === right.sourceCaseVersion);
}

function overlayChanges(view: AdminServiceRecordView, changes: AdminServiceRecordEditChanges | null): ServiceRecordContext {
    if (!changes) return view.context;
    const sessions = new Map(view.context.sessions.map((session) => [session.sessionIndex, session]));
    for (const patch of changes.sessions ?? []) {
        const source = sessions.get(patch.sessionIndex) ?? {
            sessionIndex: patch.sessionIndex, locked: false,
            serviceDate: view.plannedSessions.find((entry) => entry.sessionIndex === patch.sessionIndex)?.serviceDate ?? "",
        };
        sessions.set(patch.sessionIndex, { ...source, ...patch, answers: { ...source.answers, ...patch.answers } });
    }
    return { ...view.context, header: { ...view.context.header, ...changes.header },
        sessions: [...sessions.values()].sort((left, right) => left.sessionIndex - right.sessionIndex) };
}

export interface ServiceRecordAdminWizardProps {
    clientId: string;
    overview: AdminServiceRecordEditorOverview;
    /**
     * Only the source identity (`sourceFingerprint` / `sourceCaseVersion`) is
     * used. An ACTIVE draft left by a closed session is ignored.
     */
    initialDraftState?: AdminServiceRecordEditState | null;
    initialDraftErrorStatus?: number | null;
}

export function ServiceRecordAdminWizard({
    clientId,
    overview: initialOverview,
    initialDraftState = null,
    initialDraftErrorStatus = null,
}: ServiceRecordAdminWizardProps) {
    const [overview, setOverview] = useState(initialOverview);
    const baseView = useMemo(() => buildAdminServiceRecordView(overview), [overview]);
    // Date moves are sent to the server, so they wait for the branch calendar.
    // Load every year the record already holds so older records compute too.
    const calendarYears = useMemo(() => dateYears([
        ...baseView.plannedSessions.flatMap((entry) => [entry.serviceDate, entry.originalDate]),
        ...baseView.context.sessions.map((session) => session.serviceDate),
    ]), [baseView]);
    const {
        calendar,
        ready: calendarReady,
        error: calendarError,
        retry: retryCalendar,
        refreshForSave,
    } = useBusinessDayCalendar({ extraYears: calendarYears });
    const [sourceIdentity, setSourceIdentity] = useState(initialDraftState);
    // Nothing is saved until 수정 확정: confirmed edits wait here, in this tab only.
    const [pending, setPending] = useState<PendingEdits>(EMPTY_PENDING);
    const hasPending = pending.sessions.length > 0 || Object.keys(pending.header).length > 0 || pending.moves.length > 0;
    const baseVector = baseView.plannedSessions.map((entry) => ({
        ...entry,
        serviceDate: dateOnly(baseView.context.sessions.find((item) => item.sessionIndex === entry.sessionIndex)?.serviceDate) || entry.serviceDate,
    }));
    const vector: PlannedVector = pending.vector ?? baseVector;
    const pendingChanges = hasPending ? pendingToOverlay(pending, baseVector) : null;
    const displayContext = overlayChanges(baseView, pendingChanges);
    const changedSessionIndexes = new Set((pendingChanges?.sessions ?? []).map((session) => session.sessionIndex));
    const [headerDraft, setHeaderDraft] = useState<Record<string, string>>(headerToInput(displayContext.header));
    const [preview, setPreview] = useState<ServiceRecordEditPreviewResponse | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [screen, setScreen] = useState<"overview" | "day" | "service">("overview");
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(DAY_PAGES.length - 1);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [supplementalKey, setSupplementalKey] = useState<string | null>(null);
    const [dateMove, setDateMove] = useState<AdminServiceRecordEditDateMove | null>(null);
    const dateMoveEntriesRef = useRef<PlannedVector | null>(null);
    const [followPrompt, setFollowPrompt] = useState<{ date: string; delta: number; canKeep: boolean; canShift: boolean } | null>(null);
    const [dateDialogOpen, setDateDialogOpen] = useState(false);
    const [discardModalOpen, setDiscardModalOpen] = useState(false);
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [refreshModalOpen, setRefreshModalOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(initialDraftErrorStatus ? draftErrorMessage(initialDraftErrorStatus) : null);
    const [dateError, setDateError] = useState<string | null>(null);
    const [needsReload, setNeedsReload] = useState(!initialDraftState?.sourceFingerprint);
    const saving = useRef(false);
    // The draft prepared for the preview that is (or was) on screen; a retry reuses it as-is.
    const commitRequest = useRef<{ draftId: string; draftVersion: number; previewId: string; idempotencyKey: string } | null>(null);
    // Highest case version this tab has loaded or written itself.
    const knownVersion = useRef(initialDraftState?.sourceCaseVersion ?? 0);
    const caseId = useRef<string | null>(overview.record?.id ?? null);
    const confirmInFlight = useRef(false);
    const bufferedEvents = useRef<ServiceRecordRevisionSyncEvent[]>([]);
    const supplemental = baseView.supplementalSessions.find((item) => item.key === supplementalKey);
    const currentSession = supplemental?.session ?? displayContext.sessions.find((item) => item.sessionIndex === day);
    const sourceDraft = draftForSession(currentSession);
    const sourceDate = dateOnly(currentSession?.serviceDate)
        || baseView.plannedSessions.find((item) => item.sessionIndex === day)?.serviceDate || "";
    const patch: AdminServiceRecordEditSessionChanges = { sessionIndex: day };
    for (const [key, value] of Object.entries(draft)) {
        if (key === "_date" || JSON.stringify(value) === JSON.stringify(sourceDraft[key])) continue;
        if (key === "etcService" || key === "notes") patch[key] = String(value ?? "");
        else if (key === "paymentConfirmed") patch.paymentConfirmed = Boolean(value);
        else patch.answers = { ...patch.answers, [key]: value };
    }
    const headerPatch: AdminServiceRecordEditHeaderChanges = {};
    for (const key of ["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"] as const) {
        if ((headerDraft[key] ?? "") !== (headerToInput(displayContext.header)[key] ?? "")) headerPatch[key] = headerDraft[key] ?? "";
    }
    const editingHeader = screen === "service";
    // Validate every changed field without rewriting or rejecting untouched historic values.
    const headerErrors: ServiceRecordHeaderErrors = getServiceRecordHeaderErrors(headerChangesToValidationRecord(headerPatch));
    const hasHeaderErrors = Object.keys(headerErrors).length > 0;
    const hasInvalidNumericAnswers = hasInvalidServiceRecordNumericAnswers(draft);
    const changed = !supplemental && (editingHeader
        ? Object.keys(headerPatch).length > 0 : Object.keys(patch).length > 1 || Boolean(dateMove));
    const locked = busy || needsReload || Boolean(supplemental);
    const resetLocal = () => {
        setScreen("overview");
        setDateMove(null);
        setFollowPrompt(null);
        setError(null);
        setDateError(null);
        setDraft({});
        setSupplementalKey(null);
    };
    const openDay = (index: number) => {
        if (busy) return;
        setDay(index);
        setPageIdx(DAY_PAGES.length - 1);
        setDraft(draftForSession(displayContext.sessions.find((item) => item.sessionIndex === index)));
        setSupplementalKey(null);
        setDateMove(null);
        setError(null);
        setScreen("day");
    };
    const refresh = async () => {
        const before = await adminServiceRecordEditApi.getDraft(clientId);
        const response = await fetch(`/api/admin/service-records/client/${encodeURIComponent(clientId)}/editor`, { cache: "no-store" });
        if (!response.ok) throw new Error("reload");
        const fresh = parseOverview(await response.json());
        if (!fresh) throw new Error("reload");
        const state = await adminServiceRecordEditApi.getDraft(clientId);
        if (!sameSource(before, state)) throw new Error("기록이 조회 중 변경되었습니다. 다시 불러와 주세요.");
        setOverview(fresh);
        setSourceIdentity(state);
        knownVersion.current = Math.max(knownVersion.current, state.sourceCaseVersion);
        setPreview(null);
        setPreviewOpen(false);
        setNeedsReload(false);
        setPending(EMPTY_PENDING);
        commitRequest.current = null;
        resetLocal();
    };
    useEffect(() => { caseId.current = overview.record?.id ?? null; }, [overview]);
    const reload = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try { await refresh(); }
        catch { setError("최신 기록을 불러오지 못했습니다. 다시 불러와 주세요."); }
        finally { saving.current = false; setBusy(false); }
    };
    const applyDate = (next: string, shiftFollowing: boolean) => {
        if (!calendarReady) return null;
        try {
            const result = moveServiceRecordSessionDate(vector, day, next, shiftFollowing, calendar);
            dateMoveEntriesRef.current = result.entries;
            setDateMove(next === sourceDate ? null : { sessionIndex: day, toDate: next, shiftFollowing });
            setDraft((current) => ({ ...current, _date: next }));
            setFollowPrompt(null);
            setDateDialogOpen(false);
            setDateError(null);
            return result;
        } catch {
            setDateError("앞 회차보다 늦은 영업일을 선택해 주세요. 회차 순서와 예정일을 확인해 주세요.");
            setFollowPrompt(null);
            return null;
        }
    };
    const selectDate = (next: string) => {
        if (locked || !calendarReady || baseView.scheduleProjectionBlockingReasons.length) return;
        const nextSession = vector.find((item) => item.sessionIndex === day + 1);
        const currentDate = vector.find((item) => item.sessionIndex === day)?.serviceDate;
        if (!nextSession || next === currentDate) { applyDate(next, false); return; }
        // Probe each option on its own: a suffix shift can fail (e.g. into an unloaded calendar year)
        // while keeping later sessions is still valid, and vice versa.
        const probe = (shiftFollowing: boolean) => {
            try { return moveServiceRecordSessionDate(vector, day, next, shiftFollowing, calendar); } catch { return null; }
        };
        const shifted = probe(true);
        const kept = next < nextSession.serviceDate ? probe(false) : null;
        const result = shifted ?? kept;
        if (!result) { setDateError("회차 순서와 제공일을 확인해 주세요."); return; }
        setFollowPrompt({ date: next, delta: Math.abs(result.deltaBusinessDays), canKeep: Boolean(kept), canShift: Boolean(shifted) });
        setDateDialogOpen(false);
    };
    /** 수정 확인: keep this session / basic-information edit in the browser only. */
    const accept = async () => {
        if (saving.current || supplemental) return;
        if (!changed) { resetLocal(); return; }
        if (needsReload) return;
        if (dateMove && !calendarReady) return;
        if (!editingHeader && hasInvalidNumericAnswers) {
            setError("숫자 입력값을 확인해 주세요.");
            return;
        }
        if (editingHeader) {
            if (!hasServiceRecordHeaderValues(headerDraft)) {
                setError("필수 기본정보를 모두 입력해 주세요.");
                return;
            }
            if (hasHeaderErrors) {
                setError("기본정보 입력값을 확인해 주세요.");
                return;
            }
        }
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            let movedEntries: PlannedVector | null = null;
            if (dateMove) {
                const fresh = await refreshForSave();
                if (!fresh.ok) {
                    setError("공휴일 정보를 불러오지 못했어요.");
                    return;
                }
                try {
                    const next = moveServiceRecordSessionDate(vector, day, dateMove.toDate, Boolean(dateMove.shiftFollowing), fresh.calendar).entries;
                    const previous = dateMoveEntriesRef.current;
                    const recalculated = !previous || next.some((entry) =>
                        previous.find((item) => item.sessionIndex === entry.sessionIndex)?.serviceDate !== entry.serviceDate);
                    dateMoveEntriesRef.current = next;
                    if (fresh.changed || recalculated) {
                        setError("공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 수정 확인을 다시 눌러 주세요.");
                        return;
                    }
                    movedEntries = next;
                } catch {
                    setError("앞 회차보다 늦은 영업일을 선택해 주세요. 회차 순서와 예정일을 확인해 주세요.");
                    return;
                }
            }
            setPending((current) => ({
                sessions: !editingHeader && Object.keys(patch).length > 1 ? mergeSessionPatch(current.sessions, patch) : current.sessions,
                header: editingHeader ? { ...current.header, ...headerPatch } : current.header,
                moves: dateMove ? [...current.moves, dateMove] : current.moves,
                vector: movedEntries ?? current.vector,
            }));
            resetLocal();
        } finally { saving.current = false; setBusy(false); }
    };
    const showRefreshModal = () => {
        setPreviewOpen(false);
        setRefreshModalOpen(true);
    };
    const handleFailure = (failure: unknown) => {
        if (failure instanceof AdminServiceRecordEditApiError) {
            if (failure.status === 409) {
                const blocking = readBlockingOperation(failure.body);
                if (blocking) setError(blockingOperationMessage(blocking));
                else showRefreshModal();
                return;
            }
            setError(failure.status === 403 ? "수정 권한이 없습니다. 수정사항은 이 화면에 남아 있어요."
                : failure.status === 401 ? "로그인이 필요합니다. 수정사항은 이 화면에 남아 있어요."
                : "저장 결과를 확인하지 못했습니다. 수정사항은 이 화면에 남아 있어요.");
            return;
        }
        setError(failure instanceof Error && /[가-힣]/.test(failure.message) ? failure.message
            : "저장 결과를 확인하지 못했습니다. 수정사항은 이 화면에 남아 있어요.");
    };
    /** 수정 확정, step 1: turn every pending edit into one server draft and open its preview. */
    const startCommit = async () => {
        if (saving.current || !hasPending || needsReload || refreshModalOpen) return;
        saving.current = true;
        setBusy(true);
        setError(null);
        commitRequest.current = null;
        let prepared: { id: string; version: number } | null = null;
        try {
            const existing = await adminServiceRecordEditApi.getDraft(clientId);
            if (!sameSource(sourceIdentity, existing)) { showRefreshModal(); return; }
            // A draft left by an earlier session must not leak into this one.
            if (existing.draft?.status === "ACTIVE") {
                await adminServiceRecordEditApi.discardDraft(existing.draft.id, existing.draft.draftVersion);
            }
            const changes = pendingToChanges(pending);
            let state = await adminServiceRecordEditApi.startDraft(clientId, changes);
            if (!state.draft || state.draft.status !== "ACTIVE") throw new Error("수정을 시작하지 못했습니다.");
            prepared = { id: state.draft.id, version: state.draft.draftVersion };
            if (!sameSource(sourceIdentity, state) || state.sourceChanged
                || state.draft.sourceFingerprint !== sourceIdentity?.sourceFingerprint
                || state.draft.sourceCaseVersion !== sourceIdentity?.sourceCaseVersion) {
                await adminServiceRecordEditApi.discardDraft(prepared.id, prepared.version).catch(() => undefined);
                showRefreshModal();
                return;
            }
            for (const move of pending.moves) {
                state = await adminServiceRecordEditApi.updateDraft(state.draft.id, state.draft.draftVersion, {}, move);
                if (!state.draft || state.draft.status !== "ACTIVE") throw new Error("수정 내용을 저장하지 못했습니다.");
                prepared = { id: state.draft.id, version: state.draft.draftVersion };
            }
            const result = await adminServiceRecordEditApi.previewDraft(prepared.id, prepared.version);
            if (result.draftId !== prepared.id || result.draftVersion !== prepared.version) {
                await adminServiceRecordEditApi.discardDraft(prepared.id, prepared.version).catch(() => undefined);
                showRefreshModal();
                return;
            }
            commitRequest.current = { draftId: prepared.id, draftVersion: prepared.version, previewId: result.previewId, idempotencyKey: createIdempotencyKey() };
            setPreview(result);
            setPreviewOpen(true);
        } catch (failure) {
            if (prepared) await adminServiceRecordEditApi.discardDraft(prepared.id, prepared.version).catch(() => undefined);
            handleFailure(failure);
        } finally { saving.current = false; setBusy(false); }
    };
    /** Open the blocking refresh modal for a case event that is newer than this tab's data. */
    const applyCaseEvent = (event: ServiceRecordRevisionSyncEvent) => {
        if (event.caseVersion > knownVersion.current) showRefreshModal();
    };
    const handleCaseEvent = useEffectEvent((event: ServiceRecordRevisionSyncEvent) => {
        if (event.caseId !== caseId.current) return;
        // The server emits before the confirm response reaches this tab, so a
        // confirm in flight may be about to explain this very event.
        if (confirmInFlight.current) { bufferedEvents.current.push(event); return; }
        applyCaseEvent(event);
    });
    useEffect(() => {
        const unsubscribeRevision = subscribeServiceRecordRevisionSync((event) => handleCaseEvent(event));
        const unsubscribeCase = subscribeServiceRecordCaseChanges((event) => handleCaseEvent(event));
        return () => { unsubscribeRevision(); unsubscribeCase(); };
    }, []);
    /** 수정 확정, step 2: the preview was approved. */
    const confirmCommit = async () => {
        const request = commitRequest.current;
        if (!request || saving.current) return;
        saving.current = true;
        setBusy(true);
        setError(null);
        confirmInFlight.current = true;
        let confirmedVersion: number | null = null;
        try {
            const result = await adminServiceRecordEditApi.confirmDraft(request.draftId, request.draftVersion, request.previewId, request.idempotencyKey);
            confirmedVersion = result.caseVersion;
            knownVersion.current = Math.max(knownVersion.current, result.caseVersion);
            commitRequest.current = null;
            setPending(EMPTY_PENDING);
            setPreviewOpen(false);
            setNeedsReload(true);
            publishServiceRecordRevisionSync({ caseId: result.caseId, caseVersion: result.caseVersion });
            try { await refresh(); }
            catch { setError("수정은 저장되었습니다. 최신 기록을 다시 불러와 주세요."); }
        } catch (failure) {
            handleFailure(failure);
        } finally {
            confirmInFlight.current = false;
            const buffered = bufferedEvents.current;
            bufferedEvents.current = [];
            for (const event of buffered) {
                if (confirmedVersion === null || event.caseVersion > confirmedVersion) applyCaseEvent(event);
            }
            saving.current = false;
            setBusy(false);
        }
    };
    /** The preview was dismissed: leave no server draft behind and keep the local edits. */
    const closePreview = async () => {
        if (saving.current) return;
        const request = commitRequest.current;
        commitRequest.current = null;
        setPreviewOpen(false);
        setPreview(null);
        if (!request) return;
        saving.current = true;
        setBusy(true);
        try { await adminServiceRecordEditApi.discardDraft(request.draftId, request.draftVersion); }
        catch { /* the next 수정 확정 discards whatever is still ACTIVE */ }
        finally { saving.current = false; setBusy(false); }
    };
    const cancelAllEdits = () => {
        setDiscardModalOpen(false);
        setPending(EMPTY_PENDING);
        resetLocal();
    };
    const acceptRefresh = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try { await refresh(); }
        catch { setNeedsReload(true); setError("최신 기록을 불러오지 못했습니다. 다시 불러와 주세요."); }
        finally { saving.current = false; setBusy(false); setRefreshModalOpen(false); }
    };
    const leaveGuard = useUnsavedChangesGuard({
        active: hasPending && !refreshModalOpen,
        onLeave: () => setPending(EMPTY_PENDING),
    });
    const back = () => {
        if (busy) return;
        if (changed) setLeaveModalOpen(true);
        else resetLocal();
    };
    const errorLine = error || needsReload ? (
        <div data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview-commit_error`} data-slot="commit-error" className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-v3-burgundy">
                {error ?? "수정 기준을 확인할 수 없습니다. 최신 기록을 다시 불러와 주세요."}
            </p>
            {needsReload ? (
                <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview-commit_error_reload`} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>최신 기록 불러오기</Button>
            ) : null}
        </div>
    ) : null;
    return (
        <>
            {screen !== "overview" ? errorLine : null}
            {baseView.scheduleProjectionBlockingReasons.length ? (
                <Alert data-component={`${ADMIN_WIZARD_COMPONENT}_schedule-blocked`} variant="warning">
                    <AlertTitle>제공일 수정 불가</AlertTitle>
                    <AlertDescription>{baseView.scheduleProjectionBlockingReasons.map((reason) => reason.message).join(" ")}</AlertDescription>
                </Alert>
            ) : null}
            {screen === "day" ? (
                <CalendarLoadNotice
                    error={calendarError}
                    onRetry={retryCalendar}
                    loading={!calendarReady && !calendarError}
                    dataComponent={`${ADMIN_WIZARD_COMPONENT}_calendar-load-notice`}
                />
            ) : null}
            <ServiceRecordWizard
                data-component={ADMIN_WIZARD_COMPONENT}
                screen={screen} phone="" phoneError={null}
                context={supplemental ? { ...baseView.context, sessions: [...baseView.context.sessions.filter((item) => item.sessionIndex !== day), supplemental.session] } : displayContext}
                changedSessionIndexes={changedSessionIndexes}
                header={screen === "service" ? headerDraft : headerToInput(displayContext.header)}
                headerErrors={screen === "service" && !locked ? headerErrors : undefined}
                day={day} pageIdx={pageIdx} draft={draft}
                editing={Boolean(currentSession) || Boolean(sourceDate)}
                readOnly={locked} adminMode clientSignature={currentSession?.clientSignature ?? null}
                busy={busy} isRecordFinalized={false}
                lockedDays={new Set(baseView.context.sessions.filter((item) => item.submittedAt || item.locked).map((item) => item.sessionIndex))}
                nextOpenDay={() => 1} scheduleChangeBusy={false} hasServiceDateMismatch={false}
                defaultDate={(index) => dateOnly(displayContext.sessions.find((item) => item.sessionIndex === index)?.serviceDate)
                    || baseView.plannedSessions.find((item) => item.sessionIndex === index)?.serviceDate || ""}
                onPhoneChange={() => undefined} onSubmitPhone={() => undefined}
                onBack={back}
                onHeaderChange={(key, value) => { if (!locked) setHeaderDraft((current) => ({ ...current, [key]: value })); }}
                onDeliveryTypeChange={(value) => { if (!locked) setHeaderDraft((current) => ({ ...current, deliveryType: value })); }}
                onSaveHeader={() => void accept()} onOpenDay={openDay} onOpenScheduleChangePreview={() => undefined}
                onOpenServiceDateEditor={() => { if (!locked && calendarReady && !baseView.scheduleProjectionBlockingReasons.length) { setDateError(null); setDateDialogOpen(true); } }}
                onServiceDateChange={selectDate}
                onFieldChange={(key, value) => { if (!locked) setDraft((current) => ({ ...current, [key]: value })); }}
                onToggleMulti={(key, option) => {
                    if (locked) return;
                    setDraft((current) => {
                        const values = Array.isArray(current[key]) ? current[key] as string[] : [];
                        return { ...current, [key]: values.includes(option) ? values.filter((value) => value !== option) : [...values, option] };
                    });
                }}
                onSignatureChange={() => undefined}
                onNextPage={() => setPageIdx(DAY_PAGES.length - 1)}
                onOpenSubmitModal={() => void accept()} onEditSection={setPageIdx}
                slots={{
                    provider: ({ "data-component": component }) => <span data-component={component} data-slot="provider" className="org">관리자 {supplemental ? "조회" : "편집"}</span>,
                    signature: (props) => <ReadOnlySignature {...props} />,
                    adminCommitActions: hasPending || error || needsReload ? (
                        <>
                            {hasPending ? (
                                <>
                                    <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview-commit_confirm`} type="button" variant="positive"
                                        disabled={busy || needsReload} onClick={() => void startCommit()}>수정 확정</Button>
                                    <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview-commit_cancel`} type="button" variant="outline"
                                        className="text-v3-burgundy hover:text-v3-burgundy"
                                        disabled={busy} onClick={() => setDiscardModalOpen(true)}>수정 취소</Button>
                                </>
                            ) : null}
                            {screen === "overview" ? errorLine : null}
                        </>
                    ) : null,
                    adminConfirmAction: (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_header-edit`} type="button" variant="outline" disabled={busy}
                            onClick={() => { setHeaderDraft(headerToInput(displayContext.header)); setScreen("service"); }}>
                            기본정보 수정
                        </Button>
                    ),
                    adminHeaderAction: ({ isHeaderComplete, headerErrors: slotHeaderErrors }) => (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_header-confirm`} type="button" className="btn submit"
                            disabled={busy || (changed && (needsReload || !isHeaderComplete || Object.keys(slotHeaderErrors).length > 0))} onClick={() => !changed ? resetLocal() : void accept()}>
                            {busy ? "확인 중…" : changed ? "수정 확인" : "확인"}
                        </Button>
                    ),
                    serviceDateDisplay: ({ "data-component": component, sessionIndex, serviceDate }) => {
                        const original = baseView.plannedSessions.find((item) => item.sessionIndex === sessionIndex)?.originalDate;
                        return <span data-component={component} data-slot="date-display" className="admin-date-display">
                            <span data-slot="revised-date" className="admin-date-display-revised">{formatShortDate(dateOnly(serviceDate))}</span>
                            {original && original !== dateOnly(serviceDate) ? <span data-slot="original-date" className="admin-date-display-original">원본 {formatShortDate(original)}</span> : null}
                        </span>;
                    },
                    serviceDateEditor: ({ "data-component": component, disabled, onOpen }) => (
                        <button data-component={component} data-slot="sec-edit" type="button" className="sec-edit" disabled={disabled || !calendarReady || Boolean(baseView.scheduleProjectionBlockingReasons.length)} onClick={onOpen}>수정</button>
                    ),
                    adminSessionAction: ({ hasInvalidNumericAnswers: slotHasInvalidNumericAnswers }) => (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_confirmation-action_confirm`} type="button" className="btn submit"
                            disabled={busy || slotHasInvalidNumericAnswers || (!calendarReady && changed) || (needsReload && changed)}
                            onClick={() => supplemental ? resetLocal() : void accept()}>
                            {busy ? "확인 중…" : changed ? "수정 확인" : "확인"}
                        </Button>
                    ),
                    overviewSupplemental: baseView.supplementalSessions.length ? (
                        <div data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_supplemental`} data-slot="supplemental" className="overview-supplemental">
                            <p data-slot="supplemental-title" className="supplemental-title">같은 회차의 추가 기록</p>
                            {baseView.supplementalSessions.map((item) => (
                                <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_supplemental_item`} key={item.key} type="button" variant="outline"
                                    onClick={() => { setDay(item.sessionIndex); setSupplementalKey(item.key); setDraft(draftForSession(item.session)); setPageIdx(DAY_PAGES.length - 1); setScreen("day"); }}>
                                    {item.sessionIndex}회차 · {item.sourceLabel} · {formatShortDate(item.session.serviceDate)}
                                </Button>
                            ))}
                        </div>
                    ) : null,
                }}
            />
            <ServiceRecordEditPreviewDialog open={previewOpen} onOpenChange={(open) => { if (!open) void closePreview(); }}
                preview={preview} onConfirm={confirmCommit}
                confirmBusy={busy} confirmError={error} data-component={`${ADMIN_WIZARD_COMPONENT}_commit-preview`} />
            <ServiceRecordDateSelectionDialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}
                currentServiceDate={String(draft._date || sourceDate)} calendar={calendar} sessionLabel={`${day}회차`}
                onApply={selectDate} error={dateError} disabled={locked || !calendarReady}
                data-component={`${ADMIN_WIZARD_COMPONENT}_date-selection-dialog`} />
            <Dialog open={Boolean(followPrompt)} onOpenChange={(open) => { if (!open) { setFollowPrompt(null); setDateDialogOpen(true); } }}>
                <FormDialogShell mobileSheet size="compact" title="뒷 회차들도 변경할까요?"
                    description="변경한 서비스 제공일에 맞춰 뒷 회차들도 함께 변경할지 확인합니다."
                    data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal`}
                    footerClassName="grid grid-cols-2 gap-2.5 px-[22px] pb-[max(22px,env(safe-area-inset-bottom))]"
                    footer={<>
                        <Button type="button" variant="neutral" className="h-[52px] rounded-xl text-base"
                            disabled={!followPrompt?.canKeep}
                            data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal_actions_keep`}
                            onClick={() => { if (!followPrompt) return; const applied = applyDate(followPrompt.date, false); setFollowPrompt(null); if (!applied) setDateDialogOpen(true); }}>그대로 두기</Button>
                        <Button type="button" variant="positive" className="h-[52px] rounded-xl text-base"
                            disabled={!followPrompt?.canShift}
                            data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal_actions_apply`}
                            onClick={() => { if (!followPrompt) return; const applied = applyDate(followPrompt.date, true); setFollowPrompt(null); if (!applied) setDateDialogOpen(true); }}>변경하기</Button>
                    </>}>
                    <p className="text-sm text-v3-text-muted" data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal_content_description`}>
                        {followPrompt ? `${day}회차의 서비스 제공일을 ${followPrompt.delta}영업일만큼 변경합니다. 뒷 회차들도 동일하게 변경할까요?` : ""}
                    </p>
                    {followPrompt && !followPrompt.canKeep ? (
                        <p className="mt-2 text-sm text-v3-text-muted" data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal_content_keep-blocked`}>
                            다음 회차와 날짜가 겹쳐 뒷 회차들을 그대로 둘 수 없어요.
                        </p>
                    ) : null}
                    {followPrompt && !followPrompt.canShift ? (
                        <p className="mt-2 text-sm text-v3-text-muted" data-component={`${ADMIN_WIZARD_COMPONENT}_date-follow-modal_content_shift-blocked`}>
                            뒷 회차들의 제공일을 계산할 수 없어 함께 변경할 수 없어요.
                        </p>
                    ) : null}
                </FormDialogShell>
            </Dialog>
            <TwoButtonModal open={leaveModalOpen} onOpenChange={setLeaveModalOpen}
                title="수정사항을 취소할까요?" description="확정하지 않은 이 회차의 수정사항이 취소됩니다."
                approvalLabel="나가기" onApprove={() => { setLeaveModalOpen(false); resetLocal(); }}
                data-component={`${ADMIN_WIZARD_COMPONENT}_leave-modal`} />
            <TwoButtonModal open={discardModalOpen} onOpenChange={setDiscardModalOpen}
                title="모든 수정사항을 취소할까요?" description="확정하지 않은 모든 수정사항이 사라집니다. 확정된 기록은 그대로 유지됩니다."
                cancelLabel="닫기" approvalLabel="수정 취소" onApprove={cancelAllEdits}
                data-component={`${ADMIN_WIZARD_COMPONENT}_discard-modal`} />
            <TwoButtonModal open={leaveGuard.leavePromptOpen} onOpenChange={(open) => { if (!open) leaveGuard.stay(); }}
                title="페이지를 나가시겠어요?" description="수정이 저장되지 않았어요." isDescriptionVisuallyHidden={false}
                cancelLabel="머무르기" approvalLabel="나가기" onApprove={leaveGuard.leave}
                data-component={`${ADMIN_WIZARD_COMPONENT}_page-leave-modal`} />
            {/* Blocking: the only way out is 확인, so close requests (outside click, Escape) are ignored. */}
            <Dialog open={refreshModalOpen} onOpenChange={() => undefined}>
                <FormDialogShell mobileSheet size="compact" showCloseButton={false} title="새로운 수정 사항이 있어서 새로고침이 필요해요"
                    description="다른 곳에서 이 기록이 수정되었어요. 최신 내용을 불러온 뒤 다시 수정해 주세요."
                    data-component={`${ADMIN_WIZARD_COMPONENT}_refresh-modal`}
                    footerClassName="grid grid-cols-1 gap-2.5 px-[22px] pb-[max(22px,env(safe-area-inset-bottom))]"
                    footer={(
                        <Button type="button" variant="positive" className="h-[52px] rounded-xl text-base" disabled={busy}
                            data-component={`${ADMIN_WIZARD_COMPONENT}_refresh-modal_actions_confirm`}
                            onClick={() => void acceptRefresh()}>확인</Button>
                    )}>
                    <p className="text-sm text-v3-text-muted" data-component={`${ADMIN_WIZARD_COMPONENT}_refresh-modal_content_description`}>
                        확인을 누르면 최신 기록을 불러오고, 저장하지 않은 수정사항은 사라져요.
                    </p>
                </FormDialogShell>
            </Dialog>
        </>
    );
}

type ViewerState =
    | { kind: "loading"; clientId: string }
    | {
        kind: "ready";
        clientId: string;
        overview: AdminServiceRecordEditorOverview;
        draftState: AdminServiceRecordEditState | null;
        draftErrorStatus: number | null;
    }
    | { kind: "error"; clientId: string; status: number };

function parseOverview(payload: unknown): AdminServiceRecordEditorOverview | null {
    if (!isRecord(payload) || !Array.isArray(payload.assignments)) return null;
    return payload as unknown as AdminServiceRecordEditorOverview;
}

export interface ServiceRecordAdminViewerProps {
    clientId: string;
}

export function ServiceRecordAdminViewer({ clientId }: ServiceRecordAdminViewerProps) {
    const [state, setState] = useState<ViewerState>({ kind: "loading", clientId });

    useEffect(() => {
        const controller = new AbortController();
        let alive = true;

        // Bracket the separate overview read with source identities so a
        // concurrent write cannot bind a stale screen to a fresh fingerprint.
        const sourceBeforeLoad = adminServiceRecordEditApi.getDraft(clientId).catch(() => null);
        void sourceBeforeLoad.then(() => fetch(`/api/admin/service-records/client/${encodeURIComponent(clientId)}/editor`, {
            cache: "no-store",
            signal: controller.signal,
        }))
            .then(async (response) => {
                if (!alive) return;
                if (!response.ok) {
                    setState({ kind: "error", clientId, status: response.status });
                    return;
                }
                const payload = await response.json().catch(() => null);
                const overview = parseOverview(payload);
                if (!overview) {
                    setState({ kind: "error", clientId, status: 500 });
                    return;
                }
                try {
                    const draftState = await adminServiceRecordEditApi.getDraft(clientId);
                    const stable = sameSource(await sourceBeforeLoad, draftState);
                    if (alive) setState({ kind: "ready", clientId, overview, draftState: stable ? draftState : null, draftErrorStatus: stable ? null : 409 });
                } catch (error) {
                    if (!alive) return;
                    const status = error instanceof AdminServiceRecordEditApiError ? error.status : 500;
                    setState({ kind: "ready", clientId, overview, draftState: null, draftErrorStatus: status });
                }
            })
            .catch(() => {
                if (alive) setState({ kind: "error", clientId, status: 500 });
            });

        return () => {
            alive = false;
            controller.abort();
        };
    }, [clientId]);

    const visibleState: ViewerState = state.clientId === clientId
        ? state
        : { kind: "loading", clientId };

    if (visibleState.kind === "loading") {
        return <p data-component="desktop_service-record-admin_state-loading" data-slot="state">불러오는 중…</p>;
    }
    if (visibleState.kind === "error") {
        const message = visibleState.status === 401
            ? "로그인이 필요합니다."
            : visibleState.status === 403
                ? "이 기록을 조회할 권한이 없습니다."
                : visibleState.status === 404
                    ? "고객의 제공기록지를 찾을 수 없습니다."
                    : "제공기록지를 불러오지 못했습니다.";
        return <p data-component={`desktop_service-record-admin_state-error-${visibleState.status}`} data-slot="state">{message}</p>;
    }
    return (
        <ServiceRecordAdminWizard
            clientId={visibleState.clientId}
            overview={visibleState.overview}
            initialDraftState={visibleState.draftState}
            initialDraftErrorStatus={visibleState.draftErrorStatus}
        />
    );
}
