"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = {
    ok: true;
    state: "pending" | "verified";
    branchName: string;
    expiresAt: string;
    remainingAttempts: number;
    lockedUntil: string | null;
};

type Screen =
    | { kind: "loading" }
    | { kind: "verify"; branchName: string; remainingAttempts: number; error: string | null }
    | { kind: "locked"; branchName: string; lockedUntil: string }
    | { kind: "expired" }
    | { kind: "invalid" }
    | { kind: "image"; branchName: string; clientName: string | null };

const BRANCH_FALLBACK = "인천 아이미래로";
const FOOTER = "이 링크는 발송일로부터 30일간 유효합니다.";
const MAX_ATTEMPTS = 5;
const MIN_LOCK_REFRESH_DELAY_MS = 1_000;
const INITIAL_CLOCK_SKEW_REFRESH_DELAY_MS = 10_000;
const MAX_CLOCK_SKEW_REFRESH_DELAY_MS = 5 * 60 * 1000;
const MAX_LOCK_REFRESH_DELAY_MS = 30 * 60 * 1000;

function formatLockedUntil(iso: string): string {
    const date = new Date(iso);
    return `${date.getHours()}시 ${String(date.getMinutes()).padStart(2, "0")}분`;
}

export interface ReceiptLinkScreenProps {
    token: string;
}

