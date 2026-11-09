"use client";

import { normalizeApiError, type NormalizedApiError } from "@babyjamjam/shared";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import {
    DAY_PAGES,
    DEFAULT_DAILY_ANSWERS,
} from "@babyjamjam/service-record-ui";
import type { HolidayYearPayload } from "@babyjamjam/shared/utils/holiday-calendar";
import type {
    ServiceRecordContext,
} from "@babyjamjam/service-record-ui";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { ToastAction } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { MobileServiceRecordWizard } from "@/components/app/service-record/ServiceRecordWizard";
import { ORDER_AFTER, ORDER_BEFORE, ServiceDateSheet } from "@/components/app/service-record/screen/ServiceDateSheet";
import { ServiceRecordCalendarBanner } from "@/components/app/service-record/ServiceRecordCalendarBanner";
import { useTokenBusinessDayCalendar } from "@/hooks/useTokenBusinessDayCalendar";
import { type ServiceDayPolicy } from "@/lib/date/business-days";
import {
    serviceRecordCalendarYears,
    normalizeServiceRecordLinkToken,
    type ServiceRecordLinkInvalidReason,
} from "@/lib/service-records/page-helpers";
import {
    captureServiceRecordError,
    captureServiceRecordResponseError,
    getServiceRecordOperation,
} from "@/lib/observability/capture-service-record-error";

const MOM_APPROVAL_APPROVED = "approved";
const AUTH_LOST_PHONE_NOTICE = "안전을 위해 휴대폰 번호를 다시 확인해 주세요.";
const DRAFT_STORAGE_PREFIX = "daily-service-record-draft";
const FINALIZED_RECORD_STATUSES = new Set([
    "FINALIZING",
    "DOCUMENTS_CREATED",
    "COMPLETED",
    "FINALIZATION_FAILED",
]);

/* ───────────────────────── helpers ───────────────────────── */

// EM v1.0 client policy: a registered problem body resolves through the
// shared contract (catalog copy in the caller's locale); the upstream
// `message`/`error` strings are never rendered. Unverified bodies keep the
// locally authored fallback.
function problemMessage(status: number, data: unknown, fallback: string): string;
function problemMessage(error: unknown, fallback: string): string;
function problemMessage(statusOrError: number | unknown, dataOrFallback: unknown, maybeFallback?: string): string {
    if (typeof statusOrError === "number") {
        const normalized = normalizeApiError(
            { response: { status: statusOrError, data: dataOrFallback } },
            { locale: "ko-KR", operation: "mutation" },
        );
        return normalized.verified ? normalized.message : (maybeFallback as string);
    }
    const normalized = normalizeApiError(statusOrError, { locale: "ko-KR", operation: "mutation" });
    return normalized.verified ? normalized.message : (dataOrFallback as string);
}

/** Registered problem code from a parsed response body, if any. */
function problemCode(normalized: NormalizedApiError, body: unknown): string | undefined {
    if (normalized.verified && normalized.problem) return normalized.problem.code;
    if (body && typeof body === "object" && !Array.isArray(body)) {
        const code = (body as { code?: unknown }).code;
        if (typeof code === "string" && code.length > 0) return code;
    }
    return undefined;
}

function serviceDateErrorMessage(reason: unknown): string {
    switch (reason) {
        case "OUT_OF_RANGE": return "고를 수 있는 기간이 아니에요.";
        case "NOT_SERVICE_DAY": return "서비스를 하지 않는 날이에요.";
        case "TAKEN": return "다른 회차가 이미 고른 날이에요.";
        case "BEFORE_PREVIOUS": return ORDER_BEFORE;
        case "AFTER_NEXT": return ORDER_AFTER;
        default: return "고를 수 있는 날이 아니에요. 다른 날을 골라 주세요.";
    }
}

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

/**
 * The token context plus the client's service days. The backend adds `serviceDays` to the context
 * after this UI package's shared type was written; it is optional, so an older context is unchanged.
 */
