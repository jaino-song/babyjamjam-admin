"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
    SERVICE_RECORD_FORM_LAYOUT,
    type ServiceRecordFieldDescriptor,
    type ServiceRecordFormSection,
} from "@babyjamjam/shared/constants/service-record-form-layout";

import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { isBusinessDayKr, nextBusinessDayKr } from "@/lib/date/business-days";

/* ───────────────────────── form definition (mirrors the 제공기록지) ───────────────────────── */

type ItemType = "multi" | "radio" | "counts" | "stool" | "textarea" | "confirm";
interface DailyItem {
    key: string;
    label: string;
    type: ItemType;
    opts?: string[];
    counts?: { k: string; label: string; unit: string }[];
}

const DAILY_ITEMS: DailyItem[] = [
    { key: "perineum", label: "① 회음절개부위 (또는 수술부위)", type: "multi", opts: ["열상", "혈종", "불편감", "이상없음"] },
    { key: "breast", label: "② 유방상태", type: "multi", opts: ["울혈", "통증", "이상없음"] },
    { key: "excretion", label: "③ 배뇨/배변", type: "multi", opts: ["불편감", "이상없음"] },
    { key: "sitzBath", label: "④ 좌욕", type: "radio", opts: ["실시", "미실시"] },
    { key: "meals", label: "⑤ 식사/간식", type: "counts", counts: [{ k: "meal", label: "식사", unit: "회" }, { k: "snack", label: "간식", unit: "회" }] },
    { key: "temperature", label: "⑥ 체온", type: "counts", counts: [{ k: "temp", label: "체온", unit: "℃" }] },
    { key: "sleep", label: "⑦ 수면 양상", type: "radio", opts: ["잘 잠", "잘 못 잠"] },
    { key: "breastFeeding", label: "⑧ 모유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }] },
    { key: "formulaFeeding", label: "⑨ 분유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }, { k: "ml", label: "회당", unit: "ml" }] },
    { key: "stool", label: "⑩ 배변양상", type: "stool", opts: ["정상변", "이상변"] },
    { key: "bath", label: "⑪ 목욕·제대관리", type: "radio", opts: ["실시", "미실시"] },
    { key: "etcService", label: "기타 서비스 (필요시 직접기재)", type: "textarea" },
    { key: "notes", label: "특이사항", type: "textarea" },
    { key: "paymentConfirmed", label: "결제 확인", type: "confirm" },
];
interface DayPage {
    tag: "산모" | "신생아" | "마무리" | "산모 확인";
    title: string;
    sub: string;
    items: number[];
    confirmation?: boolean;
}

const DAY_PAGES: DayPage[] = [
    { tag: "산모", title: "산모 기록", sub: "① ~ ⑤", items: [0, 1, 2, 3, 4] },
    { tag: "신생아", title: "신생아 기록", sub: "⑥ ~ ⑪", items: [5, 6, 7, 8, 9, 10] },
    { tag: "마무리", title: "마무리 · 확인", sub: "기타 · 특이사항 · 결제 확인", items: [11, 12, 13] },
    {
        tag: "산모 확인",
        title: "기록 내용 확인",
        sub: "제공인력이 작성한 오늘의 기록입니다. 내용을 확인하신 후 아래에서 승인 또는 거부를 선택해 주세요.",
        items: [],
        confirmation: true,
    },
];

const MOM_APPROVAL_APPROVED = "approved";
const REVIEW_EMPTY_LABEL = "입력 없음";

/* ───────────────────────── types from the backend ───────────────────────── */

interface SessionRow {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    answers?: Record<string, unknown>;
    etcService?: string | null;
    notes?: string | null;
    paymentConfirmed?: boolean;
    momApproval?: string | null;
}
interface FeedbackContext {
    org: { name: string; hours: string };
    employee: { id: number; name: string };
    client: { id: number; name: string };
    totalSessions: number;
    startDate: string | null;
    header: Record<string, unknown> | null;
    sessions: SessionRow[];
    pendingScheduleChange?: { id: string; sessionIndex: number; fromDate: string; toDate: string } | null;
}

interface ScheduleChangePreview {
    sessionIndex: number;
    fromDate: string;
    toDate: string;
}

const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예) 홍길동" },
    { k: "momBirth", label: "산모 생년월일 (YYMMDD)", ph: "예) 900101" },
    { k: "babyName", label: "신생아 성명", ph: "예) 홍아기" },
    { k: "babyBirth", label: "신생아 출생일자 (YYMMDD)", ph: "예) 260615" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예) 3.2" },
];