export function ReceiptLinkScreen({ token }: ReceiptLinkScreenProps) {
    const api = useCallback((path: string) => `/api/receipt/${encodeURIComponent(token)}${path}`, [token]);

    const [screen, setScreen] = useState<Screen>({ kind: "loading" });
    const [birthday, setBirthday] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    const lockedUntil = screen.kind === "locked" ? screen.lockedUntil : null;
    // Cache-busting suffix for the receipt <img> src, set once (and only once — see
    // handleImageError) after a transient image load failure to trigger a single retry.
    const [imageRetryParam, setImageRetryParam] = useState("");

    // True while this component instance is mounted. Every async transition below checks
    // this after each await before calling setState, so a fetch that resolves after
    // unmount (route change, fast test teardown) never touches state on a dead component.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Shared by the mount effect below and handleImageError's 401 branch: a stale/cleared
    // access cookie surfaces on /status too, so re-running the same check re-renders the
    // right screen (verify/expired/locked/invalid).
    const loadStatus = useCallback(async () => {
        try {
            const response = await fetch(api("/status"), { cache: "no-store" });
            if (!mountedRef.current) return;
            if (response.status === 410) return setScreen({ kind: "expired" });
            if (!response.ok) return setScreen({ kind: "invalid" });
            const status = (await response.json()) as Status;
            if (!mountedRef.current) return;
            const branchName = status.branchName || BRANCH_FALLBACK;
            if (status.lockedUntil) {
                setScreen({ kind: "locked", branchName, lockedUntil: status.lockedUntil });
                return status.lockedUntil;
            }
            if (status.state === "verified") {
                const accessResponse = await fetch(api("/access"), { cache: "no-store" });
                if (!mountedRef.current) return;
                if (accessResponse.ok) {
                    setIsImageLoaded(false);
                    setScreen({ kind: "image", branchName, clientName: null });
                    return;
                }
                if (accessResponse.status === 401) {
                    setScreen({ kind: "verify", branchName, remainingAttempts: status.remainingAttempts, error: null });
                    return;
                }
                if (accessResponse.status === 410) {
                    setScreen({ kind: "expired" });
                    return;
                }
                setScreen({ kind: "invalid" });
                return;
            }
            setScreen({ kind: "verify", branchName, remainingAttempts: status.remainingAttempts, error: null });
        } catch {
            if (!mountedRef.current) return;
            setScreen({ kind: "invalid" });
        }
    }, [api]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        if (!lockedUntil) return;

        let isCancelled = false;
        let timeout: number | undefined;
        let clockSkewRefreshDelayMs = INITIAL_CLOCK_SKEW_REFRESH_DELAY_MS;

        const scheduleRefresh = (authoritativeLockedUntil: string) => {
            const remainingLockMs = new Date(authoritativeLockedUntil).getTime() - Date.now();
            const hasFutureDeadline = Number.isFinite(remainingLockMs) && remainingLockMs > 0;
            const refreshDelay = hasFutureDeadline
                ? Math.min(MAX_LOCK_REFRESH_DELAY_MS, Math.max(MIN_LOCK_REFRESH_DELAY_MS, remainingLockMs))
                : clockSkewRefreshDelayMs;

            if (hasFutureDeadline) {
                clockSkewRefreshDelayMs = INITIAL_CLOCK_SKEW_REFRESH_DELAY_MS;
            } else {
                clockSkewRefreshDelayMs = Math.min(
                    MAX_CLOCK_SKEW_REFRESH_DELAY_MS,
                    clockSkewRefreshDelayMs * 2,
                );
            }

            timeout = window.setTimeout(async () => {
                const nextLockedUntil = await loadStatus();
                if (!isCancelled && nextLockedUntil) scheduleRefresh(nextLockedUntil);
            }, refreshDelay);
        };

        scheduleRefresh(lockedUntil);

        return () => {
            isCancelled = true;
            if (timeout !== undefined) window.clearTimeout(timeout);
        };
    }, [loadStatus, lockedUntil]);

    // The <img>'s error event carries no status code, and /status doesn't consult the
    // access cookie (it's public/unauthenticated) — so it can't tell a revoked link apart
    // from a transient 5xx on an otherwise-healthy session. Probe the image endpoint
    // itself instead: 401 means the access cookie is stale/absent (re-challenge, same as
    // any other 401 elsewhere on this page); 410 means the link expired; anything else
    // (5xx, a thrown network error) is treated as transient — stay on the image screen and
    // retry the <img> exactly once via a cache-busting query param. imageRetryParam being
    // already set doubles as the "already retried" guard, so a second error (e.g. the
    // retried load also failing) does not fetch or retry again — there is no copy for a
    // broken-image state yet, so the image is simply left alone after that.
    const handleImageError = useCallback(async () => {
        if (screen.kind !== "image") return;
        setIsImageLoaded(false);
        if (imageRetryParam) return;
        try {
            // imageRetryParam is always "" here — the early return above already excludes the
            // one case where it's set — so the probe URL is plainly the bare image path (M2).
            const response = await fetch(api("/image"));
            if (!mountedRef.current) return;
            if (response.status === 401) {
                void loadStatus();
                return;
            }
            if (response.status === 410) {
                setScreen({ kind: "expired" });
                return;
            }
            setImageRetryParam("?r=1");
        } catch {
            if (!mountedRef.current) return;
            setImageRetryParam("?r=1");
        }
    }, [api, imageRetryParam, loadStatus, screen.kind]);

    const submit = async () => {
        if (screen.kind !== "verify" || isSubmitting) return;
        const digits = birthday.replace(/\D/g, "");
        if (digits.length !== 6) {
            setScreen({ ...screen, error: "생년월일 6자리(YYMMDD)를 입력해 주세요." });
            return;
        }
        setIsSubmitting(true);
        try {
            const response = await fetch(api("/verify"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ birthday: digits }),
            });
            if (!mountedRef.current) return;
            const body = (await response.json().catch(() => ({}))) as {
                clientName?: string;
                reason?: string;
                remainingAttempts?: number;
                lockedUntil?: string;
            };
            if (!mountedRef.current) return;
            if (response.ok) {
                setIsImageLoaded(false);
                setScreen({ kind: "image", branchName: screen.branchName, clientName: body.clientName || null });
                return;
            }
            if (response.status === 423 && body.lockedUntil) {
                setScreen({ kind: "locked", branchName: screen.branchName, lockedUntil: body.lockedUntil });
                return;
            }
            if (response.status === 410) return setScreen({ kind: "expired" });
            if (response.status === 401) {
                const remaining = body.remainingAttempts ?? Math.max(0, screen.remainingAttempts - 1);
                setScreen({
                    kind: "verify",
                    branchName: screen.branchName,
                    remainingAttempts: remaining,
                    error: `생년월일이 일치하지 않습니다. 남은 횟수 ${remaining}회`,
                });
                return;
            }
            // A 400 always carries { reason: "invalid_format" } here — the BFF
            // normalizes a bare validation-pipe 400 to that shape too.
            if (response.status === 400) {
                setScreen({ ...screen, error: "생년월일 6자리(YYMMDD)를 입력해 주세요." });
                return;
            }
            setScreen({ ...screen, error: "확인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
        } catch {
            if (!mountedRef.current) return;
            setScreen({ ...screen, error: "네트워크 연결을 확인해 주세요." });
        } finally {
            if (mountedRef.current) setIsSubmitting(false);
        }
    };

    const stepNumber = screen.kind === "image" ? "2단계" : "1단계";
    const stepTitle = screen.kind === "image" ? "영수증 저장" : "본인 확인";
    const progress = screen.kind === "image" ? 100 : 50;
    const branchName = "branchName" in screen ? screen.branchName : BRANCH_FALLBACK;
    const receiptOwnerLabel = screen.kind === "image" && screen.clientName ? `${screen.clientName} 산모님` : "산모님";

    return (
        <div
            className="srec"
            data-component="mobile_receipt_public-page"
            data-slot="srec"
            data-source-component="ReceiptLinkScreen"
        >
            <div className="top" data-component="mobile_receipt_public-page_top-bar" data-slot="top">
                <h1>본인부담금 영수증</h1>
                <div
                    className="top-meta"
                    data-component="mobile_receipt_public-page_top-bar_meta"
                    data-slot="top-meta"
                >
                    <div
                        className="org"
                        data-component="mobile_receipt_public-page_top-bar_meta_provider-name"
                    >
                        {branchName}
                    </div>
                    <div
                        className="crumbs"
                        data-component="mobile_receipt_public-page_top-bar_meta_crumbs"
                        data-slot="crumbs"
                    >
                        {stepNumber} · <b>{stepTitle}</b>
                    </div>
                </div>
                <div
                    className="bar"
                    data-component="mobile_receipt_public-page_top-bar_progress"
                    data-slot="bar"
                    aria-hidden="true"
                >
                    <i style={{ width: `${progress}%` }} />
                </div>
            </div>

            <div className="body" data-component="mobile_receipt_public-page_body" data-slot="body">
                {screen.kind === "loading" ? (
                    <p className="muted" data-slot="muted">
                        확인 중입니다…
                    </p>
                ) : null}

                {screen.kind === "verify" || screen.kind === "locked" ? (
                    <section data-component="mobile_receipt_public-page_body_verify">
                        <h2
                            className="step-title"
                            data-component="mobile_receipt_public-page_body_verify_title"
                            data-slot="step-title"
                        >
                            산모님 본인 확인
                        </h2>
                        <label
                            className="lab"
                            data-component="mobile_receipt_public-page_body_verify_birthday-label"
                            data-slot="lab"
                            htmlFor="receipt-birthday"
                        >
                            산모님 생년월일
                        </label>
                        <input
                            id="receipt-birthday"
                            className="in"
                            data-component="mobile_receipt_public-page_body_verify_birthday-input"
                            data-slot="in"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="예) 940315"
                            maxLength={6}
                            value={birthday}
                            disabled={screen.kind === "locked" || isSubmitting}
                            onChange={(event) => setBirthday(event.target.value.replace(/\D/g, ""))}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") void submit();
                            }}
                        />
                        <p className="rcpt-helper" data-slot="helper">
                            주민등록번호 앞 6자리
                        </p>
                        {screen.kind === "verify" && screen.error ? (
                            <p className="err" data-slot="err" role="alert">
                                {screen.error}
                            </p>
                        ) : null}
                        {screen.kind === "locked" ? (
                            <p className="err" data-slot="err" role="alert">
                                5회 연속 틀려 {formatLockedUntil(screen.lockedUntil)}까지 확인이 잠겼습니다.
                            </p>
                        ) : null}
                        <button
                            type="button"
                            className="btn primary"
                            data-component="mobile_receipt_public-page_body_verify_submit"
                            data-slot="btn"
                            disabled={screen.kind === "locked" || isSubmitting}
                            onClick={() => void submit()}
                        >
                            {screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS
                                ? "다시 확인하기"
                                : "확인하기"}
                        </button>
                        {screen.kind === "locked" ||
                        (screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS) ? (
                            <p className="rcpt-warn" data-slot="warning">
                                5회 연속 틀리면 30분 동안 확인이 잠깁니다. 계약서에 적힌 산모님 생년월일과 같은지 확인해
                                주세요.
                            </p>
                        ) : null}
                    </section>
                ) : null}

                {screen.kind === "image" ? (
                    <section className="rcpt-card" data-component="mobile_receipt_public-page_body_image">
                        <div
                            className="rcpt-img-frame"
                            data-component="mobile_receipt_public-page_body_image_frame"
                            data-slot="image-frame"
                            aria-busy={!isImageLoaded}
                        >
                            {!isImageLoaded ? (
                                <div
                                    className="rcpt-img-loading"
                                    data-component="mobile_receipt_public-page_body_image_frame_loading"
                                    data-slot="image-loading"
                                    role="status"
                                    aria-label="영수증 이미지를 불러오는 중"
                                >
                                    <span className="rcpt-spinner" aria-hidden="true" />
                                </div>
                            ) : null}
                            <img
                                className={`rcpt-img${isImageLoaded ? " is-loaded" : ""}`}
                                src={`${api("/image")}${imageRetryParam}`}
                                alt={`${receiptOwnerLabel} 본인부담금 영수증`}
                                onLoad={() => setIsImageLoaded(true)}
                                onError={() => void handleImageError()}
                            />
                        </div>
                        <a
                            className="rcpt-btn rcpt-btn-icon"
                            href={api("/image?download=1")}
                            download
                            data-component="mobile_receipt_public-page_body_image_save"
                        >
                            <DownloadIcon />
                            이미지 저장
                        </a>
                    </section>
                ) : null}

                {screen.kind === "expired" ? (
                    <section className="rcpt-card" data-component="mobile_receipt_public-page_body_expired">
                        <ClockIcon />
                        <h2>링크 유효기간이 지났습니다</h2>
                        <p className="rcpt-desc">
                            영수증 링크는 발송일로부터 30일까지 열어보실 수 있습니다. 영수증이 다시 필요하시면 인천
                            아이미래로에 연락 주세요.
                        </p>
                    </section>
                ) : null}

                {screen.kind === "invalid" ? (
                    <section className="rcpt-card" data-component="mobile_receipt_public-page_body_invalid">
                        <h2>사용할 수 없는 링크입니다</h2>
                        <p className="rcpt-desc">
                            문자에 있는 링크를 다시 눌러 주세요. 계속 열리지 않으면 인천 아이미래로에 연락 주세요.
                        </p>
                    </section>
                ) : null}

                <footer className="rcpt-foot">{FOOTER}</footer>
            </div>

            <Styles />
        </div>
    );
}