type TokenServiceRecordContext = ServiceRecordContext & { serviceDays?: ServiceDayPolicy };

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
    const rawToken = params?.token ?? "";
    const token = useMemo(() => normalizeServiceRecordLinkToken(rawToken), [rawToken]);
    const [invalidReason, setInvalidReason] = useState<ServiceRecordLinkInvalidReason | null>(null);

    // A pasted link with trailing junk resolves to the clean token: show the clean URL so a reload or share uses it.
    useEffect(() => {
        if (!token || token === rawToken) return;
        const { search, hash } = window.location;
        window.history.replaceState(window.history.state, "", `/service-record/${encodeURIComponent(token)}${search}${hash}`);
    }, [rawToken, token]);

    const [screen, setScreen] = useState<Screen>("loading");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [phoneFieldError, setPhoneFieldError] = useState<string | null>(null);
    const [phoneNotice, setPhoneNotice] = useState<string | null>(null);
    const [ctx, setCtx] = useState<TokenServiceRecordContext | null>(null);
    const [header, setHeader] = useState<Record<string, string>>({ deliveryType: "자연분만" });
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [editing, setEditing] = useState(false);
    const [clientSignature, setMomSignature] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [submitModalOpen, setSubmitModalOpen] = useState(false);
    const [errorNotificationMessage, setErrorNotificationMessage] = useState<string | null>(null);
    const [dateSheetOpen, setDateSheetOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [serviceDateError, setServiceDateError] = useState<string | null>(null);
    const navigateTo = useCallback((
        nextScreen: Screen,
        options: { mode?: HistoryMode; day?: number; pageIdx?: number } = {},
    ) => {
        setScreen(nextScreen);
        // The submit dialog describes the day that was open when it was raised; any navigation retires it.
        setSubmitModalOpen(false);
        setDateSheetOpen(false);
        setDeleteModalOpen(false);
        setServiceDateError(null);
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

    // Branch calendar for this token. The access cookie only exists once the
    // context has loaded, so loading starts then (not on the first link check).
    const calendarYears = useMemo(() => serviceRecordCalendarYears(ctx), [ctx]);
    const fetchHolidayYear = useCallback(async (year: number): Promise<HolidayYearPayload> => {
        const res = await api(`/holidays?year=${year}`, {}, false);
        if (!res.ok) throw new Error(`holidays ${res.status}`);
        return res.json();
    }, [api]);
    const {
        calendar,
        ready: calendarReady,
        error: calendarError,
        retry: retryCalendar,
    } = useTokenBusinessDayCalendar({ enabled: ctx !== null, years: calendarYears, fetchYear: fetchHolidayYear });
    // The client's per-client service days (토/일/공휴일), when the context carries them. Every default
    // date and date-shift check runs on this calendar; a context without them behaves as before.
    const serviceDays = ctx?.serviceDays;
    const serviceCalendar = useMemo(
        () => (serviceDays ? calendar.withServiceDays(serviceDays) : calendar),
        [calendar, serviceDays],
    );
    const loadContext = useCallback(async (historyMode: HistoryMode = "replace") => {
        const res = await api("/context");
        if (!res.ok) {
            navigateTo(res.status === 401 || res.status === 403 ? "phone" : "invalid", { mode: historyMode });
            return;
        }
        const data: TokenServiceRecordContext = await res.json();
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
                    setInvalidReason(data?.reason === "not_found" ? "not_found" : "unavailable");
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
            const session = ctx.sessions.find((row) => row.sessionIndex === targetDay);
            const isLockedSession = Boolean(session?.locked);
            const targetPageIdx = Math.min(Math.max(target.pageIdx, 0), DAY_PAGES.length - 1);
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
                if (targetDay !== 1 && !ctx.sessions.some((row) => row.sessionIndex === targetDay - 1 && row.locked)) {
                    navigateTo("overview", { mode: "replace" });
                    return;
                }
                setDraft(initializeUnlockedDraft(token, targetDay, ctx.sessions));
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
    const defaultDate = useCallback(
        (index: number) => ctx?.sessions.find((row) => row.sessionIndex === index)?.serviceDate.slice(0, 10) ?? "",
        [ctx],
    );
    /**
     * A write refused for auth (401 / 403) means the caregiver's access is gone: send them back to phone verification.
     * The stored form state and `ctx` are left alone, so a new day's draft survives the round trip.
     * Returns true when the response was an auth refusal, so the caller stops without an error notification.
     */
    function handleAuthLost(res: Response): boolean {
        if (res.status !== 401 && res.status !== 403) return false;
        setDateSheetOpen(false);
        setDeleteModalOpen(false);
        setPhoneError(null);
        setPhoneFieldError(null);
        setPhoneNotice(AUTH_LOST_PHONE_NOTICE);
        navigateTo("phone", { mode: "replace" });
        return true;
    }
    async function submitPhone() {
        if (phone.replace(/\D/g, "").length < 10) { setPhoneError("휴대폰 번호를 입력해 주세요."); return; }
        setBusy(true); setPhoneError(null); setPhoneFieldError(null);
        try {
            const res = await api("/verify", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
            });
            const data = await res.json();
            if (data?.ok) {
                setPhoneNotice(null);
                await loadContext("push");
            } else {
                // The mismatch belongs to the phone field, so it shows in that field's message slot.
                setPhoneFieldError("휴대폰 번호가 일치하지 않아요");
            }
        } catch {
            setPhoneError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        } finally { setBusy(false); }
    }
    function handlePhoneChange(value: string) {
        setPhoneFieldError(null);
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
                if (handleAuthLost(response)) return;
                const body: unknown = await response.json().catch(() => ({}));
                setErrorNotificationMessage(problemMessage(response.status, body, "기본정보 저장에 실패했어요."));
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
        if (!shouldEdit && d !== 1 && !lockedDays.has(d - 1)) return;
        if (d < 1 || d > (ctx?.totalSessions ?? 0) || isRecordFinalizedStatus(ctx?.recordStatus)) return;
        setServiceDateError(null);

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
            setDraft(initializeUnlockedDraft(token, d, ctx?.sessions ?? []));
        }
        navigateTo("day", { mode: "push", day: d, pageIdx: initialPageIdx });
    }

    async function submitDay() {
        // Captured before any await: the toast fires after the context reloads.
        const submittedDay = day;
        const wasEditing = editing;
        const serviceDate = (draft["_date"] as string) ?? defaultDate(day);
        setBusy(true);
        try {
            const currentSession = ctx?.sessions.find((session) => session.sessionIndex === day);
            const body = {
                serviceDate,
                answers: Object.fromEntries(Object.entries(draft).filter(([k]) => !k.startsWith("_"))),
                etcService: (draft["etcService"] as string) ?? undefined,
                notes: (draft["notes"] as string) ?? undefined,
                paymentConfirmed: Boolean(draft["paymentConfirmed"]),
                momApproval: MOM_APPROVAL_APPROVED,
                ...(!currentSession?.clientSignature && clientSignature ? { clientSignature } : {}),
            };
            const res = await api(`/sessions/${day}/submit`, { method: "POST", body: JSON.stringify(body) });
            if (!res.ok) {
                if (handleAuthLost(res)) return;
                const e: unknown = await res.json().catch(() => ({}));
                const normalized = normalizeApiError(
                    { response: { status: res.status, data: e } },
                    { locale: "ko-KR", operation: "mutation" },
                );
                if (problemCode(normalized, e) === "CLIENT_SIGNATURE_REQUIRED") {
                    setErrorNotificationMessage("산모 서명이 필요합니다.");
                } else if (
                    res.status === 400 && problemCode(normalized, e) === "VALIDATION_FAILED"
                    && e && typeof e === "object" && "errors" in e && Array.isArray(e.errors)
                    && e.errors.some((error: unknown) => error && typeof error === "object"
                        && "pointer" in error && error.pointer === "/serviceDate")
                ) {
                    if (!editing) navigateTo("day", { mode: "replace", day, pageIdx: 0 });
                    setServiceDateError(serviceDateErrorMessage("serviceDateReason" in e ? e.serviceDateReason : undefined));
                    setSubmitModalOpen(false);
                } else if (problemCode(normalized, e) === "REQUEST_CONFLICT") {
                    setErrorNotificationMessage("이미 처리되었거나 수정할 수 없는 상태예요.");
                } else {
                    setErrorNotificationMessage(normalized.verified ? normalized.message : "제출에 실패했어요.");
                }
                return;
            }
            if (!editing) clearStoredFormState(token);
            setSubmitModalOpen(false);
            setEditing(false);
            setMomSignature(null);
            await loadContext("push");
            if (wasEditing) {
                toast({
                    variant: "success",
                    title: `${submittedDay}회차 수정이 저장됐어요`,
                    action: (
                        <ToastAction onClick={() => openDayRef.current(submittedDay, true)}>
                            기록 보기
                        </ToastAction>
                    ),
                });
            }
        } finally { setBusy(false); }
    }

    async function deleteSession() {
        const deletedDay = day;
        if (busy || !ctx?.sessions.some((row) => row.sessionIndex === deletedDay)) return;
        setBusy(true);
        try {
            const res = await api(`/sessions/${deletedDay}`, { method: "DELETE" });
            if (handleAuthLost(res)) return;
            if (!res.ok) {
                const body: unknown = await res.json().catch(() => ({}));
                setErrorNotificationMessage(problemMessage(res.status, body, "기록을 삭제하지 못했어요."));
                return;
            }
            clearStoredFormState(token);
            setDeleteModalOpen(false);
            await loadContext("push");
            toast({ variant: "success", title: `${deletedDay}회차 기록을 삭제했어요` });
        } catch {
            setErrorNotificationMessage("기록을 삭제하지 못했어요.");
        } finally {
            setBusy(false);
        }
    }

    const openDayRef = useRef(openDay);
    useEffect(() => { openDayRef.current = openDay; });

    function handleServiceDateChange(next: string) {
        setServiceDateError(null);
        setField("_date", next);
        setDateSheetOpen(false);
    }

    const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
    const toggleMulti = (k: string, o: string) =>
        setDraft((d) => {
            const arr = Array.isArray(d[k]) ? [...(d[k] as string[])] : [];
            const i = arr.indexOf(o);
            if (i >= 0) arr.splice(i, 1); else arr.push(o);
            return { ...d, [k]: arr };
        });

    const isRecordFinalized = isRecordFinalizedStatus(ctx?.recordStatus);
    const showCalendarNotice = ctx !== null
        && (screen === "overview" || screen === "day")
        && calendarError !== null;

    return (
        <>
        <MobileServiceRecordWizard
            data-component="mobile_service-record_wizard"
            screen={screen}
            phone={phone}
            phoneError={phoneError}
            phoneFieldError={phoneFieldError}
            phoneNotice={phoneNotice}
            invalidReason={invalidReason}
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
            defaultDate={defaultDate}
            onPhoneChange={handlePhoneChange}
            onSubmitPhone={submitPhone}
            onBack={() => window.history.back()}
            onHeaderChange={(key, value) => setHeader((current) => ({ ...current, [key]: value }))}
            onDeliveryTypeChange={(value) => setHeader((current) => ({ ...current, deliveryType: value }))}
            onSaveHeader={saveHeader}
            onOpenDay={openDay}
            onOpenDateSheet={() => setDateSheetOpen(true)}
            onDeleteSession={() => setDeleteModalOpen(true)}
            serviceDateError={serviceDateError}
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
                        isDescriptionVisuallyHidden={false}
                        cancelLabel="취소"
                        approvalLabel="확인"
                        pendingLabel="제출 중…"
                        isPending={busy}
                        onApprove={submitDay}
                    />
                ),
                serviceDateSheet: dateSheetOpen && ctx ? (
                    <ServiceDateSheet
                        data-component="mobile_service-record_wizard_service-date-sheet"
                        context={ctx}
                        day={day}
                        value={(draft._date as string) || defaultDate(day)}
                        editing={editing}
                        calendar={serviceCalendar}
                        calendarReady={calendarReady}
                        onClose={() => setDateSheetOpen(false)}
                        onSelect={handleServiceDateChange}
                        onOrderBlocked={(message) => toast({ variant: "destructive", title: message })}
                    />
                ) : null,
                deleteModal: (
                    <ApprovalTwoButtonModal
                        data-component="mobile_service-record_wizard_delete-modal"
                        open={deleteModalOpen}
                        onOpenChange={(open) => { if (!busy) setDeleteModalOpen(open); }}
                        title={`${day}회차 기록을 삭제할까요?`}
                        description="기록과 고객 서명이 모두 삭제됩니다."
                        isDescriptionVisuallyHidden={false}
                        cancelLabel="취소"
                        approvalLabel="삭제"
                        approvalVariant="destructive"
                        isPending={busy}
                        onApprove={deleteSession}
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
        {showCalendarNotice ? (
            <ServiceRecordCalendarBanner
                data-component="mobile_service-record_calendar-notice"
                error={calendarError}
                loading={!calendarReady && calendarError === null}
                onRetry={retryCalendar}
            />
        ) : null}
        </>
    );
}

function initializeUnlockedDraft(
    token: string,
    day: number,
    sessions: ServiceRecordContext["sessions"],
): Record<string, unknown> {
    const session = sessions.find((row) => row.sessionIndex === day);
    const serverDraft: Record<string, unknown> = {
        _date: "",
        ...DEFAULT_DAILY_ANSWERS,
        etcService: "",
        notes: "",
        paymentConfirmed: false,
        ...(session
            ? {
                _date: session.serviceDate.slice(0, 10),
                ...(session.answers ?? {}),
                etcService: session.etcService ?? "",
                notes: session.notes ?? "",
                paymentConfirmed: Boolean(session.paymentConfirmed),
            }
            : {}),
    };
    const stored = readStoredFormState(token);
    if (stored?.day !== day || !stored.draft) return serverDraft;
    const restoredDraft = { ...serverDraft, ...stored.draft };
    return restoredDraft;
}
