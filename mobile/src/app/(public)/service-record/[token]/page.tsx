"use client";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
    DAY_PAGES,
    DEFAULT_DAILY_ANSWERS,
    formatMonthDayKo,
} from "@babyjamjam/service-record-ui";
import type {
    ScheduleChangePreview,
    ServiceRecordContext,
} from "@babyjamjam/service-record-ui";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { MobileServiceRecordWizard } from "@/components/app/service-record/ServiceRecordWizard";
import { isBusinessDayKr, isoDateInKorea, nextBusinessDayKr } from "@/lib/date/business-days";
import {
    getServiceDateShiftBusinessDays,
    isServiceDateMismatch,
} from "@/lib/service-records/page-helpers";
import {
    captureServiceRecordError,
    captureServiceRecordResponseError,
    getServiceRecordOperation,
} from "@/lib/observability/capture-service-record-error";

const MOM_APPROVAL_APPROVED = "approved";
const DRAFT_STORAGE_PREFIX = "daily-service-record-draft";
const FINALIZED_RECORD_STATUSES = new Set([
    "FINALIZING",
    "DOCUMENTS_CREATED",
    "COMPLETED",
    "FINALIZATION_FAILED",
]);

/* ───────────────────────── helpers ───────────────────────── */

interface StoredFormState {
    header?: Record<string, string>;
    day?: number;
    pageIdx?: number;
    draft?: Record<string, unknown>;
}
const draftStorageKey = (token: string) => `${DRAFT_STORAGE_PREFIX}:${token}`;
const readStoredFormState = (token: string): StoredFormState | null => {
    if (typeof window === "undefined" || !token) return null;
    try {
        const raw = window.sessionStorage.getItem(draftStorageKey(token));
        return raw ? JSON.parse(raw) as StoredFormState : null;
    } catch {
        return null;
    }
};
const writeStoredFormState = (token: string, value: StoredFormState) => {
    if (typeof window === "undefined" || !token) return;
    try {
        window.sessionStorage.setItem(draftStorageKey(token), JSON.stringify(value));
    } catch {
        // The form remains usable when session storage is unavailable.
    }
};
const clearStoredFormState = (token: string) => {
    if (typeof window === "undefined" || !token) return;
    try {
        window.sessionStorage.removeItem(draftStorageKey(token));
    } catch {
        // Ignore storage cleanup failures after a successful server submission.
    }
};

function isRecordFinalizedStatus(recordStatus?: string | null): boolean {
    return Boolean(recordStatus && FINALIZED_RECORD_STATUSES.has(recordStatus));
}

type Screen = "loading" | "invalid" | "phone" | "service" | "overview" | "day" | "done";
type HistoryMode = "none" | "push" | "replace";

interface WizardHistoryTarget {
    screen: "phone" | "service" | "overview" | "day" | "done";
    day?: number;
    pageIdx?: number;
}

const HISTORY_SCREENS = new Set<WizardHistoryTarget["screen"]>([
    "phone",
    "service",
    "overview",
    "day",
    "done",
]);

