/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
    DAY_PAGES,
    ServiceRecordWizard,
    formatShortDate,
    isServiceRecordHeaderComplete,
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
import { publishServiceRecordRevisionSync } from "@/features/service-records/revision-sync";

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
            <p data-slot="sign-note" className="sign-note">실제 서명 시각과 서명 원본입니다.</p>
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
    const [draftState, setDraftState] = useState(initialDraftState);
    const [sourceIdentity, setSourceIdentity] = useState(initialDraftState);
    const [recoveryChanges, setRecoveryChanges] = useState<AdminServiceRecordEditChanges | null>(
        initialDraftState?.draft?.status === "ACTIVE" && hasDraftChanges(initialDraftState.draft.changes) ? initialDraftState.draft.changes : null,
    );
    const displayContext = overlayChanges(baseView, recoveryChanges);
    const [headerDraft, setHeaderDraft] = useState<Record<string, string>>(headerToInput(displayContext.header));
    const [recoveryPreview, setRecoveryPreview] = useState<ServiceRecordEditPreviewResponse | null>(null);
    const [recoveryOpen, setRecoveryOpen] = useState(false);
    const [screen, setScreen] = useState<"overview" | "day" | "service">("overview");
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(DAY_PAGES.length - 1);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [supplementalKey, setSupplementalKey] = useState<string | null>(null);
    const [dateMove, setDateMove] = useState<AdminServiceRecordEditDateMove | null>(null);
    const [collision, setCollision] = useState<{ date: string; delta: number } | null>(null);
    const [dateDialogOpen, setDateDialogOpen] = useState(false);
    const [discardModalOpen, setDiscardModalOpen] = useState(false);
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(initialDraftErrorStatus ? draftErrorMessage(initialDraftErrorStatus) : null);
    const [dateError, setDateError] = useState<string | null>(null);
    const [needsReload, setNeedsReload] = useState(!initialDraftState?.sourceFingerprint);
    const [saved, setSaved] = useState(false);
    const saving = useRef(false);
    const prepared = useRef<{ draftId: string; draftVersion: number; previewId: string; idempotencyKey: string } | null>(null);
    // Once a save request starts, preserve this session until success or explicit discard.
    const [saveStarted, setSaveStarted] = useState(false);
    const supplemental = baseView.supplementalSessions.find((item) => item.key === supplementalKey);
    const currentSession = supplemental?.session ?? displayContext.sessions.find((item) => item.sessionIndex === day);
    const sourceDraft = draftForSession(currentSession);
    const sourceDate = dateOnly(currentSession?.serviceDate)
        || baseView.plannedSessions.find((item) => item.sessionIndex === day)?.serviceDate || "";
    const activeDraft = draftState?.draft?.status === "ACTIVE" ? draftState.draft : null;
    const priorChanges = Boolean(recoveryChanges);
    const patch: AdminServiceRecordEditSessionChanges = { sessionIndex: day };
    for (const [key, value] of Object.entries(draft)) {
        if (key === "_date" || JSON.stringify(value) === JSON.stringify(sourceDraft[key])) continue;
        if (key === "etcService" || key === "notes") patch[key] = String(value ?? "");
        else if (key === "paymentConfirmed") patch.paymentConfirmed = Boolean(value);
        else patch.answers = { ...patch.answers, [key]: value };
    }
    const headerPatch: AdminServiceRecordEditHeaderChanges = {};
    for (const key of ["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"] as const) {
        if ((headerDraft[key] ?? "") !== (headerToInput(baseView.context.header)[key] ?? "")) headerPatch[key] = headerDraft[key] ?? "";
    }
    const editingHeader = screen === "service";
    const changed = !priorChanges && !supplemental && (editingHeader
        ? Object.keys(headerPatch).length > 0 : Object.keys(patch).length > 1 || Boolean(dateMove));
    const locked = busy || saveStarted || needsReload || priorChanges || Boolean(supplemental);
    const vector = baseView.plannedSessions.map((entry) => ({
        ...entry,
        serviceDate: dateOnly(baseView.context.sessions.find((item) => item.sessionIndex === entry.sessionIndex)?.serviceDate) || entry.serviceDate,
    }));
    const resetLocal = () => {
        setScreen("overview");
        setDateMove(null);
        setCollision(null);
        setError(null);
        setDateError(null);
        setDraft({});
        setSupplementalKey(null);
        setSaveStarted(false);
        setSaved(false);
        prepared.current = null;
    };
    const openDay = (index: number) => {
        if (busy || saveStarted) return;
        setDay(index);
        setPageIdx(DAY_PAGES.length - 1);
        setDraft(draftForSession(displayContext.sessions.find((item) => item.sessionIndex === index)));
        setSupplementalKey(null);
        setDateMove(null);
        setError(null);
        setSaved(false);
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
        setDraftState(state);
        setSourceIdentity(state);
        setRecoveryChanges(state.draft?.status === "ACTIVE" && hasDraftChanges(state.draft.changes) ? state.draft.changes : null);
        setRecoveryOpen(false);
        setRecoveryPreview(null);
        setNeedsReload(false);
        resetLocal();
    };
    const reload = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try { await refresh(); }
        catch { setError("최신 기록을 불러오지 못했습니다. 다시 불러와 주세요."); }
        finally { saving.current = false; setBusy(false); }
    };
    const applyDate = (next: string, shiftFollowing: boolean) => {
        try {
            const result = moveServiceRecordSessionDate(vector, day, next, shiftFollowing);
            setDateMove(next === sourceDate ? null : { sessionIndex: day, toDate: next, shiftFollowing });
            setDraft((current) => ({ ...current, _date: next }));
            setCollision(null);
            setDateDialogOpen(false);
            setDateError(null);
            return result;
        } catch {
            setDateError("앞 회차보다 늦은 영업일을 선택해 주세요. 회차 순서와 예정일을 확인해 주세요.");
            setCollision(null);
            return null;
        }
    };
    const selectDate = (next: string) => {
        if (locked || baseView.scheduleProjectionBlockingReasons.length) return;
        const nextSession = vector.find((item) => item.sessionIndex === day + 1);
        if (nextSession && next >= nextSession.serviceDate) {
            try {
                const result = moveServiceRecordSessionDate(vector, day, next, true);
                setCollision({ date: next, delta: result.deltaBusinessDays });
                setDateDialogOpen(false);
            } catch { setDateError("회차 순서와 제공일을 확인해 주세요."); }
        } else applyDate(next, false);
    };
    const confirm = async (recover = false) => {
        if (saving.current || supplemental || (priorChanges && saveStarted && !recover)) return;
        if (priorChanges && !recover) { resetLocal(); return; }
        if (!recover && !changed && !saveStarted) { resetLocal(); return; }
        if (needsReload) return;
        if (!recover && editingHeader && !isServiceRecordHeaderComplete(headerDraft)) {
            setError("필수 기본정보를 모두 입력해 주세요.");
            return;
        }
        saving.current = true;
        setBusy(true);
        setError(null);
        setSaveStarted(true);
        try {
            let request = prepared.current;
            if (!request) {
                if (recover) throw new Error("이전 수정사항을 다시 검토해 주세요.");
                let state = draftState;
                if (!state?.draft || state.draft.status !== "ACTIVE") {
                    state = await adminServiceRecordEditApi.startDraft(clientId);
                    setDraftState(state);
                    if (state.draft && hasDraftChanges(state.draft.changes)) {
                        setNeedsReload(true);
                        throw new Error("다른 수정사항이 있습니다. 최신 기록을 불러와 확인해 주세요.");
                    }
                }
                if (!sameSource(sourceIdentity, state) || state?.sourceChanged
                    || state?.draft?.sourceFingerprint !== sourceIdentity?.sourceFingerprint
                    || state?.draft?.sourceCaseVersion !== sourceIdentity?.sourceCaseVersion) {
                    setNeedsReload(true);
                    throw new Error("기록이 변경되었습니다. 입력은 보관되어 있습니다. 최신 기록을 다시 불러와 주세요.");
                }
                if (!state?.draft || state.draft.status !== "ACTIVE") throw new Error("수정을 시작하지 못했습니다.");
                state = await adminServiceRecordEditApi.updateDraft(
                    state.draft.id, state.draft.draftVersion,
                    editingHeader ? { header: headerPatch } : { sessions: [patch] }, dateMove ?? undefined,
                );
                setDraftState(state);
                if (!state.draft || state.draft.status !== "ACTIVE") throw new Error("수정 내용을 저장하지 못했습니다.");
                const preview = await adminServiceRecordEditApi.previewDraft(state.draft.id, state.draft.draftVersion);
                if (preview.blockingReasons.length) throw new Error(preview.blockingReasons.map((reason) => reason.message).join(" "));
                if (preview.draftId !== state.draft.id || preview.draftVersion !== state.draft.draftVersion) {
                    setNeedsReload(true);
                    throw new Error("기록이 변경되었습니다. 최신 기록을 다시 불러와 주세요.");
                }
                if (dateMove && (preview.before.sessions.length !== vector.length || preview.before.sessions.some((entry) =>
                    vector.find((item) => item.sessionIndex === entry.sessionIndex)?.serviceDate !== entry.serviceDate))) {
                    setNeedsReload(true);
                    throw new Error("예정일이 변경되었습니다. 최신 기록을 다시 불러와 날짜 이동을 확인해 주세요.");
                }
                // Never confirm a header or another session's content as a side effect.
                const allowedDateIndexes = new Set(dateMove
                    ? preview.before.sessions.filter((entry) => entry.sessionIndex === day || (dateMove.shiftFollowing && entry.sessionIndex > day)).map((entry) => entry.sessionIndex)
                    : []);
                const foreignContent = state.draft.changes.sessions?.some((entry) => entry.sessionIndex !== day
                    && Object.keys(entry).some((key) => key !== "sessionIndex" && key !== "serviceDate"));
                if (editingHeader
                    ? Boolean(state.draft.changes.sessions?.length || preview.contentChanges.changedSessionIndexes.length)
                    : foreignContent || preview.contentChanges.headerChanged || Boolean(state.draft.changes.header && Object.keys(state.draft.changes.header).length)
                        || preview.contentChanges.changedSessionIndexes.some((index) => index !== day && !allowedDateIndexes.has(index))) {
                    setNeedsReload(true);
                    throw new Error("다른 회차의 수정사항이 있습니다. 최신 기록을 불러와 확인해 주세요.");
                }
                const expectedDates = dateMove
                    ? moveServiceRecordSessionDate(preview.before.sessions, day, dateMove.toDate, Boolean(dateMove.shiftFollowing)).entries
                    : preview.before.sessions;
                const unexpectedDates = preview.after.sessions.length !== expectedDates.length
                    || new Set(preview.after.sessions.map((entry) => entry.sessionIndex)).size !== expectedDates.length
                    || preview.after.sessions.some((entry) => expectedDates.find((item) => item.sessionIndex === entry.sessionIndex)?.serviceDate !== entry.serviceDate);
                if (unexpectedDates) { setNeedsReload(true); throw new Error("예정일이 변경되었습니다. 최신 기록을 다시 불러와 주세요."); }
                request = { draftId: state.draft.id, draftVersion: state.draft.draftVersion, previewId: preview.previewId, idempotencyKey: createIdempotencyKey() };
                prepared.current = request;
            }
            const result = await adminServiceRecordEditApi.confirmDraft(request.draftId, request.draftVersion, request.previewId, request.idempotencyKey);
            setSaved(true);
            setNeedsReload(true);
            publishServiceRecordRevisionSync({ caseId: result.caseId, caseVersion: result.caseVersion });
            try { await refresh(); }
            catch { setError("수정은 저장되었습니다. 최신 기록을 다시 불러와 주세요."); }
        } catch (failure) {
            // An uncertain PATCH is recovered by reloading its durable draft,
            // not by submitting an obsolete draft version again.
            if (!prepared.current) setNeedsReload(true);
            if (failure instanceof AdminServiceRecordEditApiError) {
                if (failure.status === 409) setNeedsReload(true);
                setError(failure.status === 409 ? "기록이 변경되었습니다. 입력은 보관되어 있습니다. 최신 기록을 다시 불러와 주세요."
                    : failure.status === 403 ? "수정 권한이 없습니다. 입력은 보관되어 있습니다."
                    : failure.status === 401 ? "로그인이 필요합니다. 입력은 보관되어 있습니다."
                    : prepared.current ? "저장 결과를 확인하지 못했습니다. 수정 확인을 다시 눌러 주세요." : "저장 결과를 확인하지 못했습니다. 입력은 보관되어 있습니다. 최신 기록을 불러와 이전 수정사항을 검토해 주세요.");
            } else setError(failure instanceof Error && /[가-힣]/.test(failure.message) ? failure.message
                : prepared.current ? "저장 결과를 확인하지 못했습니다. 수정 확인을 다시 눌러 주세요." : "저장 결과를 확인하지 못했습니다. 입력은 보관되어 있습니다. 최신 기록을 불러와 이전 수정사항을 검토해 주세요.");
        } finally { saving.current = false; setBusy(false); }
    };
    const openRecovery = async () => {
        if (saving.current || !activeDraft) return;
        if (prepared.current) { setRecoveryOpen(true); return; }
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            const state = await adminServiceRecordEditApi.getDraft(clientId);
            if (!sameSource(sourceIdentity, state) || state.sourceChanged
                || state.draft?.id !== activeDraft.id || state.draft.draftVersion !== activeDraft.draftVersion
                || JSON.stringify(state.draft.changes) !== JSON.stringify(recoveryChanges)) {
                setNeedsReload(true);
                throw new Error("기록이 변경되었습니다. 최신 기록을 불러와 이전 수정사항을 다시 확인해 주세요.");
            }
            const preview = await adminServiceRecordEditApi.previewDraft(activeDraft.id, activeDraft.draftVersion);
            if (preview.draftId !== activeDraft.id || preview.draftVersion !== activeDraft.draftVersion
                || preview.sourceFingerprint !== sourceIdentity?.sourceFingerprint
                || preview.sourceCaseVersion !== sourceIdentity?.sourceCaseVersion) {
                setNeedsReload(true);
                throw new Error("기록이 변경되었습니다. 최신 기록을 다시 불러와 주세요.");
            }
            setRecoveryPreview(preview);
            setRecoveryOpen(true);
            if (!preview.blockingReasons.length) prepared.current = {
                draftId: activeDraft.id, draftVersion: activeDraft.draftVersion,
                previewId: preview.previewId, idempotencyKey: createIdempotencyKey(),
            };
        } catch (failure) {
            setError(failure instanceof Error && /[가-힣]/.test(failure.message) ? failure.message : "이전 수정사항을 불러오지 못했습니다. 다시 검토해 주세요.");
        } finally { saving.current = false; setBusy(false); }
    };
    const discard = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
            if (activeDraft) setDraftState(await adminServiceRecordEditApi.discardDraft(activeDraft.id, activeDraft.draftVersion));
            setDiscardModalOpen(false);
            await refresh();
        } catch { setError("이전 수정사항을 취소하지 못했습니다. 최신 기록을 다시 불러와 주세요."); setNeedsReload(true); }
        finally { saving.current = false; setBusy(false); }
    };
    const back = () => {
        if (busy || saveStarted) return;
        if (changed) setLeaveModalOpen(true);
        else resetLocal();
    };
    return (
        <>
            {error || priorChanges || needsReload ? (
                <Alert data-component={`${ADMIN_WIZARD_COMPONENT}_save-error`} variant="warning">
                    <AlertTitle>{saved ? "수정 저장 완료" : priorChanges ? "이전 수정사항이 있습니다" : "수정 확인 필요"}</AlertTitle>
                    <AlertDescription>
                        <p>{error ?? (priorChanges ? "화면에 이전 수정사항이 반영되어 있습니다. 회차와 기본정보를 확인한 뒤 전체 변경을 검토·확정하거나 취소해 주세요." : "수정 기준을 확인할 수 없습니다. 최신 기록을 다시 불러와 주세요.")}</p>
                        {priorChanges ? <Button data-component={`${ADMIN_WIZARD_COMPONENT}_save-error_review`} type="button" disabled={busy || needsReload} onClick={() => void openRecovery()}>이전 수정사항 검토</Button> : null}
                        {(priorChanges || (saveStarted && !prepared.current && !saved)) && activeDraft ? (
                            <Button data-component={`${ADMIN_WIZARD_COMPONENT}_save-error_discard`} type="button" disabled={busy} onClick={() => setDiscardModalOpen(true)}>이전 수정사항 취소</Button>
                        ) : null}
                        {needsReload ? <Button data-component={`${ADMIN_WIZARD_COMPONENT}_save-error_reload`} type="button" disabled={busy} onClick={() => void reload()}>최신 기록 불러오기</Button> : null}
                    </AlertDescription>
                </Alert>
            ) : null}
            {baseView.scheduleProjectionBlockingReasons.length ? (
                <Alert data-component={`${ADMIN_WIZARD_COMPONENT}_schedule-blocked`} variant="warning">
                    <AlertTitle>제공일 수정 불가</AlertTitle>
                    <AlertDescription>{baseView.scheduleProjectionBlockingReasons.map((reason) => reason.message).join(" ")}</AlertDescription>
                </Alert>
            ) : null}
            <ServiceRecordWizard
                data-component={ADMIN_WIZARD_COMPONENT}
                screen={screen} phone="" phoneError={null}
                context={supplemental ? { ...baseView.context, sessions: [...baseView.context.sessions.filter((item) => item.sessionIndex !== day), supplemental.session] } : displayContext}
                header={screen === "service" ? headerDraft : headerToInput(displayContext.header)}
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
                onSaveHeader={() => void confirm()} onOpenDay={openDay} onOpenScheduleChangePreview={() => undefined}
                onOpenServiceDateEditor={() => { if (!locked && !baseView.scheduleProjectionBlockingReasons.length) { setDateError(null); setDateDialogOpen(true); } }}
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
                onOpenSubmitModal={() => void confirm()} onEditSection={setPageIdx}
                slots={{
                    provider: ({ "data-component": component }) => <span data-component={component} data-slot="provider" className="org">관리자 {supplemental ? "조회" : "편집"}</span>,
                    signature: (props) => <ReadOnlySignature {...props} />,
                    adminConfirmAction: (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_overview_header-edit`} type="button" variant="outline" disabled={busy || saveStarted}
                            onClick={() => { setHeaderDraft(headerToInput(displayContext.header)); setScreen("service"); }}>
                            {priorChanges ? "기본정보 확인" : "기본정보 수정"}
                        </Button>
                    ),
                    adminHeaderAction: ({ isHeaderComplete }) => (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_header-confirm`} type="button" className="btn submit"
                            disabled={busy || (changed && (needsReload || !isHeaderComplete))} onClick={() => priorChanges || !changed && !saveStarted ? resetLocal() : void confirm()}>
                            {busy ? "저장 중…" : changed || saveStarted ? "수정 확인" : "확인"}
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
                        <Button data-component={component} type="button" size="sm" variant="outline" disabled={disabled || Boolean(baseView.scheduleProjectionBlockingReasons.length)} onClick={onOpen}>수정</Button>
                    ),
                    adminSessionAction: (
                        <Button data-component={`${ADMIN_WIZARD_COMPONENT}_body_confirmation-action_confirm`} type="button" className="btn submit"
                            disabled={busy || (priorChanges && saveStarted) || (needsReload && (changed || saveStarted))}
                            onClick={() => supplemental ? resetLocal() : void confirm()}>
                            {busy ? "저장 중…" : changed || saveStarted ? "수정 확인" : "확인"}
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
            <ServiceRecordEditPreviewDialog open={recoveryOpen} onOpenChange={(open) => { if (!busy) setRecoveryOpen(open); }}
                preview={recoveryPreview} onConfirm={needsReload || !prepared.current ? undefined : () => confirm(true)}
                confirmBusy={busy} confirmError={error} data-component={`${ADMIN_WIZARD_COMPONENT}_recovery-preview`} />
            <ServiceRecordDateSelectionDialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}
                currentServiceDate={String(draft._date || sourceDate)} sessionLabel={`${day}회차`}
                onApply={selectDate} error={dateError} disabled={locked}
                data-component={`${ADMIN_WIZARD_COMPONENT}_date-selection-dialog`} />
            <TwoButtonModal open={Boolean(collision)} onOpenChange={(open) => { if (!open) { setCollision(null); setDateDialogOpen(true); } }}
                title="서비스 제공일 수정" size="detail" isDescriptionVisuallyHidden={false}
                description={collision ? `${day}회차 서비스 제공일을 ${Number(collision.date.slice(5, 7))}월 ${Number(collision.date.slice(8, 10))}일로 수정하면 다음 회차와 날짜가 겹칩니다. 뒷 회차들의 서비스 제공일도 ${collision.delta} 영업일씩 수정할까요?` : ""}
                approvalLabel="수정" onApprove={() => { if (collision) applyDate(collision.date, true); }}
                data-component={`${ADMIN_WIZARD_COMPONENT}_date-collision-modal`} />
            <TwoButtonModal open={leaveModalOpen} onOpenChange={setLeaveModalOpen}
                title="수정사항을 취소할까요?" description="확정하지 않은 이 회차의 수정사항이 취소됩니다."
                approvalLabel="나가기" onApprove={() => { setLeaveModalOpen(false); resetLocal(); }}
                data-component={`${ADMIN_WIZARD_COMPONENT}_leave-modal`} />
            <TwoButtonModal open={discardModalOpen} onOpenChange={setDiscardModalOpen}
                title="이전 수정사항을 취소할까요?" description="확정하지 않은 기존 수정사항을 취소합니다. 확정된 기록은 그대로 유지됩니다."
                approvalLabel="수정 취소" isPending={busy} onApprove={() => void discard()}
                data-component={`${ADMIN_WIZARD_COMPONENT}_discard-modal`} />
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
