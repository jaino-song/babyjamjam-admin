/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    DAY_PAGES,
    ServiceRecordWizard,
    formatShortDate,
} from "@babyjamjam/service-record-ui";
import type {
    ServiceRecordContext,
    SignatureSlotProps,
} from "@babyjamjam/service-record-ui";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import {
    adminServiceRecordEditApi,
    normalizeAdminServiceRecordEditState,
} from "@/features/service-records/api/admin-service-record-edit.api";
import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditChanges,
    type AdminServiceRecordEditDateMove,
    type AdminServiceRecordEditSessionChanges,
    type AdminServiceRecordEditState,
    type ServiceRecordEditConfirmResponse,
    type ServiceRecordEditPreviewResponse,
    type ServiceRecordEditPreviewBlockingReason,
    type ServiceRecordPlannedSession,
} from "@/features/service-records/types";
import { publishServiceRecordRevisionSync } from "@/features/service-records/revision-sync";

import { ServiceRecordDateSelectionDialog } from "./ServiceRecordDateSelectionDialog";
import { ServiceRecordEditPreviewDialog } from "./ServiceRecordEditPreviewDialog";

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

function cloneAdminServiceRecordEditChanges(
    changes: AdminServiceRecordEditChanges | null | undefined,
): AdminServiceRecordEditChanges {
    if (!changes) return {};
    return {
        ...(changes.header ? { header: { ...changes.header } } : {}),
        ...(changes.sessions
            ? {
                sessions: changes.sessions.map((session) => ({
                    ...session,
                    ...(session.answers ? { answers: { ...session.answers } } : {}),
                })),
            }
            : {}),
    };
}

function stripServiceDateSnapshots(
    changes: AdminServiceRecordEditChanges,
): AdminServiceRecordEditChanges {
    if (!changes.sessions) return cloneAdminServiceRecordEditChanges(changes);
    return {
        ...(changes.header ? { header: { ...changes.header } } : {}),
        sessions: changes.sessions.map((session) => ({
            sessionIndex: session.sessionIndex,
            ...(session.answers ? { answers: { ...session.answers } } : {}),
            ...(session.etcService !== undefined ? { etcService: session.etcService } : {}),
            ...(session.notes !== undefined ? { notes: session.notes } : {}),
            ...(session.paymentConfirmed !== undefined ? { paymentConfirmed: session.paymentConfirmed } : {}),
        })),
    };
}

function applyAdminServiceRecordEditChanges(
    context: ServiceRecordContext,
    changes: AdminServiceRecordEditChanges,
): ServiceRecordContext {
    const sessionChanges = new Map((changes.sessions ?? []).map((session) => [session.sessionIndex, session]));
    return {
        ...context,
        header: context.header || changes.header
            ? { ...(context.header ?? {}), ...(changes.header ?? {}) }
            : null,
        sessions: context.sessions.map((session) => {
            const patch = sessionChanges.get(session.sessionIndex);
            if (!patch) return session;
            return {
                ...session,
                ...(patch.serviceDate ? { serviceDate: patch.serviceDate } : {}),
                ...(patch.answers ? { answers: { ...(session.answers ?? {}), ...patch.answers } } : {}),
                ...(patch.etcService !== undefined ? { etcService: patch.etcService } : {}),
                ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
                ...(patch.paymentConfirmed !== undefined ? { paymentConfirmed: patch.paymentConfirmed } : {}),
            };
        }),
    };
}

function updateAdminServiceRecordEditSession(
    current: AdminServiceRecordEditChanges,
    sessionIndex: number,
    patch: Omit<AdminServiceRecordEditSessionChanges, "sessionIndex">,
): AdminServiceRecordEditChanges {
    const sessions = [...(current.sessions ?? [])];
    const index = sessions.findIndex((session) => session.sessionIndex === sessionIndex);
    const existing = index >= 0 ? sessions[index] : { sessionIndex };
    const next = {
        ...existing,
        ...patch,
        ...(patch.answers
            ? { answers: { ...(existing.answers ?? {}), ...patch.answers } }
            : existing.answers
                ? { answers: { ...existing.answers } }
                : {}),
    };
    if (index >= 0) sessions[index] = next;
    else sessions.push(next);
    return { ...current, sessions };
}

function updateAdminServiceRecordEditField(
    current: AdminServiceRecordEditChanges,
    sessionIndex: number,
    key: string,
    value: unknown,
): AdminServiceRecordEditChanges {
    if (key === "_date") {
        return updateAdminServiceRecordEditSession(current, sessionIndex, { serviceDate: String(value ?? "") });
    }
    if (key === "etcService" || key === "notes") {
        return updateAdminServiceRecordEditSession(current, sessionIndex, { [key]: String(value ?? "") });
    }
    if (key === "paymentConfirmed") {
        return updateAdminServiceRecordEditSession(current, sessionIndex, { paymentConfirmed: Boolean(value) });
    }
    return updateAdminServiceRecordEditSession(current, sessionIndex, { answers: { [key]: value } });
}