/* ───────────────────────── helpers ───────────────────────── */

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mmdd = (iso: string) => (iso ? iso.slice(5).replace("-", ".") : "");
const monthDayKo = (iso: string) => {
    const [, month = "", day = ""] = iso.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
    return `${Number(month)}월 ${Number(day)}일`;
};
const hasDisplayValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasDisplayValue);
    if (typeof value === "string") return value.trim().length > 0;
    return true;
};
const REVIEW_SECTIONS = SERVICE_RECORD_FORM_LAYOUT.map((section) => ({
    ...section,
    fields: section.id === "finish"
        ? section.fields.filter((field) => field.key !== "hasMomApproval")
        : section.fields,
}));

function dayPageTagClass(tag: DayPage["tag"]) {
    if (tag === "산모") return "mom";
    if (tag === "신생아") return "baby";
    if (tag === "산모 확인") return "confirm";
    return "etc";
}

function sectionToneClass(tone: ServiceRecordFormSection["tone"]) {
    if (tone === "mom") return "mom";
    if (tone === "baby") return "baby";
    return "etc";
}

function formatReviewFieldValue(
    field: ServiceRecordFieldDescriptor,
    draft: Record<string, unknown>,
): { value: string; ok?: boolean } {
    if (field.source === "session") {
        if (field.key === "paymentConfirmed") {
            return Boolean(draft[field.key]) ? { value: "✓ 확인 완료", ok: true } : { value: "" };
        }
        const value = draft[field.key];
        return { value: hasDisplayValue(value) ? String(value).trim() : "" };
    }

    if (field.kind === "multi") {
        const value = draft[field.key];
        const values = Array.isArray(value) ? value.filter(hasDisplayValue).map((item) => String(item).trim()) : [];
        return { value: values.join(", ") };
    }

    if (field.kind === "radio") {
        const value = hasDisplayValue(draft[field.key]) ? String(draft[field.key]).trim() : "";
        const colorValue = field.key === "stool" && hasDisplayValue(draft.stool_color)
            ? String(draft.stool_color).trim()
            : "";
        if (value && colorValue) return { value: `${value} (${colorValue})` };
        return { value };
    }

    if (field.kind === "counts") {
        const parts = (field.subKeys ?? [])
            .map((subKey) => {
                const value = draft[subKey.key];
                if (!hasDisplayValue(value)) return null;
                const prefix = subKey.label === "횟수" || subKey.label === "체온" ? "" : `${subKey.label} `;
                return `${prefix}${String(value).trim()}${subKey.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    if (field.kind === "check") {
        return Boolean(draft[field.key]) ? { value: "✓ 확인 완료", ok: true } : { value: "" };
    }

    const value = draft[field.key];
    return { value: hasDisplayValue(value) ? String(value).trim() : "" };
}

type Screen = "loading" | "invalid" | "phone" | "service" | "overview" | "day" | "done";

export default function FeedbackPage() {
    const params = useParams<{ token: string }>();
    const token = params?.token ?? "";

    const [screen, setScreen] = useState<Screen>("loading");
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [ctx, setCtx] = useState<FeedbackContext | null>(null);
    const [header, setHeader] = useState<Record<string, string>>({});
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [busy, setBusy] = useState(false);
    const [scheduleChangePreview, setScheduleChangePreview] = useState<ScheduleChangePreview | null>(null);
    const [scheduleChangeModalOpen, setScheduleChangeModalOpen] = useState(false);
    const [scheduleChangeBusy, setScheduleChangeBusy] = useState(false);
    const [rejectionRequests, setRejectionRequests] = useState<Record<number, string>>({});
    const [dismissedRejectionDays, setDismissedRejectionDays] = useState<Set<number>>(() => new Set());
    const [rejectSheetOpen, setRejectSheetOpen] = useState(false);
    const [rejectNoteDraft, setRejectNoteDraft] = useState("");

    const api = useCallback(
        async (path: string, init: RequestInit = {}) => {
            const res = await fetch(`/api/feedback/${token}${path}`, {
                ...init,
                headers: {
                    "Content-Type": "application/json",
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                    ...(init.headers ?? {}),
                },
            });
            return res;
        },
        [token, accessToken],
    );

    // initial: is the link valid?
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch(`/api/feedback/${token}/link`);
                const data = await res.json();
                if (!alive) return;
                setScreen(data?.valid ? "phone" : "invalid");
            } catch {
                if (alive) setScreen("invalid");
            }
        })();
        return () => { alive = false; };
    }, [token]);

    const loadContext = useCallback(async () => {
        const res = await api("/context");
        if (!res.ok) { setScreen("invalid"); return; }
        const data: FeedbackContext = await res.json();
        setCtx(data);
        setHeader((data.header as Record<string, string>) ?? {});
        setScreen(data.header ? "overview" : "service");
    }, [api]);

    const lockedDays = useMemo(() => new Set((ctx?.sessions ?? []).filter((s) => s.locked).map((s) => s.sessionIndex)), [ctx]);
    const nextOpenDay = useCallback(() => {
        let d = 1;
        while (lockedDays.has(d)) d++;
        return d;
    }, [lockedDays]);
    const defaultDate = useCallback(
        (d: number) => {
            const sessions = ctx?.sessions ?? [];
            const rawStart = ctx?.startDate ? ctx.startDate.slice(0, 10) : isoOf(new Date());
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
        [ctx?.sessions, ctx?.startDate],
    );

    async function submitPhone() {
        if (phone.replace(/\D/g, "").length < 10) { setPhoneError("휴대폰 번호를 입력해 주세요."); return; }
        setBusy(true); setPhoneError(null);
        try {
            const res = await fetch(`/api/feedback/${token}/verify`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
            });
            const data = await res.json();
            if (data?.ok && data.accessToken) {
                setAccessToken(data.accessToken);
            } else if (data?.reason === "locked") {
                setPhoneError("시도 횟수를 초과했습니다. 지점에 문의해 새 링크를 받아주세요.");
            } else {
                setPhoneError(`휴대폰 번호가 일치하지 않습니다. (남은 시도 ${data?.attemptsLeft ?? "?"}회)`);
            }
        } catch {
            setPhoneError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        } finally { setBusy(false); }
    }
    useEffect(() => { if (accessToken) loadContext(); }, [accessToken, loadContext]);

    async function saveHeader() {
        setBusy(true);
        try {
            await api("/header", { method: "PUT", body: JSON.stringify(header) });
            await loadContext();
            setScreen("overview");
        } finally { setBusy(false); }
    }

    function openDay(d: number) {
        if (lockedDays.has(d) || d !== nextOpenDay()) return;
        setDay(d); setPageIdx(0);
        setDraft({ _date: defaultDate(d) });
        setScreen("day");
    }

    async function submitDay() {
        setBusy(true);
        try {
            const body = {
                serviceDate: (draft["_date"] as string) ?? defaultDate(day),
                answers: Object.fromEntries(Object.entries(draft).filter(([k]) => !k.startsWith("_"))),
                etcService: (draft["etcService"] as string) ?? undefined,
                notes: (draft["notes"] as string) ?? undefined,
                paymentConfirmed: Boolean(draft["paymentConfirmed"]),
                momApproval: MOM_APPROVAL_APPROVED,
            };
            const res = await api(`/sessions/${day}/submit`, { method: "POST", body: JSON.stringify(body) });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                alert(e?.message ?? "제출에 실패했습니다.");
                return;
            }
            await loadContext();
            setRejectionRequests((requests) => {
                if (!Object.prototype.hasOwnProperty.call(requests, day)) return requests;
                const next = { ...requests };
                delete next[day];
                return next;
            });
            setDismissedRejectionDays((days) => {
                if (!days.has(day)) return days;
                const next = new Set(days);
                next.delete(day);
                return next;
            });
            setScreen("overview");
        } finally { setBusy(false); }
    }

    function openRejectSheet() {
        setRejectNoteDraft(rejectionRequests[day] ?? "");
        setRejectSheetOpen(true);
    }

    function closeRejectSheet() {
        setRejectSheetOpen(false);
    }

    function submitRejectionRequest() {
        const note = rejectNoteDraft.trim();
        setRejectionRequests((requests) => ({ ...requests, [day]: note }));
        setDismissedRejectionDays((days) => {
            if (!days.has(day)) return days;
            const next = new Set(days);
            next.delete(day);
            return next;
        });
        setRejectSheetOpen(false);
        setRejectNoteDraft("");
        setPageIdx(0);
    }

    function dismissRejectionNotice() {
        setDismissedRejectionDays((days) => {
            const next = new Set(days);
            next.add(day);
            return next;
        });
    }

    async function finalize() {
        setBusy(true);
        try {
            const res = await api("/finalize", { method: "POST" });
            if (res.ok) setScreen("done");
            else alert("제출 처리에 실패했습니다.");
        } finally { setBusy(false); }
    }

    async function openScheduleChangePreview() {
        setScheduleChangeBusy(true);
        try {
            const res = await api("/schedule-change/preview");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data?.error ?? data?.message ?? "일정 변경 정보를 불러오지 못했습니다.");
                return;
            }
            setScheduleChangePreview(data as ScheduleChangePreview);
            setScheduleChangeModalOpen(true);
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
            alert(data?.error ?? data?.message ?? "일정 변경 요청에 실패했습니다.");
        } finally {
            setScheduleChangeBusy(false);
        }
    }

    /* ───────────────────────── rendering ───────────────────────── */

    const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
    const toggleMulti = (k: string, o: string) =>
        setDraft((d) => {
            const arr = Array.isArray(d[k]) ? [...(d[k] as string[])] : [];
            const i = arr.indexOf(o);
            if (i >= 0) arr.splice(i, 1); else arr.push(o);
            return { ...d, [k]: arr };
        });

    function renderField(it: DailyItem) {
        const v = draft[it.key];
        if (it.type === "multi") {
            return (
                <div data-component="feedback-options" className="opts">
                    {it.opts!.map((o) => (
                        <button type="button" key={o} className={`opt ${Array.isArray(v) && (v as string[]).includes(o) ? "sel" : ""}`} onClick={() => toggleMulti(it.key, o)}>
                            <span className="box">✓</span>{o}
                        </button>
                    ))}
                </div>
            );
        }
        if (it.type === "radio" || it.type === "stool") {
            return (
                <>
                    <div data-component="feedback-radio-options" className="opts">
                        {it.opts!.map((o) => (
                            <button type="button" key={o} className={`opt radio ${v === o ? "sel" : ""}`} onClick={() => setField(it.key, o)}>
                                <span className="box">●</span>{o}
                            </button>
                        ))}
                    </div>
                    {it.type === "stool" && (
                        <input className="in" style={{ marginTop: 8 }} placeholder="색깔 등 (이상변 시)"
                            value={(draft[`${it.key}_color`] as string) ?? ""} onChange={(e) => setField(`${it.key}_color`, e.target.value)} />
                    )}
                </>
            );
        }
        if (it.type === "counts") {
            return (
                <>
                    {it.counts!.map((c) => (
                        <div data-component="feedback-count-row" className="segnum" key={c.k}>
                            <span>{c.label}</span>
                            <input type="number" inputMode="numeric" value={((draft[`${it.key}_${c.k}`] as string) ?? "")} onChange={(e) => setField(`${it.key}_${c.k}`, e.target.value)} />
                            <span>{c.unit}</span>
                        </div>
                    ))}
                </>
            );
        }
        if (it.type === "textarea") {
            return <textarea className="ta" value={(v as string) ?? ""} onChange={(e) => setField(it.key, e.target.value)} placeholder="필요 시 직접 기재" />;
        }
        if (it.type === "confirm") {
            return (
                <div data-component="feedback-confirm-options" className="opts">
                    <button type="button" className={`opt ${v ? "sel" : ""}`} onClick={() => setField(it.key, !v)}>
                        <span className="box">✓</span>결제 확인 완료 (제공인력 체크)
                    </button>
                </div>
            );
        }
        return null;
    }

    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const isMomConfirmationPage = Boolean(currentDayPage.confirmation);
    const currentServiceDate = ((draft["_date"] as string | undefined) || defaultDate(day));
    const hasRejectionRequest = Object.prototype.hasOwnProperty.call(rejectionRequests, day);
    const showRejectionNotice = hasRejectionRequest && !dismissedRejectionDays.has(day) && !isMomConfirmationPage;
    const rejectionNoticeText = (rejectionRequests[day] ?? "").trim() || "내용을 다시 확인해 주세요.";

    return (
        <div data-component="feedback-wizard" className="efb">
            <Styles />
            <div data-component="feedback-top-bar" className="top">
                <h1>산모·신생아 건강관리 서비스 제공기록지</h1>
                <div data-component="feedback-org-info" className="org">제공기관 {ctx?.org.name ?? "인천 아이미래로"} · {ctx?.org.hours ?? "평일 09시~18시"}</div>
            </div>
            <div data-component="feedback-body" className="body">
                {screen === "loading" && <p className="muted">불러오는 중…</p>}

                {screen === "invalid" && (
                    <div data-component="feedback-invalid-center" className="center">
                        <div data-component="feedback-invalid-title" className="step-title">링크를 사용할 수 없습니다</div>
                        <p className="muted">만료되었거나 더 이상 유효하지 않은 링크입니다. 지점에 문의해 주세요.</p>
                    </div>
                )}

                {screen === "phone" && (
                    <>
                        <div data-component="feedback-phone-pill" className="pill">최초 1회 인증</div>
                        <div data-component="feedback-phone-title" className="step-title">제공인력 본인 확인</div>
                        <p className="muted">본인 휴대폰 번호를 입력하면 서비스 기간 동안 유효한 접근 권한이 발급됩니다.</p>
                        <label className="lab">휴대폰 번호</label>
                        <input className="in" type="tel" inputMode="numeric" autoComplete="tel" maxLength={13} placeholder="예) 01012345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
                        {phoneError && <p className="err">{phoneError}</p>}
                        <button className="btn primary" disabled={busy} onClick={submitPhone}>{busy ? "확인 중…" : "확인하고 시작"}</button>
                    </>
                )}

                {screen === "service" && (
                    <>
                        <div data-component="feedback-service-pill" className="pill">서비스 전체 공통 · 최초 1회</div>
                        <div data-component="feedback-service-title" className="step-title">서비스 기본정보</div>
                        <div data-component="feedback-readonly-row" className="ro"><span>제공인력</span><b>{ctx?.employee.name}</b></div>
                        {HEADER_FIELDS.map((f) => (
                            <div data-component="feedback-field" className="fld" key={f.k}>
                                <label className="lab">{f.label}</label>
                                <input className="in" placeholder={f.ph} value={header[f.k] ?? ""} onChange={(e) => setHeader((h) => ({ ...h, [f.k]: e.target.value }))} />
                            </div>
                        ))}
                        <div data-component="feedback-delivery-field" className="fld">
                            <label className="lab">분만형태</label>
                            <div data-component="feedback-delivery-options" className="opts">
                                {["자연분만", "제왕절개"].map((o) => (
                                    <button type="button" key={o} className={`opt radio ${header["deliveryType"] === o ? "sel" : ""}`} onClick={() => setHeader((h) => ({ ...h, deliveryType: o }))}>
                                        <span className="box">●</span>{o}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button className="btn primary" disabled={busy} onClick={saveHeader}>{busy ? "저장 중…" : "다음"}</button>
                    </>
                )}

                {screen === "overview" && ctx && (
                    <>
                        <div data-component="feedback-overview-pill" className="pill">총 {ctx.totalSessions}회 제공 · {lockedDays.size}회 제출됨</div>
                        <div data-component="feedback-overview-title" className="step-title">일자별 제공기록</div>
                        <p className="muted">제공 회차 순서대로 입력합니다. 제출한 회차는 잠기며 수정할 수 없습니다.</p>
                        <div data-component="feedback-day-grid" className="days">
                            {Array.from({ length: ctx.totalSessions }, (_, i) => i + 1).map((d) => {
                                const done = lockedDays.has(d);
                                const open = d === nextOpenDay();
                                const cls = done ? "day done" : open ? "day current" : "day locked";
                                return (
                                    <button type="button" key={d} className={cls} disabled={done || !open} onClick={() => openDay(d)}>
                                        <div data-component="feedback-day-date" className="d">{mmdd(done ? (ctx.sessions.find((s) => s.sessionIndex === d)?.serviceDate.slice(0, 10) ?? "") : defaultDate(d))}</div>
                                        <div data-component="feedback-day-number" className="n">{d}</div>
                                        <div data-component="feedback-day-status" className="st">{done ? "제출완료 🔒" : open ? "입력 가능" : "대기"}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {lockedDays.size === ctx.totalSessions ? (
                            <button className="btn submit" disabled={busy} onClick={finalize}>{busy ? "전송 중…" : "서비스 종료 · 기록지 제출"}</button>
                        ) : (
                            <>
                                <button className="btn primary" onClick={() => openDay(nextOpenDay())}>{lockedDays.size ? "다음 회차 입력" : "기록 시작"}</button>
                                <button
                                    className="btn ghost schedule-change"
                                    disabled={scheduleChangeBusy || Boolean(ctx.pendingScheduleChange)}
                                    onClick={openScheduleChangePreview}
                                >
                                    {ctx.pendingScheduleChange ? "일정 변경 요청 대기 중" : "서비스 일정 변경"}
                                </button>
                            </>
                        )}
                    </>
                )}

                {screen === "day" && (
                    <>
                        <div data-component="feedback-day-crumb" className="crumb">
                            제공 <b>{day}회차</b> · {currentDayPage.tag} ({pageIdx + 1}/{DAY_PAGES.length})
                        </div>
                        <div data-component="feedback-date-chip" className="datechip">📅 {isMomConfirmationPage ? currentServiceDate : "제공일자"}
                            {isMomConfirmationPage ? null : (
                                <input type="date" className="dateinput" value={currentServiceDate} min={day <= 1 ? (ctx?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day)} onChange={(e) => setField("_date", e.target.value)} />
                            )}
                            · {day}회차
                        </div>
                        {showRejectionNotice && (
                            <div data-component="feedback-rejection-notice" className="notice">
                                <span>산모 수정 요청: {rejectionNoticeText}</span>
                                <button type="button" onClick={dismissRejectionNotice}>닫기</button>
                            </div>
                        )}
                        <div data-component="feedback-section-tag" className={`tag ${dayPageTagClass(currentDayPage.tag)}`}>{currentDayPage.tag}</div>
                        <div data-component="feedback-day-title" className="step-title">{currentDayPage.title}</div>
                        <p className="muted">{currentDayPage.sub}</p>
                        {isMomConfirmationPage ? (
                            <>
                                <div data-component="feedback-handover-banner" className="handover">
                                    <span aria-hidden="true">🤱</span>
                                    <b>제공인력님, 이 화면을 산모님께 전달해 주세요.</b>
                                </div>
                                <MomConfirmationReview draft={draft} />
                                <p className="lock">승인하면 이 회차 기록이 제출·잠금되어 수정할 수 없습니다 · 거부하면 제공인력이 내용을 수정한 뒤 다시 확인을 요청합니다</p>
                            </>
                        ) : (
                            <>
                                {currentDayPage.items.map((idx) => {
                                    const item = DAILY_ITEMS[idx];
                                    if (!item) return null;
                                    return (
                                        <div data-component="feedback-day-field" className="fld" key={item.key}>
                                            <label className="lab">{item.label}</label>
                                            {renderField(item)}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                        <div data-component="feedback-nav" className="nav">
                            <button className="btn ghost" onClick={() => (pageIdx > 0 ? setPageIdx(pageIdx - 1) : setScreen("overview"))}>이전</button>
                            {isMomConfirmationPage ? (
                                <>
                                    <button className="btn reject" type="button" onClick={openRejectSheet}>거부</button>
                                    <button className="btn submit" disabled={busy} onClick={submitDay}>{busy ? "제출 중…" : "확인했습니다 · 승인"}</button>
                                </>
                            ) : (
                                <button className="btn primary" onClick={() => setPageIdx(pageIdx + 1)}>다음</button>
                            )}
                        </div>
                    </>
                )}

                {screen === "done" && (
                    <div data-component="feedback-done-center" className="center">
                        <div data-component="feedback-done-title" className="step-title">제공기록지 작성 완료 ✅</div>
                        <p className="muted">전체 기록이 제공기록지 문서로 만들어져 제공기관 확인 단계로 전송되었습니다. 별도로 하실 일은 없습니다.</p>
                    </div>
                )}
            </div>
            <ConfirmActionModal
                open={scheduleChangeModalOpen && Boolean(scheduleChangePreview)}
                title="서비스 일정을 조정할까요?"
                description={scheduleChangePreview
                    ? `${scheduleChangePreview.sessionIndex}회차 서비스를 ${monthDayKo(scheduleChangePreview.fromDate)} → ${monthDayKo(scheduleChangePreview.toDate)}(으)로 변경 요청합니다. 관리자 승인 후 일정과 종료일이 조정됩니다.`
                    : ""}
                cancelLabel="취소"
                confirmLabel={scheduleChangeBusy ? "요청 중…" : "확인"}
                loading={scheduleChangeBusy}
                onOpenChange={(open) => {
                    if (!open) closeScheduleChangeModal();
                }}
                onCancel={closeScheduleChangeModal}
                onConfirm={submitScheduleChangeRequest}
            />
            {rejectSheetOpen && (
                <div data-component="feedback-rejection-sheet" className="sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-rejection-title">
                    <div data-component="feedback-rejection-sheet-card" className="sheet-card">
                        <h2 id="feedback-rejection-title">기록 내용 거부</h2>
                        <p>
                            거부하시면 이 회차는 제출되지 않고, 제공인력이 내용을 수정한 뒤 다시 확인을 요청합니다.
                            수정이 필요한 부분을 알려주세요. <b>(선택)</b>
                        </p>
                        <textarea
                            className="ta"
                            placeholder="예) 분유수유 횟수가 실제와 달라요"
                            value={rejectNoteDraft}
                            onChange={(event) => setRejectNoteDraft(event.target.value)}
                        />
                        <div data-component="feedback-rejection-sheet-actions" className="sheet-actions">
                            <button className="btn ghost" type="button" onClick={closeRejectSheet}>취소</button>
                            <button className="btn danger" type="button" onClick={submitRejectionRequest}>거부하고 수정 요청</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function MomConfirmationReview({ draft }: { draft: Record<string, unknown> }) {
    return (
        <div data-component="feedback-mom-confirmation-review" className="review">
            {REVIEW_SECTIONS.map((section) => (
                <section data-component="feedback-review-section" className="review-section" key={section.id}>
                    <span className={`tag ${sectionToneClass(section.tone)}`}>{section.title}</span>
                    {section.fields.map((field) => (
                        <ReviewFieldRow key={field.key} field={field} draft={draft} />
                    ))}
                </section>
            ))}
        </div>
    );
}

function ReviewFieldRow({
    field,
    draft,
}: {
    field: ServiceRecordFieldDescriptor;
    draft: Record<string, unknown>;
}) {
    const display = formatReviewFieldValue(field, draft);
    const isText = field.kind === "text";
    const valueClassName = display.value ? (display.ok ? "ok" : "") : "empty";
    const value = display.value || REVIEW_EMPTY_LABEL;

    if (isText) {
        return (
            <div data-component="feedback-review-note" className="review-note">
                <span>{field.label}</span>
                <b className={valueClassName}>{value}</b>
            </div>
        );
    }

    return (
        <div data-component="feedback-review-row" className="review-row">
            <span>{field.label}</span>
            <b className={valueClassName}>{value}</b>
        </div>
    );
}

function Styles() {
    return (
        <style>{`
	.efb{--ink:#1c2430;--muted:#7c8798;--line:#e4e8ef;--primary:#3b6fe0;--soft:#f3f6fb;--ok:#2faa6b;--danger:#d64545;--warn:#c9803a;max-width:480px;margin:0 auto;min-height:100vh;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",Roboto,sans-serif;color:var(--ink);display:flex;flex-direction:column}
.efb .top{background:linear-gradient(135deg,#3b6fe0,#5a86ea);color:#fff;padding:18px 18px 16px}
.efb .top h1{font-size:16px;margin:0;font-weight:700}
.efb .top .org{font-size:12px;opacity:.9;margin-top:4px}
.efb .body{flex:1;padding:18px}
.efb .muted{font-size:13px;color:var(--muted)}
.efb .center{text-align:center;padding-top:40px}
.efb .pill{display:inline-block;font-size:11px;background:var(--soft);color:var(--muted);border-radius:99px;padding:4px 11px;margin-bottom:8px}
.efb .step-title{font-size:19px;font-weight:750;margin:6px 0 8px}
.efb .lab{display:block;font-size:13.5px;font-weight:700;margin:14px 0 7px}
.efb .fld{margin-bottom:14px}
.efb .in,.efb .ta{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:15px;outline:none;background:#fff}
.efb .in:focus,.efb .ta:focus{border-color:var(--primary)}
.efb .ta{min-height:90px;resize:vertical}
.efb .err{color:#c2456e;font-size:13px;margin-top:8px}
.efb .ro{display:flex;justify-content:space-between;font-size:13px;border:1px solid var(--line);border-radius:10px;padding:11px 12px;margin-bottom:8px;background:#f9fbfe}
.efb .opts{display:flex;flex-wrap:wrap;gap:8px}
.efb .opt{display:flex;align-items:center;gap:9px;border:1.5px solid var(--line);border-radius:11px;padding:11px 13px;font-size:14.5px;background:#fff;cursor:pointer;color:var(--ink)}
.efb .opt .box{width:20px;height:20px;border-radius:6px;border:2px solid #c4cdda;display:grid;place-items:center;font-size:12px;color:#fff}
.efb .opt.radio .box{border-radius:50%}
.efb .opt.sel{border-color:var(--primary);background:#f1f6ff}
.efb .opt.sel .box{background:var(--primary);border-color:var(--primary)}
	.efb .segnum{display:flex;align-items:center;gap:8px;border:1.5px solid var(--line);border-radius:12px;padding:8px 12px;margin-bottom:8px}
	.efb .segnum span{font-size:14px;color:var(--muted);white-space:nowrap}
	.efb .segnum input{flex:1;border:none;text-align:right;font-size:15px;outline:none}
	.efb .crumb{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted);margin-bottom:10px}
	.efb .crumb b{color:var(--ink)}
	.efb .datechip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:700;background:#eaf1ff;color:#3b6fe0;border-radius:10px;padding:8px 12px;margin-bottom:10px}
	.efb .dateinput{border:1px solid #cfe0ff;border-radius:8px;padding:4px 8px;font-size:13px}
	.efb .tag{display:inline-block;font-size:11px;font-weight:800;border-radius:6px;padding:3px 8px;margin-bottom:8px}
	.efb .tag.mom{background:#fde9ef;color:#c2456e}.efb .tag.baby{background:#e7f1ff;color:#3b6fe0}.efb .tag.etc{background:#eef0f4;color:#6b7686}.efb .tag.confirm{background:#e6f7ee;color:#1d8a55}
	.efb .notice{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;background:#fff7ec;border:1px solid #f0dcc0;color:var(--warn);font-size:12.5px;border-radius:10px;padding:10px 12px;margin-bottom:12px}
	.efb .notice button{border:0;background:transparent;color:var(--warn);font:inherit;font-weight:800;cursor:pointer;padding:0;white-space:nowrap}
	.efb .handover{display:flex;gap:10px;align-items:flex-start;background:#e6f7ee;border:1px solid #bfe7cf;border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:#1d8a55}
	.efb .handover span{font-size:18px;line-height:1}
	.efb .review-section{margin-top:14px}
	.efb .review-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f9fbfe}
	.efb .review-row span{color:var(--muted);flex:0 0 auto}.efb .review-row b{color:var(--ink);text-align:right;font-weight:700;word-break:keep-all}
	.efb .review-note{font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f9fbfe}
	.efb .review-note span{display:block;color:var(--muted);margin-bottom:4px}.efb .review-note b{font-weight:600;line-height:1.5}
	.efb .review-row b.empty,.efb .review-note b.empty{color:#b6bfcc;font-weight:600}
	.efb .review-row b.ok,.efb .review-note b.ok{color:var(--ok)}
	.efb .days{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:8px 0 16px}
.efb .day{border:1.5px solid var(--line);border-radius:14px;padding:14px 6px;text-align:center;background:#fff;cursor:pointer;color:var(--ink)}
.efb .day .d{font-size:11px;color:var(--muted)}.efb .day .n{font-size:20px;font-weight:800;margin-top:2px}.efb .day .st{font-size:11px;margin-top:6px;color:var(--muted)}
.efb .day.done{background:#f0faf4;border-color:#bfe7cf}.efb .day.done .st{color:var(--ok);font-weight:700}
.efb .day.current{border-color:var(--primary);box-shadow:0 0 0 3px #e8f0ff}
.efb .day.locked{opacity:.5}
.efb .nav{display:flex;gap:10px;margin-top:18px}
.efb .btn{font-family:inherit;font-size:15px;font-weight:700;border-radius:12px;border:none;padding:14px 16px;cursor:pointer;width:100%;margin-top:16px}
.efb .nav .btn{margin-top:0}
	.efb .btn.primary{background:var(--primary);color:#fff;flex:1}
	.efb .btn.ghost{background:var(--soft);color:var(--ink);flex:0 0 92px;width:auto}
	.efb .btn.ghost.schedule-change{width:100%;flex:1;margin-top:10px}
	.efb .btn.submit{background:var(--ok);color:#fff;flex:1}
	.efb .btn.reject{background:#fdeeee;color:var(--danger);border:1.5px solid #f3cccc;flex:1}
	.efb .btn.danger{background:var(--danger);color:#fff;flex:1.4}
	.efb .btn:disabled{opacity:.6}
	.efb .lock{font-size:12px;color:#9aa6b6;text-align:center;margin-top:10px}
	.efb .sheet{position:fixed;inset:0;background:rgba(28,36,48,.45);display:flex;align-items:flex-end;justify-content:center;z-index:50}
	.efb .sheet-card{width:100%;max-width:480px;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px 24px}
	.efb .sheet-card h2{font-size:16px;margin:0 0 6px}.efb .sheet-card p{font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5}
	.efb .sheet-card .ta{min-height:76px}
	.efb .sheet-actions{display:flex;gap:10px;margin-top:12px}
	.efb .sheet-actions .btn{margin-top:0}.efb .sheet-actions .btn.ghost{flex:1;width:100%}
	`}</style>
    );
}