function ClockIcon() {
    return (
        <svg className="rcpt-icon rcpt-icon-clock" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg className="rcpt-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 18h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Styles() {
    return (
        <style>{`
.srec .rcpt-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.srec .rcpt-card h2{margin:0 0 8px;font-size:18px;font-weight:800}
.srec .rcpt-desc{margin:0 0 16px;color:var(--muted)}
.srec .rcpt-card .rcpt-btn{display:block;width:100%;margin-top:16px;border:0;border-radius:12px;padding:14px 16px;background:var(--primary);color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none}
.srec .rcpt-helper{margin:6px 0 0;color:var(--muted);font-size:13px}
.srec .rcpt-btn-icon{display:flex;align-items:center;justify-content:center;gap:6px}
.srec .rcpt-icon{width:18px;height:18px;flex-shrink:0}
.srec .rcpt-icon-clock{width:28px;height:28px;color:var(--muted);margin-bottom:8px}
.srec .rcpt-warn{margin:14px 0 0;padding:12px 14px;border-radius:12px;background:#fdf1f5;color:#c2456e;font-size:13px}
.srec .rcpt-img-frame{position:relative;width:100%;min-width:100%;min-height:min(568px,calc((100vw - 76px)*297/210));aspect-ratio:210/297;margin-top:12px;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#f7f8fa}
.srec .rcpt-img-loading{position:absolute;inset:0;z-index:1;display:grid;place-items:center}
.srec .rcpt-spinner{width:30px;height:30px;border:3px solid #d7deea;border-top-color:var(--primary);border-radius:50%;animation:rcpt-spin .8s linear infinite}
.srec .rcpt-img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain;opacity:0}
.srec .rcpt-img.is-loaded{opacity:1}
.srec .rcpt-foot{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
@keyframes rcpt-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.srec .rcpt-spinner{animation:none}}
`}</style>
    );
}