function latestStateFromDraftConflict(error: AdminServiceRecordEditApiError): AdminServiceRecordEditState | null {
    if (!isRecord(error.body)) return null;
    const latestDraft = error.body.latestDraft ?? error.body.draft ?? null;
    if (!latestDraft && error.status !== 409) return null;
    return normalizeAdminServiceRecordEditState({ ...error.body, draft: latestDraft });
}

function ReadOnlySignature({
    "data-component": dataComponent,
    value,
    signedAt,
}: SignatureSlotProps) {
    return (
        <div data-component={dataComponent} data-slot="signature" className="sign-fld locked">
            <div data-slot="sign-head" className="sign-head">
                <span data-slot="lab" className="lab">산모 서명</span>
                {signedAt ? <span data-slot="signed-at" className="signed-chip show">{formatShortDate(signedAt)}</span> : null}
            </div>
            {value ? (
                <div data-slot="signature-image-wrap" className="padwrap locked">
                    <img
                        data-slot="signature-image"
                        className="admin-signature-image"
                        src={value}
                        alt="산모 서명"
                    />
                </div>
            ) : (
                <p data-slot="sign-empty" className="sign-note">저장된 서명이 없습니다.</p>
            )}
            <p data-slot="sign-note" className="sign-note">관리자 조회 전용</p>
        </div>
    );
}

type DraftSaveState = "idle" | "saving" | "saved" | "error";

interface DraftErrorState {
    status: number;
    message: string;
    latestState: AdminServiceRecordEditState | null;
}

function draftErrorMessage(status: number): string {
    if (status === 401) return "로그인이 필요합니다. 초안 입력은 유지됩니다.";
    if (status === 403) return "초안 접근 권한이 없습니다. 현재 입력은 유지됩니다.";
    if (status === 404) return "초안을 찾을 수 없습니다. 현재 입력은 유지됩니다.";
    if (status === 409) return "다른 관리자의 변경으로 저장되지 않았습니다. 입력은 유지되었습니다. 최신 초안을 불러오거나 내 입력을 유지하세요.";
    return "초안을 저장하지 못했습니다. 입력은 유지됩니다.";
}

function dateMoveErrorMessage(status: number): string {
    if (status === 401) return "로그인이 필요합니다. 제공일 입력은 유지됩니다.";
    if (status === 400) return "선택한 제공일을 적용할 수 없습니다. 현재 입력은 유지됩니다.";
    if (status === 403) return "제공일 변경 권한이 없습니다. 현재 입력은 유지됩니다.";
    if (status === 409) return "다른 관리자의 변경으로 제공일을 적용하지 못했습니다. 입력은 유지되었습니다. 최신 초안을 불러오거나 내 입력을 유지하세요.";
    return "제공일을 저장하지 못했습니다. 현재 입력은 유지됩니다.";
}

function previewErrorMessage(status: number): string {
    if (status === 401) return "로그인이 필요합니다. 초안 미리보기를 불러오지 못했습니다.";
    if (status === 403) return "초안 미리보기 권한이 없습니다.";
    if (status === 404) return "초안을 찾을 수 없어 미리보기를 불러오지 못했습니다.";
    if (status === 409) return "초안 버전이 변경되어 미리보기를 불러오지 못했습니다. 최신 초안을 확인해 주세요.";
    return "초안 미리보기를 불러오지 못했습니다.";
}

function confirmErrorMessage(status: number): string {
    if (status === 401) return "로그인이 필요합니다. 수정 확정을 처리하지 못했습니다.";
    if (status === 403) return "수정 확정 권한이 없습니다. 입력과 초안은 유지됩니다.";
    if (status === 404) return "초안을 찾을 수 없습니다. 입력과 초안은 유지됩니다.";
    if (status === 409) return "미리보기가 오래되어 수정 확정에 실패했습니다. 최신 미리보기를 다시 확인해 주세요.";
    return "수정 확정 응답을 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.";
}

function confirmDocumentStatusMessage(status: ServiceRecordEditConfirmResponse["documentStatus"]): string {
    switch (status) {
        case "not_required": return "전자문서 처리 불필요";
        case "waiting_for_completion": return "전자문서 처리 대기 중";
        case "capability_unverified": return "전자문서 처리 근거 확인 필요";
        case "pending": return "전자문서 처리 중";
    }
}