function writeWizardHistory(
    screen: Screen,
    mode: Exclude<HistoryMode, "none">,
    day?: number,
    pageIdx?: number,
): void {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    if (HISTORY_SCREENS.has(screen as WizardHistoryTarget["screen"])) {
        url.searchParams.set("step", screen);
    } else {
        url.searchParams.delete("step");
    }
    if (screen === "day" && day !== undefined && pageIdx !== undefined) {
        url.searchParams.set("day", String(day));
        url.searchParams.set("page", String(pageIdx));
    } else {
        url.searchParams.delete("day");
        url.searchParams.delete("page");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (mode === "push") window.history.pushState(null, "", nextUrl);
    else window.history.replaceState(null, "", nextUrl);
}

function readWizardHistory(): WizardHistoryTarget | null {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const screen = params.get("step");
    if (!screen || !HISTORY_SCREENS.has(screen as WizardHistoryTarget["screen"])) return null;
    if (screen !== "day") return { screen: screen as WizardHistoryTarget["screen"] };

    const rawDay = params.get("day");
    const rawPageIdx = params.get("page");
    if (rawDay === null || rawPageIdx === null) return null;

    const day = Number(rawDay);
    const pageIdx = Number(rawPageIdx);
    if (!Number.isInteger(day) || !Number.isInteger(pageIdx)) return null;
    return { screen: "day", day, pageIdx };
}

export default function ServiceRecordPage() {
    const params = useParams<{ token: string }>();
    const token = params?.token ?? "";

    const [screen, setScreen] = useState<Screen>("loading");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [ctx, setCtx] = useState<ServiceRecordContext | null>(null);
    const [header, setHeader] = useState<Record<string, string>>({ deliveryType: "자연분만" });
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [editing, setEditing] = useState(false);
    const [clientSignature, setMomSignature] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [submitModalOpen, setSubmitModalOpen] = useState(false);
    const [scheduleChangePreview, setScheduleChangePreview] = useState<ScheduleChangePreview | null>(null);
    const [scheduleChangeModalOpen, setScheduleChangeModalOpen] = useState(false);
    const [scheduleChangeBusy, setScheduleChangeBusy] = useState(false);
    const [errorNotificationMessage, setErrorNotificationMessage] = useState<string | null>(null);
    const [pendingServiceDate, setPendingServiceDate] = useState<{ next: string; shift: number } | null>(null);

    const navigateTo = useCallback((
        nextScreen: Screen,
        options: { mode?: HistoryMode; day?: number; pageIdx?: number } = {},
    ) => {
        setScreen(nextScreen);
        if (options.day !== undefined) setDay(options.day);
        if (options.pageIdx !== undefined) setPageIdx(options.pageIdx);
        if (options.mode && options.mode !== "none") {
            writeWizardHistory(nextScreen, options.mode, options.day, options.pageIdx);
        }
    }, []);

    const api = useCallback(
        async (
            path: string,
            init: RequestInit = {},
            includeJsonHeaders = true,
        ) => {
            const method = init.method ?? "GET";
            const monitoredPath = `/api/service-record/[Filtered]${path}`;
            const operation = getServiceRecordOperation(path);

            try {
                const url = `/api/service-record/${token}${path}`;
                const response = includeJsonHeaders
                    ? await fetch(url, {
                        ...init,
                        headers: {
                            "Content-Type": "application/json",
                            ...(init.headers ?? {}),
                        },
                    })
                    : await fetch(url);

                captureServiceRecordResponseError(response, {
                    operation,
                    method,
                    path: monitoredPath,
                });
                return response;
            } catch (error) {
                captureServiceRecordError(error, {
                    operation,
                    method,
                    path: monitoredPath,
                });
                throw error;
            }
        },
        [token],
    );

    const loadContext = useCallback(async (historyMode: HistoryMode = "replace") => {
        const res = await api("/context");
        if (!res.ok) {
            navigateTo(res.status === 401 || res.status === 403 ? "phone" : "invalid", { mode: historyMode });
            return;
        }
        const data: ServiceRecordContext = await res.json();
        const stored = readStoredFormState(token);
        const serverHeader = (data.header as Record<string, string>) ?? {};
        const nextHeader = data.header
            ? { deliveryType: "자연분만", ...serverHeader }
            : { deliveryType: "자연분만", ...(stored?.header ?? {}) };
        setCtx(data);
        setHeader(nextHeader);

        const submittedCount = data.sessions.filter((session) => session.locked).length;
        if (data.totalSessions > 0 && submittedCount === data.totalSessions) {
            clearStoredFormState(token);
            setEditing(false);
            setMomSignature(null);
            navigateTo("done", { mode: historyMode });
            return;
        }

        setEditing(false);
        setMomSignature(null);
        navigateTo(data.header ? "overview" : "service", { mode: historyMode });
    }, [api, navigateTo, token]);

    // Validate the public link first, then restore a previously verified browser session.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await api("/link", {}, false);
                const data = await res.json();
                if (!alive) return;
                if (!data?.valid) {
                    navigateTo("invalid", { mode: "replace" });
                    return;
                }
                await loadContext("replace");
            } catch {
                if (alive) navigateTo("invalid", { mode: "replace" });
            }
        })();
        return () => { alive = false; };
    }, [api, loadContext, navigateTo, token]);

    useEffect(() => {
        const handlePopState = () => {
            const target = readWizardHistory();
            if (!target) return;

            if (target.screen === "phone") {
                if (ctx?.header) navigateTo("overview", { mode: "replace" });
                else navigateTo("phone", { mode: "none" });
                return;
            }
            if (target.screen === "service") {
                if (ctx?.header) navigateTo("overview", { mode: "replace" });
                else navigateTo("service", { mode: "none" });
                return;
            }
            if (target.screen === "overview") {
                navigateTo(ctx?.header ? "overview" : "service", { mode: ctx?.header ? "none" : "replace" });
                return;
            }
            if (target.screen === "done") {
                navigateTo("done", { mode: "none" });
                return;
            }
            if (!ctx?.header || target.day === undefined || target.pageIdx === undefined) {
                navigateTo(ctx?.header ? "overview" : "service", { mode: "replace" });
                return;
            }

            const targetDay = Math.min(Math.max(target.day, 1), Math.max(ctx.totalSessions, 1));
            const targetPageIdx = Math.min(Math.max(target.pageIdx, 0), DAY_PAGES.length - 1);
            const session = ctx.sessions.find((row) => row.sessionIndex === targetDay);
            const isLockedSession = Boolean(session?.locked);
            setEditing(isLockedSession);
            setMomSignature(null);
            if (isLockedSession && session) {
                setDraft({
                    _date: session.serviceDate.slice(0, 10),
                    ...(session.answers ?? {}),
                    etcService: session.etcService ?? "",
                    notes: session.notes ?? "",
                    paymentConfirmed: Boolean(session.paymentConfirmed),
                });
            } else {
                const stored = readStoredFormState(token);
                if (stored?.day === targetDay && stored.draft) setDraft(stored.draft);
            }
            navigateTo("day", {
                mode: "none",
                day: targetDay,
                pageIdx: targetPageIdx,
            });
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [ctx, navigateTo, token]);

    const lockedDays = useMemo(() => new Set((ctx?.sessions ?? []).filter((s) => s.locked).map((s) => s.sessionIndex)), [ctx]);
    const nextOpenDay = useCallback(() => {
        let d = 1;
        while (lockedDays.has(d)) d++;
        return d;
    }, [lockedDays]);
    const plannedDateVectorValid = useMemo(() => {
        const plannedDates = ctx?.plannedSessionDates;
        if (plannedDates === undefined) return true;
        const isValidDateOnly = (value: string) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const [year, month, day] = value.split("-").map(Number);
            const parsed = new Date(Date.UTC(year, month - 1, day));
            return parsed.getUTCFullYear() === year
                && parsed.getUTCMonth() === month - 1
                && parsed.getUTCDate() === day;
        };
        return Array.isArray(plannedDates)
            && plannedDates.length === (ctx?.totalSessions ?? 0)
            && new Set(plannedDates.map((session) => session.sessionIndex)).size === plannedDates.length
            && new Set(plannedDates.map((session) => session.serviceDate)).size === plannedDates.length
            && plannedDates.every((session) => (
                Number.isSafeInteger(session.sessionIndex)
                && session.sessionIndex > 0
                && session.sessionIndex <= (ctx?.totalSessions ?? 0)
                && isValidDateOnly(session.serviceDate)
            ));
    }, [ctx?.plannedSessionDates, ctx?.totalSessions]);
    const defaultDate = useCallback(
        (d: number) => {
            if (ctx?.plannedSessionDates !== undefined) {
                if (!plannedDateVectorValid) return "";
                return ctx.plannedSessionDates.find((session) => session.sessionIndex === d)?.serviceDate ?? "";
            }
            const sessions = ctx?.sessions ?? [];
            const rawStart = ctx?.startDate ? ctx.startDate.slice(0, 10) : isoDateInKorea();
            const start = isBusinessDayKr(rawStart) ? rawStart : nextBusinessDayKr(rawStart);
            // Row-first recursive chain: an existing row's date (e.g. an approved
            // postpone) shifts every later default, not just the next session.
            const chain = (k: number): string => {
                const row = sessions.find((s) => s.sessionIndex === k);
                if (row) return row.serviceDate.slice(0, 10);
                if (k <= 1) return start;
                return nextBusinessDayKr(chain(k - 1));
            };
            return chain(d);
        },
        [ctx?.plannedSessionDates, ctx?.sessions, ctx?.startDate, plannedDateVectorValid],
    );

    async function submitPhone() {
        if (phone.replace(/\D/g, "").length < 10) { setPhoneError("휴대폰 번호를 입력해 주세요."); return; }
        setBusy(true); setPhoneError(null);
        try {
            const res = await api("/verify", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
            });
            const data = await res.json();
            if (data?.ok) {
                await loadContext("push");
            } else {
                setPhoneError("휴대폰 번호가 일치하지 않아요.");
            }
        } catch {
            setPhoneError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        } finally { setBusy(false); }
    }
    function handlePhoneChange(value: string) {
        const digits = value.replace(/\D/g, "").slice(0, 11);
        if (digits.length <= 3) setPhone(digits);
        else if (digits.length <= 7) setPhone(`${digits.slice(0, 3)}-${digits.slice(3)}`);
        else {
            const middleEnd = digits.length === 10 ? 6 : 7;
            setPhone(`${digits.slice(0, 3)}-${digits.slice(3, middleEnd)}-${digits.slice(middleEnd)}`);
        }
    }
    useEffect(() => {
        if (screen === "service") {
            writeStoredFormState(token, { ...(readStoredFormState(token) ?? {}), header });
            return;
        }
        if (screen === "day" && !editing) {
            writeStoredFormState(token, { header, day, pageIdx, draft });
        }
    }, [day, draft, editing, header, pageIdx, screen, token]);

    async function saveHeader() {
        setBusy(true);
        try {
            const response = await api("/header", { method: "PUT", body: JSON.stringify(header) });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                setErrorNotificationMessage(error?.message ?? "기본정보 저장에 실패했어요.");
                return;
            }
            clearStoredFormState(token);
            await loadContext("replace");
        } finally { setBusy(false); }
    }

    function openDay(d: number, editExisting = false) {
        const session = ctx?.sessions.find((row) => row.sessionIndex === d);
        const shouldEdit = editExisting || Boolean(session?.locked);
        if (shouldEdit && !session?.locked) return;
        if (!shouldEdit && d !== nextOpenDay()) return;

        setEditing(shouldEdit);
        setMomSignature(null);
        let initialPageIdx: number;
        if (shouldEdit && session) {
            initialPageIdx = DAY_PAGES.length - 1;
            setDraft({
                _date: session.serviceDate.slice(0, 10),
                ...(session.answers ?? {}),
                etcService: session.etcService ?? "",
                notes: session.notes ?? "",
                paymentConfirmed: Boolean(session.paymentConfirmed),
            });
        } else {
            const stored = readStoredFormState(token);
            const canRestoreDraft = stored?.day === d && Boolean(stored.draft);
            initialPageIdx = canRestoreDraft
                ? Math.min(Math.max(stored?.pageIdx ?? 0, 0), DAY_PAGES.length - 1)
                : 0;
            setDraft(canRestoreDraft && stored?.draft
                ? stored.draft
                : { _date: defaultDate(d), ...DEFAULT_DAILY_ANSWERS });
        }
        navigateTo("day", { mode: "push", day: d, pageIdx: initialPageIdx });
    }

    async function submitDay() {
        const serviceDate = (draft["_date"] as string) ?? defaultDate(day);
        setBusy(true);
        try {
            const currentSession = ctx?.sessions.find((session) => session.sessionIndex === day);
            const body = {
                serviceDate: editing ? currentSession?.serviceDate.slice(0, 10) ?? serviceDate : serviceDate,
                answers: Object.fromEntries(Object.entries(draft).filter(([k]) => !k.startsWith("_"))),
                etcService: (draft["etcService"] as string) ?? undefined,
                notes: (draft["notes"] as string) ?? undefined,
                paymentConfirmed: Boolean(draft["paymentConfirmed"]),
                momApproval: MOM_APPROVAL_APPROVED,
                ...(!currentSession?.clientSignature && clientSignature ? { clientSignature } : {}),
            };
            const res = await api(`/sessions/${day}/submit`, { method: "POST", body: JSON.stringify(body) });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                if (e?.code === "CLIENT_SIGNATURE_REQUIRED") {
                    setErrorNotificationMessage("산모 서명이 필요합니다.");
                } else if (e?.code === "SERVICE_DATE_IMMUTABLE") {
                    setErrorNotificationMessage(e?.message ?? "제공일자는 변경할 수 없어요.");
                } else {
                    setErrorNotificationMessage(e?.message ?? "제출에 실패했어요.");
                }
                return;
            }
            if (!editing) clearStoredFormState(token);
            setSubmitModalOpen(false);
            setEditing(false);
            setMomSignature(null);
            await loadContext("push");
        } finally { setBusy(false); }
    }

    async function openScheduleChangePreview() {
        setScheduleChangePreview(null);
        setScheduleChangeModalOpen(true);
        setScheduleChangeBusy(true);
        try {
            const res = await api("/schedule-change/preview");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setScheduleChangeModalOpen(false);
                setErrorNotificationMessage(data?.error ?? data?.message ?? "일정 변경 정보를 불러오지 못했습니다.");
                return;
            }
            setScheduleChangePreview(data as ScheduleChangePreview);
        } catch {
            setScheduleChangeModalOpen(false);
            setErrorNotificationMessage("일정 변경 정보를 불러오지 못했습니다.");
        } finally {
            setScheduleChangeBusy(false);
        }
    }

    function closeScheduleChangeModal() {
        if (scheduleChangeBusy) return;
        setScheduleChangeModalOpen(false);
        setScheduleChangePreview(null);
    }

    async function submitScheduleChangeRequest() {
        setScheduleChangeBusy(true);
        try {
            const res = await api("/schedule-change", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (res.ok || (res.status === 409 && data?.code === "REQUEST_ALREADY_PENDING")) {
                setScheduleChangeModalOpen(false);
                setScheduleChangePreview(null);
                await loadContext();
                return;
            }
            setErrorNotificationMessage(data?.error ?? data?.message ?? "일정 변경 요청에 실패했어요.");
        } finally {
            setScheduleChangeBusy(false);
        }
    }

    function handleServiceDateChange(next: string) {
        const expected = defaultDate(day);
        if (next === expected) {
            setField("_date", next);
            return;
        }
        if (next < expected) {
            // Only reachable by typing into the field; the `min` attribute
            // already blocks the date picker from offering an earlier date.
            return;
        }
        // Compute the shift here, outside render, so an unsupported year (or
        // any other throw from the business-days calendar) can be caught and
        // the change simply ignored instead of crashing the wizard mid-render.
        let shift: number | null;
        try {
            shift = getServiceDateShiftBusinessDays(expected, next);
        } catch {
            shift = null;
        }
        if (shift === null) return;
        setPendingServiceDate({ next, shift });
    }

    function confirmServiceDateChange() {
        if (pendingServiceDate) setField("_date", pendingServiceDate.next);
        setPendingServiceDate(null);
    }

    function cancelServiceDateChange() {
        setPendingServiceDate(null);
    }

    const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
    const toggleMulti = (k: string, o: string) =>
        setDraft((d) => {
            const arr = Array.isArray(d[k]) ? [...(d[k] as string[])] : [];
            const i = arr.indexOf(o);
            if (i >= 0) arr.splice(i, 1); else arr.push(o);
            return { ...d, [k]: arr };
        });

    const currentServiceDate = (draft["_date"] as string | undefined) || defaultDate(day);
    const hasServiceDateMismatch = isServiceDateMismatch(currentServiceDate);
    const isRecordFinalized = isRecordFinalizedStatus(ctx?.recordStatus);

    return (
        <MobileServiceRecordWizard
            data-component="mobile_service-record_wizard"
            screen={screen}
            phone={phone}
            phoneError={phoneError ? getUserErrorMessage(phoneError) : null}
            context={ctx}
            header={header}
            day={day}
            pageIdx={pageIdx}
            draft={draft}
            editing={editing}
            clientSignature={clientSignature}
            busy={busy}
            isRecordFinalized={isRecordFinalized}
            lockedDays={lockedDays}
            nextOpenDay={nextOpenDay}
            scheduleChangeBusy={scheduleChangeBusy}
            hasServiceDateMismatch={hasServiceDateMismatch}
            defaultDate={defaultDate}
            onPhoneChange={handlePhoneChange}
            onSubmitPhone={submitPhone}
            onBack={() => window.history.back()}
            onHeaderChange={(key, value) => setHeader((current) => ({ ...current, [key]: value }))}
            onDeliveryTypeChange={(value) => setHeader((current) => ({ ...current, deliveryType: value }))}
            onSaveHeader={saveHeader}
            onOpenDay={openDay}
            onOpenScheduleChangePreview={openScheduleChangePreview}
            onServiceDateChange={handleServiceDateChange}
            onFieldChange={setField}
            onToggleMulti={toggleMulti}
            onSignatureChange={setMomSignature}
            onNextPage={() => navigateTo("day", {
                mode: "push",
                day,
                pageIdx: editing ? DAY_PAGES.length - 1 : pageIdx + 1,
            })}
            onOpenSubmitModal={() => setSubmitModalOpen(true)}
            onEditSection={(sectionIndex) => navigateTo("day", {
                mode: "push",
                day,
                pageIdx: sectionIndex,
            })}
            slots={{
                submitModal: (
                    <ApprovalTwoButtonModal
                        open={submitModalOpen}
                        onOpenChange={setSubmitModalOpen}
                        data-component="mobile_service-record_submit-modal"
                        title="제출하시겠어요?"
                        description={editing
                            ? `확인하면 ${day}회차 기록이 수정 제출됩니다.`
                            : `확인하면 ${day}회차 기록이 제출됩니다.`}
                        cancelLabel="취소"
                        approvalLabel="확인"
                        pendingLabel="제출 중…"
                        isPending={busy}
                        onApprove={submitDay}
                    />
                ),
                scheduleChangeModal: (
                    <MobileTwoButtonModal
                        data-component="mobile_service-record_schedule-change-modal"
                        open={scheduleChangeModalOpen}
                        title={scheduleChangePreview ? `${scheduleChangePreview.sessionIndex}회차 서비스 일정을 조정할까요?` : "서비스 일정 변경"}
                        description={scheduleChangePreview
                            ? `${scheduleChangePreview.sessionIndex}회차 서비스를 ${formatMonthDayKo(scheduleChangePreview.fromDate)}에서 ${formatMonthDayKo(scheduleChangePreview.toDate)}로 변경을 요청할까요? 관리자 승인 후 일정이 조정됩니다.`
                            : "변경 가능한 일정을 확인하고 있어요."}
                        cancelLabel="취소"
                        confirmLabel={scheduleChangeBusy
                            ? scheduleChangePreview ? "요청 중…" : "불러오는 중…"
                            : "승인 요청"}
                        loading={scheduleChangeBusy}
                        confirmDisabled={!scheduleChangePreview}
                        onOpenChange={(open) => {
                            if (!open) closeScheduleChangeModal();
                        }}
                        onCancel={closeScheduleChangeModal}
                        onConfirm={submitScheduleChangeRequest}
                    />
                ),
                serviceDateChangeModal: (
                    <MobileTwoButtonModal
                        data-component="mobile_service-record_service-date-change-modal"
                        open={pendingServiceDate !== null}
                        title={`${day}회차 제공일을 변경할까요?`}
                        description={pendingServiceDate
                            ? `${day}회차의 서비스 제공일을 ${formatMonthDayKo(defaultDate(day))}에서 ${formatMonthDayKo(pendingServiceDate.next)}로 변경하시겠어요? ${pendingServiceDate.shift} 영업일 만큼 서비스 종료 날짜가 미뤄집니다.`
                            : ""}
                        cancelLabel="취소"
                        confirmLabel="확인"
                        onOpenChange={(open) => {
                            if (!open) cancelServiceDateChange();
                        }}
                        onCancel={cancelServiceDateChange}
                        onConfirm={confirmServiceDateChange}
                    />
                ),
                errorNotification: (
                    <NotificationOneButtonModal
                        open={errorNotificationMessage !== null}
                        onOpenChange={(open) => {
                            if (!open) setErrorNotificationMessage(null);
                        }}
                        data-component="mobile_service-record_error-notification"
                        title="요청을 완료하지 못했습니다."
                        description={errorNotificationMessage ?? ""}
                        isDescriptionVisuallyHidden={false}
                        onAcknowledge={() => setErrorNotificationMessage(null)}
                    />
                ),
            }}
        />
    );
}
