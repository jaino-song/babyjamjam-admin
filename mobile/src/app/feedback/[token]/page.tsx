"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { addBusinessDaysKr, isBusinessDayKr, nextBusinessDayKr } from "@/lib/date/business-days";

/* ───────────────────────── form definition (mirrors the 제공기록지) ───────────────────────── */

type ItemType = "multi" | "radio" | "counts" | "stool" | "textarea" | "confirm" | "sign";
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
    { key: "momSignature", label: "산모 확인서명", type: "sign" },
];
const DAY_PAGES = [
    { tag: "산모", title: "산모 기록", sub: "① ~ ⑤", items: [0, 1, 2, 3, 4] },
    { tag: "신생아", title: "신생아 기록", sub: "⑥ ~ ⑪", items: [5, 6, 7, 8, 9, 10] },
    { tag: "마무리", title: "마무리 · 확인", sub: "기타 · 특이사항 · 결제 확인 · 산모 확인서명", items: [11, 12, 13, 14] },
];

/* ───────────────────────── types from the backend ───────────────────────── */

interface SessionRow {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    answers?: Record<string, unknown>;
    etcService?: string | null;
    notes?: string | null;
    paymentConfirmed?: boolean;
    momSignature?: string | null;
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

type Screen = "loading" | "invalid" | "dob" | "service" | "overview" | "day" | "done";

export default function FeedbackPage() {
    const params = useParams<{ token: string }>();
    const token = params?.token ?? "";

    const [screen, setScreen] = useState<Screen>("loading");
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [dob, setDob] = useState("");
    const [dobError, setDobError] = useState<string | null>(null);
    const [ctx, setCtx] = useState<FeedbackContext | null>(null);
    const [header, setHeader] = useState<Record<string, string>>({});
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [busy, setBusy] = useState(false);
    const [scheduleChangePreview, setScheduleChangePreview] = useState<ScheduleChangePreview | null>(null);
    const [scheduleChangeModalOpen, setScheduleChangeModalOpen] = useState(false);
    const [scheduleChangeBusy, setScheduleChangeBusy] = useState(false);

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
                setScreen(data?.valid ? "dob" : "invalid");
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
            const row = sessions.find((s) => s.sessionIndex === d);
            if (row) return row.serviceDate.slice(0, 10);

            const rawStart = ctx?.startDate ? ctx.startDate.slice(0, 10) : isoOf(new Date());
            const start = isBusinessDayKr(rawStart) ? rawStart : nextBusinessDayKr(rawStart);
            if (d <= 1) return start;
            const prev = sessions.find((s) => s.sessionIndex === d - 1);
            return prev ? nextBusinessDayKr(prev.serviceDate.slice(0, 10)) : addBusinessDaysKr(start, d - 1);
        },
        [ctx?.sessions, ctx?.startDate],
    );

    async function submitDob() {
        if (dob.replace(/\D/g, "").length < 6) { setDobError("생년월일 6자리를 입력해 주세요."); return; }
        setBusy(true); setDobError(null);
        try {
            const res = await fetch(`/api/feedback/${token}/verify`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dob }),
            });
            const data = await res.json();
            if (data?.ok && data.accessToken) {
                setAccessToken(data.accessToken);
            } else if (data?.reason === "locked") {
                setDobError("시도 횟수를 초과했습니다. 지점에 문의해 새 링크를 받아주세요.");
            } else {
                setDobError(`생년월일이 일치하지 않습니다. (남은 시도 ${data?.attemptsLeft ?? "?"}회)`);
            }
        } catch {
            setDobError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
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
                momSignature: (draft["momSignature"] as string) ?? undefined,
            };
            const res = await api(`/sessions/${day}/submit`, { method: "POST", body: JSON.stringify(body) });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                alert(e?.message ?? "제출에 실패했습니다.");
                return;
            }
            await loadContext();
            setScreen("overview");
        } finally { setBusy(false); }
    }

    async function finalize() {
        setBusy(true);
        try {
            const res = await api("/finalize", { method: "POST" });
            if (res.ok) setScreen("done");
            else alert("서명 요청 전송에 실패했습니다.");
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
        // sign
        return (
            <div data-component="feedback-signature" className="sign" onClick={() => setField(it.key, v ? "" : "signed")}>
                {v ? "✍️ 서명 완료 (탭하여 지움)" : "✍️ 산모 확인서명 (산모님께 화면 전달 · 탭하여 서명)"}
            </div>
        );
    }

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

                {screen === "dob" && (
                    <>
                        <div data-component="feedback-dob-pill" className="pill">최초 1회 인증</div>
                        <div data-component="feedback-dob-title" className="step-title">제공인력 본인 확인</div>
                        <p className="muted">본인 생년월일을 입력하면 서비스 기간 동안 유효한 접근 권한이 발급됩니다.</p>
                        <label className="lab">생년월일 (YYMMDD)</label>
                        <input className="in" inputMode="numeric" maxLength={6} placeholder="예) 880312" value={dob} onChange={(e) => setDob(e.target.value)} />
                        {dobError && <p className="err">{dobError}</p>}
                        <button className="btn primary" disabled={busy} onClick={submitDob}>{busy ? "확인 중…" : "확인하고 시작"}</button>
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
                            <button className="btn submit" disabled={busy} onClick={finalize}>{busy ? "전송 중…" : "서비스 종료 · 서명 요청 보내기"}</button>
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
                        <div data-component="feedback-date-chip" className="datechip">📅 제공일자
                            <input type="date" className="dateinput" value={(draft["_date"] as string) ?? defaultDate(day)} min={day <= 1 ? (ctx?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day)} onChange={(e) => setField("_date", e.target.value)} />
                            · {day}회차
                        </div>
                        <div data-component="feedback-section-tag" className={`tag ${DAY_PAGES[pageIdx].tag === "산모" ? "mom" : DAY_PAGES[pageIdx].tag === "신생아" ? "baby" : "etc"}`}>{DAY_PAGES[pageIdx].tag}</div>
                        <div data-component="feedback-day-title" className="step-title">{DAY_PAGES[pageIdx].title}</div>
                        <p className="muted">{DAY_PAGES[pageIdx].sub}</p>
                        {DAY_PAGES[pageIdx].items.map((idx) => (
                            <div data-component="feedback-day-field" className="fld" key={DAILY_ITEMS[idx].key}>
                                <label className="lab">{DAILY_ITEMS[idx].label}</label>
                                {renderField(DAILY_ITEMS[idx])}
                            </div>
                        ))}
                        <div data-component="feedback-nav" className="nav">
                            <button className="btn ghost" onClick={() => (pageIdx > 0 ? setPageIdx(pageIdx - 1) : setScreen("overview"))}>이전</button>
                            {pageIdx < DAY_PAGES.length - 1 ? (
                                <button className="btn primary" onClick={() => setPageIdx(pageIdx + 1)}>다음</button>
                            ) : (
                                <button className="btn submit" disabled={busy} onClick={submitDay}>{busy ? "제출 중…" : "제출 · 잠금"}</button>
                            )}
                        </div>
                        {pageIdx === DAY_PAGES.length - 1 && <p className="lock">제출하면 이 회차 기록은 잠기며 수정할 수 없습니다.</p>}
                    </>
                )}

                {screen === "done" && (
                    <div data-component="feedback-done-center" className="center">
                        <div data-component="feedback-done-title" className="step-title">제공기록지 작성 완료 ✅</div>
                        <p className="muted">전체 기록이 하나의 문서로 만들어져 서명 요청 문자가 발송되었습니다. 문자의 링크에서 서명해 주세요.</p>
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
        </div>
    );
}

function Styles() {
    return (
        <style>{`
.efb{--ink:#1c2430;--muted:#7c8798;--line:#e4e8ef;--primary:#3b6fe0;--soft:#f3f6fb;--ok:#2faa6b;max-width:480px;margin:0 auto;min-height:100vh;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",Roboto,sans-serif;color:var(--ink);display:flex;flex-direction:column}
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
.efb .sign{height:120px;border:1.5px dashed #c4cdda;border-radius:12px;display:grid;place-items:center;color:var(--muted);font-size:13px;text-align:center;cursor:pointer;padding:0 12px}
.efb .datechip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:700;background:#eaf1ff;color:#3b6fe0;border-radius:10px;padding:8px 12px;margin-bottom:10px}
.efb .dateinput{border:1px solid #cfe0ff;border-radius:8px;padding:4px 8px;font-size:13px}
.efb .tag{display:inline-block;font-size:11px;font-weight:800;border-radius:6px;padding:3px 8px;margin-bottom:8px}
.efb .tag.mom{background:#fde9ef;color:#c2456e}.efb .tag.baby{background:#e7f1ff;color:#3b6fe0}.efb .tag.etc{background:#eef0f4;color:#6b7686}
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
.efb .btn:disabled{opacity:.6}
.efb .lock{font-size:12px;color:#9aa6b6;text-align:center;margin-top:10px}
`}</style>
    );
}