function hasDraftChanges(changes: AdminServiceRecordEditChanges): boolean {
    const hasHeaderChanges = Boolean(changes.header && Object.keys(changes.header).length > 0);
    const hasSessionChanges = Boolean(changes.sessions?.some((session) => (
        Object.keys(session).some((key) => key !== "sessionIndex")
    )));
    return hasHeaderChanges || hasSessionChanges;
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

export interface ServiceRecordAdminWizardProps {
    clientId: string;
    overview: AdminServiceRecordEditorOverview;
    initialDraftState?: AdminServiceRecordEditState | null;
    initialDraftErrorStatus?: number | null;
}

export function ServiceRecordAdminWizard({
    clientId,
    overview,
    initialDraftState = null,
    initialDraftErrorStatus = null,
}: ServiceRecordAdminWizardProps) {
    const baseView = useMemo(() => buildAdminServiceRecordView(overview), [overview]);
    const supplementalSessions = baseView.supplementalSessions;
    const [draftState, setDraftState] = useState<AdminServiceRecordEditState | null>(initialDraftState);
    const [workingChanges, setWorkingChanges] = useState<AdminServiceRecordEditChanges>(() => (
        cloneAdminServiceRecordEditChanges(initialDraftState?.draft?.changes)
    ));
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<DraftSaveState>(initialDraftState?.draft ? "saved" : "idle");
    const [draftError, setDraftError] = useState<DraftErrorState | null>(() => initialDraftErrorStatus
        ? { status: initialDraftErrorStatus, message: draftErrorMessage(initialDraftErrorStatus), latestState: null }
        : null);
    const [discardModalOpen, setDiscardModalOpen] = useState(false);
    const [discarding, setDiscarding] = useState(false);
    const [screen, setScreen] = useState<"overview" | "service" | "day">("overview");
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [selectedSupplementalKey, setSelectedSupplementalKey] = useState<string | null>(null);
    const [dateDialogOpen, setDateDialogOpen] = useState(false);
    const [dateMoveBusy, setDateMoveBusy] = useState(false);
    const [pendingDateMove, setPendingDateMove] = useState<AdminServiceRecordEditDateMove | null>(null);
    const [dateMoveError, setDateMoveError] = useState<string | null>(null);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [preview, setPreview] = useState<ServiceRecordEditPreviewResponse | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const [confirmResult, setConfirmResult] = useState<ServiceRecordEditConfirmResponse | null>(null);
    const confirmIdempotencyKey = useRef<string | null>(null);

    const activeDraft = draftState?.draft?.status === "ACTIVE" ? draftState.draft : null;
    const context = useMemo(
        () => applyAdminServiceRecordEditChanges(baseView.context, workingChanges),
        [baseView.context, workingChanges],
    );
    const plannedSessionByIndex = useMemo(
        () => new Map(baseView.plannedSessions.map((session) => [session.sessionIndex, session])),
        [baseView.plannedSessions],
    );
    const header = useMemo(() => headerToInput(context.header), [context.header]);
    const selectedSupplemental = supplementalSessions.find((item) => item.key === selectedSupplementalKey);
    const activeContext = useMemo(() => {
        if (!selectedSupplemental) return context;
        return {
            ...context,
            sessions: [
                ...context.sessions.filter((session) => session.sessionIndex !== selectedSupplemental.sessionIndex),
                selectedSupplemental.session,
            ],
        };
    }, [context, selectedSupplemental]);
    const displayDay = selectedSupplemental
        ? day
        : Math.min(day, Math.max(context.totalSessions, 1));
    const currentSession = activeContext.sessions.find((session) => session.sessionIndex === displayDay);
    const hasPlannedSession = plannedSessionByIndex.has(displayDay);
    const lockedDays = useMemo(
        () => new Set(
            activeContext.sessions
                .filter((session) => session.locked || Boolean(session.submittedAt) || session.hasMomApproval)
                .map((session) => session.sessionIndex),
        ),
        [activeContext.sessions],
    );
    const currentDateForSession = useCallback((sessionIndex: number) => {
        const changedDate = workingChanges.sessions?.find((session) => session.sessionIndex === sessionIndex)?.serviceDate;
        if (changedDate) return dateOnly(changedDate);
        const sessionDate = activeContext.sessions.find((session) => session.sessionIndex === sessionIndex)?.serviceDate;
        if (sessionDate) return dateOnly(sessionDate);
        return dateOnly(plannedSessionByIndex.get(sessionIndex)?.serviceDate);
    }, [activeContext.sessions, plannedSessionByIndex, workingChanges.sessions]);
    const changedSessionIndexes = useMemo(
        () => new Set((workingChanges.sessions ?? []).map((session) => session.sessionIndex)),
        [workingChanges.sessions],
    );
    const hasPendingChanges = useMemo(() => hasDraftChanges(workingChanges), [workingChanges]);
    const isSaving = saveState === "saving";
    const formReadOnly = !activeDraft || Boolean(selectedSupplemental) || isSaving || dateMoveBusy || Boolean(confirmResult);

    const markLocalChange = useCallback(() => {
        setDirty(true);
        setSaveState("idle");
        setDraftError(null);
    }, []);

    const updateWorkingChanges = useCallback((updater: (current: AdminServiceRecordEditChanges) => AdminServiceRecordEditChanges) => {
        setWorkingChanges((current) => updater(current));
        markLocalChange();
    }, [markLocalChange]);

    const persistDraft = useCallback(async (): Promise<AdminServiceRecordEditState | null> => {
        setSaveState("saving");
        setDraftError(null);
        try {
            const response = activeDraft
                ? await adminServiceRecordEditApi.updateDraft(
                    activeDraft.id,
                    activeDraft.draftVersion,
                    stripServiceDateSnapshots(workingChanges),
                )
                : await adminServiceRecordEditApi.startDraft(clientId);
            if (!response.draft || response.draft.status !== "ACTIVE") {
                throw new Error("Draft start did not return an active draft");
            }
            const nextChanges = cloneAdminServiceRecordEditChanges(response.draft.changes);
            const nextContext = applyAdminServiceRecordEditChanges(baseView.context, nextChanges);
            const nextSession = selectedSupplemental
                ? selectedSupplemental.session
                : nextContext.sessions.find((session) => session.sessionIndex === displayDay);
            setDraftState(response);
            setWorkingChanges(nextChanges);
            setDraft(draftForSession(nextSession));
            setDirty(false);
            setSaveState("saved");
            return response;
        } catch (error) {
            const apiError = error instanceof AdminServiceRecordEditApiError ? error : null;
            const status = apiError?.status ?? 500;
            setDraftError({
                status,
                message: draftErrorMessage(status),
                latestState: status === 409 && apiError ? latestStateFromDraftConflict(apiError) : null,
            });
            setSaveState("error");
            return null;
        }
    }, [activeDraft, baseView.context, clientId, displayDay, selectedSupplemental, workingChanges]);

    const applyDateMove = useCallback(async (toDate: string) => {
        if (!activeDraft || selectedSupplemental || dateMoveBusy) return;
        const dateMove: AdminServiceRecordEditDateMove = {
            sessionIndex: displayDay,
            toDate,
        };
        setPendingDateMove(dateMove);
        setDateMoveBusy(true);
        setDraftError(null);
        setDateMoveError(null);
        try {
            const response = await adminServiceRecordEditApi.updateDraft(
                activeDraft.id,
                activeDraft.draftVersion,
                stripServiceDateSnapshots(workingChanges),
                dateMove,
            );
            if (!response.draft || response.draft.status !== "ACTIVE") {
                throw new Error("Date move did not return an active draft");
            }
            const nextChanges = cloneAdminServiceRecordEditChanges(response.draft.changes);
            const nextContext = applyAdminServiceRecordEditChanges(baseView.context, nextChanges);
            const nextSession = nextContext.sessions.find((session) => session.sessionIndex === displayDay);
            setDraftState(response);
            setWorkingChanges(nextChanges);
            setDraft(draftForSession(nextSession));
            setDirty(false);
            setSaveState("saved");
            setPendingDateMove(null);
            setDateMoveError(null);
            setDateDialogOpen(false);
            setPreview(null);
            setPreviewError(null);
        } catch (error) {
            const apiError = error instanceof AdminServiceRecordEditApiError ? error : null;
            const status = apiError?.status ?? 500;
            // Preserve the selected date and keep the dialog recoverable. A
            // retry is always an explicit user action with the current CAS;
            // no failed/unknown request is resent automatically.
            setDateDialogOpen(true);
            setDateMoveError(dateMoveErrorMessage(status));
            setDraftError({
                status,
                message: dateMoveErrorMessage(status),
                latestState: status === 409 && apiError ? latestStateFromDraftConflict(apiError) : null,
            });
            setSaveState("error");
        } finally {
            setDateMoveBusy(false);
        }
    }, [activeDraft, baseView.context, dateMoveBusy, displayDay, selectedSupplemental, workingChanges]);

    const openPreview = useCallback(async () => {
        if (!activeDraft || dateMoveBusy || previewBusy || confirmBusy || confirmResult) return;
        const target = dirty ? await persistDraft() : draftState;
        if (!target?.draft || target.draft.status !== "ACTIVE") return;
        confirmIdempotencyKey.current = null;
        setConfirmResult(null);
        setConfirmError(null);
        setPreviewDialogOpen(true);
        setPreviewBusy(true);
        setPreviewError(null);
        try {
            const nextPreview = await adminServiceRecordEditApi.previewDraft(
                target.draft.id,
                target.draft.draftVersion,
            );
            setPreview(nextPreview);
        } catch (error) {
            const apiError = error instanceof AdminServiceRecordEditApiError ? error : null;
            setPreviewError(previewErrorMessage(apiError?.status ?? 500));
            setPreview(null);
        } finally {
            setPreviewBusy(false);
        }
    }, [activeDraft, confirmBusy, confirmResult, dateMoveBusy, draftState, dirty, persistDraft, previewBusy]);

    const refreshPreview = useCallback(() => {
        if (confirmBusy) return;
        confirmIdempotencyKey.current = null;
        setConfirmResult(null);
        setConfirmError(null);
        void openPreview();
    }, [confirmBusy, openPreview]);

    const confirmPreview = useCallback(async () => {
        if (!activeDraft || !preview || preview.blockingReasons.length > 0 || confirmBusy) return;
        if (preview.draftId !== activeDraft.id || preview.draftVersion !== activeDraft.draftVersion) {
            setConfirmError(confirmErrorMessage(409));
            return;
        }
        let idempotencyKey = confirmIdempotencyKey.current;
        if (!idempotencyKey) {
            try {
                idempotencyKey = createIdempotencyKey();
                confirmIdempotencyKey.current = idempotencyKey;
            } catch {
                setConfirmError(confirmErrorMessage(0));
                return;
            }
        }
        setConfirmBusy(true);
        setConfirmError(null);
        try {
            const result = await adminServiceRecordEditApi.confirmDraft(
                activeDraft.id,
                preview.draftVersion,
                preview.previewId,
                idempotencyKey,
            );
            setConfirmResult(result);
            setSaveState("saved");
            publishServiceRecordRevisionSync({
                caseId: result.caseId,
                caseVersion: result.caseVersion,
            });
        } catch (error) {
            const apiError = error instanceof AdminServiceRecordEditApiError ? error : null;
            const status = apiError?.status ?? 0;
            if (status === 409) {
                // A stale preview is a definitive conflict. A fresh preview
                // starts a new logical attempt and therefore gets a new key.
                confirmIdempotencyKey.current = null;
            }
            // Transport loss, malformed 2xx data, and other unknown errors
            // retain the key so an explicit retry cannot create a duplicate.
            setConfirmError(confirmErrorMessage(status));
        } finally {
            setConfirmBusy(false);
        }
    }, [activeDraft, confirmBusy, preview]);

    const discardCurrentDraft = useCallback(async () => {
        if (!activeDraft) return;
        setDiscarding(true);
        setDraftError(null);
        try {
            const response = await adminServiceRecordEditApi.discardDraft(activeDraft.id, activeDraft.draftVersion);
            setDraftState(response);
            setWorkingChanges({});
            setDraft({});
            setDirty(false);
            setSaveState("idle");
            setSelectedSupplementalKey(null);
            setScreen("overview");
            setDiscardModalOpen(false);
            setPendingDateMove(null);
            setDateMoveError(null);
            setDateDialogOpen(false);
            setPreviewDialogOpen(false);
            setPreview(null);
            setPreviewError(null);
            setConfirmError(null);
            setConfirmResult(null);
            confirmIdempotencyKey.current = null;
        } catch (error) {
            const apiError = error instanceof AdminServiceRecordEditApiError ? error : null;
            const status = apiError?.status ?? 500;
            setDraftError({
                status,
                message: draftErrorMessage(status),
                latestState: status === 409 && apiError ? latestStateFromDraftConflict(apiError) : null,
            });
        } finally {
            setDiscarding(false);
        }
    }, [activeDraft]);

    const reloadLatestDraft = useCallback(() => {
        const latest = draftError?.latestState;
        if (!latest) return;
        const nextChanges = cloneAdminServiceRecordEditChanges(latest.draft?.changes);
        const nextContext = applyAdminServiceRecordEditChanges(baseView.context, nextChanges);
        const nextSession = selectedSupplemental
            ? selectedSupplemental.session
            : nextContext.sessions.find((session) => session.sessionIndex === displayDay);
        setDraftState(latest);
        setWorkingChanges(nextChanges);
        setDraft(draftForSession(nextSession));
        setDirty(false);
        setSaveState(latest.draft?.status === "ACTIVE" ? "saved" : "idle");
        setDraftError(null);
        setPendingDateMove(null);
        setDateMoveError(null);
        setDateDialogOpen(false);
        setPreviewDialogOpen(false);
        setPreview(null);
        setPreviewError(null);
        setConfirmError(null);
        setConfirmResult(null);
        confirmIdempotencyKey.current = null;
    }, [baseView.context, displayDay, draftError, selectedSupplemental]);

    const keepLocalInput = useCallback(() => {
        setDraftError(null);
        setSaveState("error");
    }, []);

    const nextOpenDay = useCallback(() => {
        for (let sessionIndex = 1; sessionIndex <= context.totalSessions; sessionIndex += 1) {
            if (!lockedDays.has(sessionIndex)) return sessionIndex;
        }
        return context.totalSessions || 1;
    }, [context.totalSessions, lockedDays]);
    const defaultDate = useCallback(
        (sessionIndex: number) => currentDateForSession(sessionIndex),
        [currentDateForSession],
    );
    const openDay = useCallback((sessionIndex: number) => {
        const bounded = Math.min(Math.max(sessionIndex, 1), Math.max(context.totalSessions, 1));
        const session = context.sessions.find((row) => row.sessionIndex === bounded);
        setSelectedSupplementalKey(null);
        setDay(bounded);
        setPageIdx(0);
        setDraft(draftForSession(session));
        setScreen("day");
    }, [context.sessions, context.totalSessions]);
    const openSupplemental = useCallback((key: string) => {
        const item = supplementalSessions.find((candidate) => candidate.key === key);
        if (!item) return;
        setSelectedSupplementalKey(key);
        setDay(item.sessionIndex);
        setPageIdx(0);
        setDraft(draftForSession(item.session));
        setScreen("day");
    }, [supplementalSessions]);
    const goBack = useCallback(() => {
        if (screen === "day" || screen === "service") {
            setSelectedSupplementalKey(null);
            setScreen("overview");
        }
    }, [screen]);
    const goNextPage = useCallback(() => {
        setPageIdx((current) => Math.min(current + 1, DAY_PAGES.length - 1));
    }, []);
    const onFieldChange = useCallback((key: string, value: unknown) => {
        setDraft((current) => ({ ...current, [key]: value }));
        if (!activeDraft || selectedSupplemental) return;
        updateWorkingChanges((current) => updateAdminServiceRecordEditField(current, displayDay, key, value));
    }, [activeDraft, displayDay, selectedSupplemental, updateWorkingChanges]);
    const onToggleMulti = useCallback((key: string, option: string) => {
        const current = Array.isArray(draft[key]) ? [...draft[key] as string[]] : [];
        const next = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
        onFieldChange(key, next);
    }, [draft, onFieldChange]);
    const onServiceDateChange = useCallback((next: string) => {
        setDraft((current) => ({ ...current, _date: next }));
    }, []);
    const onHeaderChange = useCallback((key: string, value: string) => {
        if (!activeDraft) return;
        updateWorkingChanges((current) => ({
            ...current,
            header: { ...(current.header ?? {}), [key]: value },
        }));
    }, [activeDraft, updateWorkingChanges]);
    const onSaveHeader = useCallback(async () => {
        const saved = await persistDraft();
        if (saved) setScreen("overview");
    }, [persistDraft]);

    const originalDateForSession = useCallback((sessionIndex: number) => (
        dateOnly(plannedSessionByIndex.get(sessionIndex)?.originalDate)
        || dateOnly(baseView.context.sessions.find((session) => session.sessionIndex === sessionIndex)?.serviceDate)
    ), [baseView.context.sessions, plannedSessionByIndex]);

    const renderAdminDateDisplay = useCallback(({
        "data-component": dataComponent,
        sessionIndex,
        serviceDate,
    }: {
        "data-component": string;
        sessionIndex: number;
        serviceDate: string;
    }) => {
        const revisedDate = dateOnly(serviceDate) || serviceDate;
        const originalDate = originalDateForSession(sessionIndex);
        const changed = Boolean(originalDate && revisedDate && originalDate !== revisedDate);
        return (
            <span data-component={dataComponent} data-slot="date-display" className="admin-date-display">
                <span data-slot="revised-date" className="admin-date-display-revised">{formatShortDate(revisedDate)}</span>
                {changed ? <span data-slot="original-date" className="admin-date-display-original">원본 {formatShortDate(originalDate)}</span> : null}
            </span>
        );
    }, [originalDateForSession]);

    const openDateDialog = useCallback((sessionIndex: number) => {
        if (!activeDraft || selectedSupplemental || sessionIndex !== displayDay || dateMoveBusy || confirmResult) return;
        setPendingDateMove(null);
        setDateMoveError(null);
        setDateDialogOpen(true);
    }, [activeDraft, confirmResult, dateMoveBusy, displayDay, selectedSupplemental]);

    const handleDateDialogOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen && dateMoveBusy) return;
        setDateDialogOpen(nextOpen);
        if (!nextOpen) {
            setPendingDateMove(null);
            setDateMoveError(null);
        }
    }, [dateMoveBusy]);

    const statusLabel = saveState === "saving"
            ? "저장 중…"
            : saveState === "error"
                ? "저장 실패"
                : dirty
                    ? "저장 필요"
                    : saveState === "saved"
                ? "저장됨"
                    : "초안 없음";
    const adminConfirmAction = (
        <Button
            type="button"
            data-slot="btn"
            className="btn ghost schedule-change"
            variant="outline"
            data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_actions_confirm`}
            disabled={
                !activeDraft
                || !hasPendingChanges
                || isSaving
                || dateMoveBusy
                || discarding
                || previewBusy
                || confirmBusy
                || Boolean(confirmResult)
            }
            onClick={() => { void openPreview(); }}
        >
            {confirmResult ? "수정 확정됨" : "수정 확정"}
        </Button>
    );
    const adminToolbar = (
        <>
            <span data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_status`} data-slot="admin-draft-status">{statusLabel}</span>
            <div data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_actions`} data-slot="admin-draft-actions">
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_save`}
                    disabled={isSaving || discarding}
                    onClick={() => { void persistDraft(); }}
                >
                    초안 저장
                </Button>
                {activeDraft ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="negative"
                        data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_discard`}
                        disabled={isSaving || discarding}
                        onClick={() => setDiscardModalOpen(true)}
                    >
                        초안 취소
                    </Button>
                ) : null}
                {activeDraft ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_preview`}
                        disabled={isSaving || dateMoveBusy || discarding || previewBusy || confirmBusy || Boolean(confirmResult)}
                        onClick={() => { void openPreview(); }}
                    >
                        변경 미리보기
                    </Button>
                ) : null}
                {activeDraft && screen !== "service" ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_header`}
                        disabled={isSaving || discarding}
                        onClick={() => setScreen("service")}
                    >
                        기본정보 편집
                    </Button>
                ) : null}
            </div>
            {draftState?.sourceChanged ? (
                <Alert className="admin-draft-source-alert" data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_source-changed`} variant="warning">
                    <AlertTitle>원본 기록 변경</AlertTitle>
                    <AlertDescription>원본 기록이 변경되었습니다. 초안 입력은 유지됩니다.</AlertDescription>
                </Alert>
            ) : null}
            {confirmResult ? (
                <Alert className="admin-draft-confirmed-alert" data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_confirmed`} variant="success">
                    <AlertTitle>수정 확정됨</AlertTitle>
                    <AlertDescription>
                        {confirmResult.status === "no_changes" ? "변경 없이 초안이 확정되었습니다." : "관리자 수정본이 확정되었습니다."}
                        {" "}{confirmDocumentStatusMessage(confirmResult.documentStatus)}.
                    </AlertDescription>
                </Alert>
            ) : null}
            {baseView.scheduleProjectionBlockingReasons.length > 0 ? (
                <Alert className="admin-schedule-projection-alert" data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_schedule-projection-blocked`} variant="warning">
                    <AlertTitle>예정 회차를 확인할 수 없습니다.</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc space-y-1 pl-5">
                            {baseView.scheduleProjectionBlockingReasons.map((reason, index) => (
                                <li key={`${reason.code}-${reason.sessionIndex ?? "all"}-${index}`}>{reason.message}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            ) : null}
            {draftError && !dateDialogOpen ? (
                <Alert className="admin-draft-alert" data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_error`} variant="destructive">
                    <AlertTitle>초안 저장 실패</AlertTitle>
                    <AlertDescription>
                        <p>{draftError.message}</p>
                        {draftError.latestState ? (
                            <div data-component={`${ADMIN_WIZARD_COMPONENT}_top-bar_admin-toolbar_conflict-actions`} data-slot="conflict-actions">
                                <Button type="button" size="sm" variant="neutral" onClick={reloadLatestDraft}>최신 초안 불러오기</Button>
                                <Button type="button" size="sm" variant="outline" onClick={keepLocalInput}>내 입력 유지</Button>
                            </div>
                        ) : null}
                    </AlertDescription>
                </Alert>
            ) : null}
        </>
    );

    return (
        <>
            <ServiceRecordWizard
                data-component={ADMIN_WIZARD_COMPONENT}
                screen={screen}
                phone=""
                phoneError={null}
                context={activeContext}
                header={header}
                day={displayDay}
                pageIdx={pageIdx}
                draft={draft}
                editing={Boolean(currentSession || hasPlannedSession)}
                readOnly={formReadOnly}
                adminMode
                changedSessionIndexes={changedSessionIndexes}
                clientSignature={currentSession?.clientSignature ?? null}
                busy={isSaving || dateMoveBusy}
                isRecordFinalized={false}
                lockedDays={lockedDays}
                nextOpenDay={nextOpenDay}
                scheduleChangeBusy={false}
                hasServiceDateMismatch={false}
                defaultDate={defaultDate}
                onPhoneChange={() => undefined}
                onSubmitPhone={() => undefined}
                onBack={goBack}
                onHeaderChange={onHeaderChange}
                onDeliveryTypeChange={(value) => onHeaderChange("deliveryType", value)}
                onSaveHeader={onSaveHeader}
                onOpenDay={openDay}
                onOpenScheduleChangePreview={() => undefined}
                onOpenServiceDateEditor={openDateDialog}
                onServiceDateChange={onServiceDateChange}
                onFieldChange={onFieldChange}
                onToggleMulti={onToggleMulti}
                onSignatureChange={() => undefined}
                onNextPage={goNextPage}
                onOpenSubmitModal={() => { void persistDraft(); }}
                onEditSection={setPageIdx}
                slots={{
                    provider: ({ "data-component": dataComponent }) => (
                        <span data-component={dataComponent} data-slot="provider" className="org">
                            {activeDraft && !selectedSupplemental ? "관리자 편집" : "관리자 조회"}
                        </span>
                    ),
                    signature: (signatureProps) => <ReadOnlySignature {...signatureProps} />,
                    serviceDateDisplay: renderAdminDateDisplay,
                    serviceDateEditor: ({
                        "data-component": dataComponent,
                        serviceDate,
                        disabled,
                        onOpen,
                    }) => (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-component={dataComponent}
                            data-slot="date-editor"
                            disabled={disabled || dateMoveBusy}
                            onClick={onOpen}
                        >
                            {dateOnly(serviceDate)
                                ? `${formatShortDate(dateOnly(serviceDate))} · 제공일 변경`
                                : "제공일 선택"}
                        </Button>
                    ),
                    adminToolbar,
                    adminConfirmAction,
                    overviewSupplemental: supplementalSessions.length > 0 ? (
                        <div
                            data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_supplemental`}
                            data-slot="supplemental"
                            className="overview-supplemental"
                        >
                            <p data-slot="supplemental-title" className="supplemental-title">같은 회차의 추가 기록</p>
                            {supplementalSessions.map((item) => (
                                <button
                                    type="button"
                                    key={item.key}
                                    data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_supplemental_item-${item.key}`}
                                    data-slot="supplemental-item"
                                    className="supplemental-item"
                                    onClick={() => openSupplemental(item.key)}
                                >
                                    <span>{item.sessionIndex}회차 · {item.sourceLabel}</span>
                                    <span>{formatShortDate(item.session.serviceDate)}</span>
                                </button>
                            ))}
                        </div>
                    ) : null,
                }}
            />
            <TwoButtonModal
                open={discardModalOpen}
                onOpenChange={setDiscardModalOpen}
                title="초안을 취소할까요?"
                description="저장된 초안과 저장하지 않은 관리자 입력이 취소됩니다. 원본 제공기록은 변경되지 않습니다."
                approvalLabel="초안 취소"
                pendingLabel="취소 중…"
                approvalVariant="destructive"
                isPending={discarding}
                onApprove={() => { void discardCurrentDraft(); }}
                data-component={`${ADMIN_WIZARD_COMPONENT}_discard-modal`}
            />
            <ServiceRecordDateSelectionDialog
                open={dateDialogOpen}
                onOpenChange={handleDateDialogOpenChange}
                currentServiceDate={currentDateForSession(displayDay)}
                selectedServiceDate={pendingDateMove?.sessionIndex === displayDay ? pendingDateMove.toDate : null}
                sessionLabel={`${displayDay}회차`}
                onApply={(nextDate) => { void applyDateMove(nextDate); }}
                error={dateMoveError}
                onReloadLatest={draftError?.latestState ? reloadLatestDraft : undefined}
                busy={dateMoveBusy}
                disabled={!activeDraft || Boolean(selectedSupplemental)}
                data-component={`${ADMIN_WIZARD_COMPONENT}_date-selection-dialog`}
            />
            <ServiceRecordEditPreviewDialog
                open={previewDialogOpen}
                onOpenChange={setPreviewDialogOpen}
                preview={preview}
                busy={previewBusy}
                error={previewError}
                onConfirm={confirmPreview}
                confirmBusy={confirmBusy}
                confirmError={confirmError}
                confirmResult={confirmResult}
                onRefresh={refreshPreview}
                data-component={`${ADMIN_WIZARD_COMPONENT}_preview-dialog`}
            />
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

        void fetch(`/api/admin/service-records/client/${encodeURIComponent(clientId)}/editor`, {
            cache: "no-store",
            signal: controller.signal,
        })
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
                    if (alive) setState({ kind: "ready", clientId, overview, draftState, draftErrorStatus: null });
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
