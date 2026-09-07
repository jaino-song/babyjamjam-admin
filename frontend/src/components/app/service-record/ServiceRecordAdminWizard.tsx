/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
    DAY_PAGES,
    ServiceRecordWizard,
    formatShortDate,
} from "@babyjamjam/service-record-ui";
import type {
    ServiceRecordContext,
    SignatureSlotProps,
} from "@babyjamjam/service-record-ui";

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
    const totalSessions = recordTotalSessions
        ?? (assignmentTotalSessions > 0 ? assignmentTotalSessions : observedSessionMax);
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
            <p data-slot="sign-note" className="sign-note">관리자 조회 전용</p>
        </div>
    );
}

export interface ServiceRecordAdminWizardProps {
    overview: AdminServiceRecordEditorOverview;
}

export function ServiceRecordAdminWizard({ overview }: ServiceRecordAdminWizardProps) {
    const view = useMemo(() => buildAdminServiceRecordView(overview), [overview]);
    const context = view.context;
    const supplementalSessions = view.supplementalSessions;
    const header = useMemo(() => headerToInput(context.header), [context.header]);
    const [screen, setScreen] = useState<"overview" | "day">("overview");
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [selectedSupplementalKey, setSelectedSupplementalKey] = useState<string | null>(null);

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
    const lockedDays = useMemo(
        () => new Set(
            activeContext.sessions
                .filter((session) => session.locked || Boolean(session.submittedAt) || session.hasMomApproval)
                .map((session) => session.sessionIndex),
        ),
        [activeContext.sessions],
    );
    const nextOpenDay = useCallback(() => {
        for (let sessionIndex = 1; sessionIndex <= context.totalSessions; sessionIndex += 1) {
            if (!lockedDays.has(sessionIndex)) return sessionIndex;
        }
        return context.totalSessions || 1;
    }, [context.totalSessions, lockedDays]);
    const defaultDate = useCallback(
        (sessionIndex: number) => activeContext.sessions.find((session) => session.sessionIndex === sessionIndex)?.serviceDate ?? "",
        [activeContext.sessions],
    );
    const openDay = useCallback((sessionIndex: number) => {
        const bounded = Math.min(Math.max(sessionIndex, 1), Math.max(context.totalSessions, 1));
        const session = activeContext.sessions.find((row) => row.sessionIndex === bounded);
        setSelectedSupplementalKey(null);
        setDay(bounded);
        setPageIdx(0);
        setDraft(draftForSession(session));
        setScreen("day");
    }, [activeContext.sessions, context.totalSessions]);
    const goBack = useCallback(() => {
        if (screen === "day") {
            setSelectedSupplementalKey(null);
            setScreen("overview");
        }
    }, [screen]);
    const goNextPage = useCallback(() => {
        setPageIdx((current) => Math.min(current + 1, DAY_PAGES.length - 1));
    }, []);

    return (
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
            editing={Boolean(currentSession)}
            readOnly
            clientSignature={currentSession?.clientSignature ?? null}
            busy={false}
            isRecordFinalized={false}
            lockedDays={lockedDays}
            nextOpenDay={nextOpenDay}
            scheduleChangeBusy={false}
            hasServiceDateMismatch={false}
            defaultDate={defaultDate}
            onPhoneChange={() => undefined}
            onSubmitPhone={() => undefined}
            onBack={goBack}
            onHeaderChange={() => undefined}
            onDeliveryTypeChange={() => undefined}
            onSaveHeader={() => undefined}
            onOpenDay={openDay}
            onOpenScheduleChangePreview={() => undefined}
            onServiceDateChange={() => undefined}
            onFieldChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onToggleMulti={() => undefined}
            onSignatureChange={() => undefined}
            onNextPage={goNextPage}
            onOpenSubmitModal={() => undefined}
            onEditSection={setPageIdx}
            slots={{
                provider: ({ "data-component": dataComponent }) => (
                    <span data-component={dataComponent} data-slot="provider" className="org">관리자 조회 전용</span>
                ),
                signature: (signatureProps) => <ReadOnlySignature {...signatureProps} />,
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
                                onClick={() => {
                                    setSelectedSupplementalKey(item.key);
                                    setDay(item.sessionIndex);
                                    setPageIdx(0);
                                    setDraft(draftForSession(item.session));
                                    setScreen("day");
                                }}
                            >
                                <span>{item.sessionIndex}회차 · {item.sourceLabel}</span>
                                <span>{formatShortDate(item.session.serviceDate)}</span>
                            </button>
                        ))}
                    </div>
                ) : null,
            }}
        />
    );
}

type ViewerState =
    | { kind: "loading"; clientId: string }
    | { kind: "ready"; clientId: string; overview: AdminServiceRecordEditorOverview }
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
                setState(overview
                    ? { kind: "ready", clientId, overview }
                    : { kind: "error", clientId, status: 500 });
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
    return <ServiceRecordAdminWizard overview={visibleState.overview} />;
}
