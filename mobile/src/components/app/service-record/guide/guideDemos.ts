/**
 * The guide's demo player: five scripted loops that act on a miniature, decorative copy of the
 * service-record screens (touch indicator, typing, page swaps, signature, modal, spotlight).
 *
 * It drives plain DOM through refs (the mini screen is not React state), so every wait goes through a
 * `DemoRun`. Stopping the run clears every pending timer / animation frame at once and rejects the
 * waits, which unwinds the running script — nothing fires after a slide change, a close or an unmount.
 * Only static strings are written with `innerHTML`; typed text and labels go through `textContent`.
 */
import styles from "./ServiceRecordGuide.module.css";

export type DemoName = "basics" | "grid" | "form" | "sign" | "edit";

/** Loop lengths in ms, refined from every completed loop so the progress bar stays honest. */
const EXPECTED_LOOP_MS: Record<DemoName, number> = {
    basics: 14000, grid: 12000, form: 22000, sign: 16000, edit: 24000,
};
const loopMs: Record<DemoName, number> = { ...EXPECTED_LOOP_MS };

/* ---------- cancellation ---------- */

class DemoStop extends Error {}

export interface DemoRun {
    readonly stopped: boolean;
    /** Resolves after `ms`; rejects with `DemoStop` once the run is stopped. */
    sleep(ms: number): Promise<void>;
    /** Resolves on the next animation frame with a timestamp; rejects once stopped. */
    frame(): Promise<number>;
    stop(): void;
}

export function createDemoRun(): DemoRun {
    let stopped = false;
    const cancellers = new Set<() => void>();

    const wait = <T>(start: (settle: (value: T) => void) => () => void): Promise<T> => new Promise<T>((resolve, reject) => {
        if (stopped) {
            reject(new DemoStop());
            return;
        }
        let cancelTask: () => void = () => {};
        const cancel = () => {
            cancelTask();
            reject(new DemoStop());
        };
        cancelTask = start((value) => {
            cancellers.delete(cancel);
            resolve(value);
        });
        cancellers.add(cancel);
    });

    return {
        get stopped() { return stopped; },
        sleep: (ms) => wait<void>((settle) => {
            const timer = setTimeout(() => settle(undefined), ms);
            return () => clearTimeout(timer);
        }),
        frame: () => wait<number>((settle) => {
            if (typeof requestAnimationFrame === "function") {
                const handle = requestAnimationFrame((now) => settle(now));
                return () => { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle); };
            }
            const timer = setTimeout(() => settle(performance.now()), 16);
            return () => clearTimeout(timer);
        }),
        stop() {
            if (stopped) return;
            stopped = true;
            const pending = [...cancellers];
            cancellers.clear();
            for (const cancel of pending) cancel();
        },
    };
}

/* ---------- DOM helpers ---------- */

/** Maps the prototype's class names onto this module's generated ones. */
const cls = (names: string): string => names.split(" ").map((name) => styles[name] ?? name).join(" ");

/** `#id` means `data-g="id"` (no document-wide ids); `.class` means the module's class. */
const toSelector = (selector: string): string => selector
    .replace(/\.([\w-]+)/g, (_match, name: string) => `.${styles[name] ?? name}`)
    .replace(/#([\w-]+)/g, '[data-g="$1"]');

function find(root: ParentNode, selector: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(toSelector(selector));
}

function $(root: ParentNode, selector: string): HTMLElement {
    const element = find(root, selector);
    if (!element) throw new Error(`guide demo: ${selector} not found`);
    return element;
}

const addClass = (el: Element, names: string) => el.classList.add(...cls(names).split(" "));
const removeClass = (el: Element, names: string) => el.classList.remove(...cls(names).split(" "));

function scrollBodyTo(body: HTMLElement, top: number, smooth: boolean) {
    if (typeof body.scrollTo === "function") body.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    else body.scrollTop = top;
}

export interface DemoElements {
    stage: HTMLElement;
    m: HTMLElement;
    touch: HTMLElement;
    spot: HTMLElement | null;
    fill: HTMLElement;
}

interface DemoCtx {
    run: DemoRun;
    stage: HTMLElement;
    m: HTMLElement;
    touch: HTMLElement;
    spot: HTMLElement | null;
}

/* ---------- markup ---------- */

function markSlots(root: HTMLElement) {
    // These decorative slots belong to the stage's mini-screen, never to document-wide IDs.
    const names = new Map(Object.entries(styles).map(([slot, className]) => [className, slot]));
    root.querySelectorAll<HTMLElement>("[class]").forEach((el) => {
        const slot = names.get(el.classList[0]) ?? el.classList[0];
        el.dataset.slot = slot;
    });
}
/** App coordinates (390px wide) are scaled by CSS into the 290px miniature. */
function setScreen(m: HTMLElement, html: string) {
    m.innerHTML = `<div class="${cls("m-app")}">${html}</div>`;
    markSlots(m);
}

function field(id: string, label: string, placeholder: string, extra = "", unit = ""): string {
    return `<div class="${cls("fld")}"><span class="${cls("fld-l")}">${label}</span><div class="${cls(`inp ${extra} ${unit ? "with-unit" : ""}`.trim())}" data-g="${id}"><span class="${cls("ph")}">${placeholder}</span><span class="${cls("v")}"></span>${unit ? `<span class="${cls("unit")}">${unit}</span>` : ""}</div></div>`;
}

function chips(id: string, question: string, options: string[], selected = false, kind: "radio" | "check" = "radio"): string {
    return `<div class="${cls("grp")}"><div class="${cls("q")}">${question}</div><div class="${cls("chips")}">${options.map((option, index) => `<span class="${cls(`ch ${kind} ${selected && index === 0 ? "on" : ""}`.trim())}" data-g="${id}${index}">${option}</span>`).join("")}</div></div>`;
}

function head(crumb: string, progress = 3): string {
    return `<div class="${cls("m-head")}"><div class="${cls("m-brand")}">산모·신생아 건강관리 서비스 제공기록지</div><div class="${cls("m-meta")}"><span>인천 아이미래로</span><span class="${cls("m-crumb")}">${crumb}</span></div><div class="${cls("m-prog")}"><i style="width:${progress / 4 * 100}%"></i></div></div>`;
}
const back = () => `<div class="${cls("m-back")}">이전</div>`;
const title = (text: string, badge = "") => `<div class="${cls("m-title")}">${text}${badge ? `<span class="${cls("status")}">${badge}</span>` : ""}</div>`;
const footer = (label = "다음", disabled = false, deletable = false) => `<div class="${cls("m-foot")}">${deletable ? `<div class="${cls("m-btn delete-outline")}" data-g="del">기록 삭제</div>` : ""}<div class="${cls(`m-btn ${disabled ? "off" : ""}`.trim())}" data-g="go">${label}</div></div>`;
const modal = (): string => `<div class="${cls("m-modal")}"><div class="${cls("m-box")}"><h4></h4><p></p><div class="${cls("acts")}"><div class="${cls("m-btn cancel")}">취소</div><div class="${cls("m-btn")}" data-g="mok">확인</div></div></div></div><div class="${cls("toast")}"></div>`;

type CardState = "done" | "current" | "locked";
function cardHTML(index: number, state: CardState): string {
    const label = { done: "제출완료", current: "입력 가능", locked: "대기" }[state];
    const date = state === "done" ? `2026.11.${String(index + 1).padStart(2, "0")}` : "";
    return `<div class="${cls(`card ${state}`)}" data-g="c${index}"><div class="${cls("d")}">${date}</div><div class="${cls("n")}">${index}</div><div class="${cls("s")}">${label}</div></div>`;
}
function gridScreen(states: CardState[]): string {
    return `${head("3단계 · 일자별 기록")}<div class="${cls("m-body")}"><div class="${cls("grid-heading")}">${title("제공기록표")}<span>사용방법</span></div><div class="${cls("m-help")}">제출된 기록은 눌러서 수정할 수 있습니다.</div><div class="${cls("cards")}">${states.map((state, index) => cardHTML(index + 1, state)).join("")}</div></div>${footer("다음 회차 입력")}${modal()}`;
}

const PAGES = {
    mom: chips("p", "① 회음절개부위 (또는 수술부위)", ["이상없음", "열상", "혈종", "불편감"], true, "check")
        + chips("b", "② 유방상태", ["이상없음", "울혈", "통증"], true, "check")
        + chips("u", "③ 배뇨/배변", ["이상없음", "불편감"], true, "check")
        + chips("z", "④ 좌욕", ["실시", "미실시"], true)
        + `<div class="${cls("grp")}"><div class="${cls("q")}">⑤ 식사/간식</div><div class="${cls("nums")}">${field("meal", "식사", "횟수", "", "회")}${field("snack", "간식", "횟수", "", "회")}</div></div>`,
    baby: field("temp", "⑥ 체온", "체온", "", "℃")
        + chips("sl", "⑦ 수면 양상", ["잘 잠", "잘 못 잠"], true)
        + field("bf", "⑧ 모유수유", "횟수", "", "회")
        + `<div class="${cls("nums")}">${field("ff", "⑨ 분유수유", "횟수", "", "회")}${field("amount", "", "회당", "", "ml")}</div>`
        + chips("pp", "⑩ 배변양상", ["정상변", "이상변"], true)
        + chips("bt", "⑪ 목욕·제대관리", ["실시", "미실시"], true),
    svc: field("etc", "기타 서비스 (필요 시 기재)", "예: 신생아 옷 정리", "area")
        + field("note", "특이사항 (필요 시 기재)", "예: 산모 요청으로 간식 시간을 변경함", "area")
        + chips("pay", "결제 확인", ["결제 확인 완료"], false, "check"),
};

const basicsScreen = (): string => `${head("2단계 · 서비스 기본정보", 1)}<div class="${cls("m-body")}">${back()}${title("서비스 기본정보")}<div class="${cls("ro")}"><span>제공인력</span><b>미나미</b></div><div class="${cls("ro")}"><span>제공기관</span><b>인천 아이미래로</b></div>${field("f1", "산모 성명", "예: 이예지")}${field("f2", "산모 생년월일", "1994-03-15")}${field("f3", "신생아 성명", "예: 이아기")}${field("f4", "신생아 출생일자", "2026-09-20")}<div class="${cls("fld")}"><span class="${cls("fld-l")}">분만형태</span><div class="${cls("chips")}"><span class="${cls("ch on")}" data-g="d0">자연분만</span><span class="${cls("ch")}" data-g="d1">제왕절개</span></div></div>${field("f5", "신생아 몸무게 (kg)", "예: 3.2")}</div>${footer()}${modal()}`;

const SIGN_PATH = "M18 50 C 26 18, 40 18, 36 44 C 33 60, 50 56, 58 34 C 62 22, 70 22, 68 40 C 66 56, 84 54, 92 36 C 98 24, 110 26, 106 44 C 104 56, 122 52, 132 30 C 138 20, 146 34, 150 46 C 156 58, 170 44, 178 34 L 190 40";

function reviewRow(label: string, value: string, id = "", extra = ""): string {
    return `<div class="${cls(`rw ${extra}`.trim())}"><span>${label}</span><b${id ? ` data-g="${id}"` : ""}>${value}</b></div>`;
}
function section(label: string, content: string, editId = "", tone = ""): string {
    return `<div class="${cls("sec")}"><div class="${cls("sec-h")}"><span class="${cls(`section-tag ${tone}`.trim())}">${label}</span>${editId ? `<span class="${cls("edit")}" data-g="${editId}">수정</span>` : ""}</div>${content}</div>`;
}
function reviewHTML(submitted: boolean): string {
    return section("산모", reviewRow("① 회음절개부위 (또는 수술부위)", "이상없음") + reviewRow("② 유방상태", "이상없음") + reviewRow("③ 배뇨/배변", "이상없음") + reviewRow("④ 좌욕", "실시") + reviewRow("⑤ 식사/간식", "식사 2회 · 간식 1회"), submitted ? "e-mom" : "", "warm")
        + section("신생아", reviewRow("⑥ 체온", "36.6℃") + reviewRow("⑦ 수면 양상", "잘 잠") + reviewRow("⑧ 모유수유", "6회") + reviewRow("⑨ 분유수유", "1회 · 회당 60ml") + reviewRow("⑩ 배변양상", "정상변 (노란색)") + reviewRow("⑪ 목욕·제대관리", "실시"), submitted ? "e-baby" : "")
        + section("서비스 기록", reviewRow("기타 서비스 (필요 시 기재)", "입력 없음", "", "rw-note") + reviewRow("특이사항 (필요 시 기재)", "오후 수유 시간 조정", "", "rw-note") + reviewRow("결제 확인", "✓ 확인 완료", "", "payment"), submitted ? "e-svc" : "")
        + (submitted ? `<span class="${cls("done-chip on")}">서명 완료 · 2026.11.02</span>` : `<div class="${cls("signature")}"><div class="${cls("sig-l")}">산모 서명 <small>지우기</small></div><div class="${cls("sig")}"><span class="${cls("hint")}">여기에 손가락으로 서명해 주세요</span><svg viewBox="0 0 208 74"><path data-g="sigpath" d="${SIGN_PATH}" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" visibility="hidden"/></svg></div><div class="${cls("sig-note")}">기록 내용을 확인하였음을 서명으로 확인합니다.</div><span class="${cls("done-chip")}" data-g="sigok">서명 완료 · 2026.11.05</span></div>`);
}
const signScreen = (): string => `${head("4회차 · 기록 내용 확인 (4/4)", 4)}<div class="${cls("m-body")}">${back()}${title("기록 내용 확인")}${reviewHTML(false)}</div>${footer("확인", true)}${modal()}`;
const reviewScreen = (changed = false): string => `${head("1회차 · 기록 수정 (4/4)", 4)}<div class="${cls("m-body")}">${back()}${title("1회차 기록 수정", "제출완료")}${section("서비스 제공일", reviewRow("서비스 제공일", changed ? `<del>11.02</del> <strong>2026.11.05 (목)</strong>` : "2026.11.02 (월)", "r-date") + (changed ? `<p class="${cls("date-note")}">다른 회차 날짜는 바뀌지 않아요.</p>` : ""), "e-date", changed ? "warm" : "")}${reviewHTML(true)}</div>${footer("확인", false, true)}${modal()}`;
const momScreen = (filled = true): string => `${head("4회차 · 산모 기록 (1/4)", 1)}<div class="${cls("m-body")}">${back()}<div class="${cls("session-chip")}" data-g="session">${filled ? "4회차 · 2026.11.05" : "4회차"}</div>${field("sd", "서비스 제공일", filled ? "4회차 · 2026.11.05" : "날짜를 선택하세요", filled ? "date-filled" : "")}${title("산모 기록")}${PAGES.mom}</div>${footer()}${modal()}`;
const recordScreen = (step: "baby" | "svc"): string => `${head(`4회차 · ${step === "baby" ? "신생아 기록 (2/4)" : "서비스 기록 (3/4)"}`, step === "baby" ? 2 : 3)}<div class="${cls("m-body")}">${back()}${title(step === "baby" ? "신생아 기록" : "서비스 기록")}${PAGES[step]}</div>${footer()}${modal()}`;

const GRID_STATES: CardState[] = ["done", "done", "done", "current", "locked", "locked", "locked", "locked", "locked", "locked"];

/** A miniature of the captured November sheet; its body never shares the background scroll area. */
function calendarHTML(edit: boolean): string {
    const taken: Record<number, string> = edit ? { 3: "2회차", 4: "3회차" } : { 2: "1회차", 3: "2회차", 4: "3회차" };
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const days = Array.from({ length: 30 }, (_, index) => {
        const day = index + 1;
        const own = edit && day === 2;
        const blocked = !own && (index % 7 === 0 || index % 7 === 6 || day > 24 || Boolean(taken[day]));
        return `<div class="${cls(`cal-day ${own ? "own" : blocked ? "blocked" : ""}`.trim())}" data-g="day-${day}" data-blocked="${blocked}" data-current="${own}"><b>${day}</b>${own || taken[day] ? `<small>${own ? "지금" : taken[day]}</small>` : ""}</div>`;
    }).join("");
    return `<div class="${cls("cal-overlay")}" data-slot="cal-overlay"><div class="${cls("cal-sheet")}" data-slot="cal-sheet"><i class="${cls("cal-handle")}"></i><div class="${cls("cal-title")}">${edit ? 1 : 4}회차 서비스 제공일<span>×</span></div><p class="${cls("cal-sub")}">${edit ? "지금 2026.11.02(월)" : "날짜를 골라 주세요."}</p><p class="${cls("cal-range")}">고를 수 있는 기간: 10.26(월) ~ 11.24(화)</p><div class="${cls("cal-month")}"><b>2026년 11월</b><span>‹</span><span>›</span></div><div class="${cls("cal-grid")}">${weekdays.map((day) => `<span class="${cls("weekday")}">${day}</span>`).join("")}${days}</div><div class="${cls("cal-legend")}"><span><i class="${cls("selected-key")}"></i>선택한 날</span><span><i></i>선택 가능</span><span><i class="${cls("blocked")}"></i>고를 수 없음 (주말·기간 밖·다른 회차)</span></div><div class="${cls("cal-actions acts")}"><div class="${cls("m-btn cancel")}">취소</div><div class="${cls("m-btn off")}" data-g="calok" data-disabled="true">선택</div></div></div></div>`;
}

/* ---------- touch indicator and actions ---------- */

/** Position of `el`'s centre in stage coordinates, undoing any scale applied to the stage. */
function stageXY(stage: HTMLElement, el: HTMLElement): [number, number] {
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = s.width / stage.offsetWidth || 1;
    return [(r.left + r.width / 2 - s.left) / k, (r.top + r.height / 2 - s.top) / k];
}

async function moveTo(ctx: DemoCtx, el: HTMLElement, ms = 520) {
    const [x, y] = stageXY(ctx.stage, el);
    const t = ctx.touch;
    t.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1), opacity .25s`;
    t.style.opacity = "1";
    t.style.transform = `translate(${x}px,${y}px)`;
    await ctx.run.sleep(ms + 60);
}

/** Scrolls the mini body just enough that `el` is visible. */
async function reveal(ctx: DemoCtx, el: HTMLElement) {
    const body = find(ctx.m, ".m-body");
    if (!body || !body.contains(el) || ctx.m.dataset.overlay === "true") return;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = b.height / body.offsetHeight || 1;
    let d = 0;
    if (r.bottom > b.bottom - 6) d = (r.bottom - b.bottom + 14) / k;
    else if (r.top < b.top) d = (r.top - b.top - 10) / k;
    if (!d) return;
    scrollBodyTo(body, body.scrollTop + d, true);
    await ctx.run.sleep(380);
}

async function tap(ctx: DemoCtx, target: string | HTMLElement, after?: (el: HTMLElement) => Promise<void> | void) {
    const el = typeof target === "string" ? $(ctx.m, target) : target;
    await reveal(ctx, el);
    await moveTo(ctx, el);
    ctx.touch.dataset.tap = "false";
    void ctx.touch.offsetWidth;
    ctx.touch.dataset.tap = "true";
    addClass(el, "press");
    await ctx.run.sleep(160);
    removeClass(el, "press");
    if (after) await after(el);
    await ctx.run.sleep(260);
}

async function type(ctx: DemoCtx, selector: string, text: string, speed = 85) {
    const el = $(ctx.m, selector);
    await tap(ctx, el);
    ctx.m.querySelectorAll(toSelector(".inp.focus")).forEach((focused) => removeClass(focused, "focus"));
    addClass(el, "focus has");
    const value = $(el, ".v");
    value.textContent = "";
    for (const char of text) {
        value.textContent += char;
        await ctx.run.sleep(speed);
    }
    await ctx.run.sleep(150);
    removeClass(el, "focus");
}

const hideTouch = (ctx: DemoCtx) => { ctx.touch.style.opacity = "0"; };
const turnOn = (ctx: DemoCtx, selector: string) => addClass($(ctx.m, selector), "on");

async function toast(ctx: DemoCtx, text: string, ms = 1300) {
    const t = $(ctx.m, ".toast");
    t.textContent = text;
    addClass(t, "on");
    await ctx.run.sleep(ms);
    removeClass(t, "on");
}

async function confirmModal(ctx: DemoCtx) {
    const md = $(ctx.m, ".m-modal");
    $(md, "h4").textContent = "제출하시겠어요?";
    $(md, "p").textContent = "확인하면 4회차 기록이 제출됩니다.";
    ctx.m.dataset.overlay = "true";
    addClass(md, "on");
    await ctx.run.sleep(900);
    await tap(ctx, "#mok");
    removeClass(md, "on");
    ctx.m.dataset.overlay = "false";
}

async function openCalendar(ctx: DemoCtx, edit: boolean) {
    ctx.m.dataset.overlay = "true";
    $(ctx.m, ".m-app").insertAdjacentHTML("beforeend", calendarHTML(edit));
    markSlots(ctx.m);
    await ctx.run.sleep(edit ? 900 : 800);
}
async function pickDay(ctx: DemoCtx) {
    await tap(ctx, "#day-5", (day) => {
        addClass(day, "selected");
        const ok = $(ctx.m, "#calok");
        removeClass(ok, "off");
        ok.dataset.disabled = "false";
    });
    await ctx.run.sleep(400);
}
async function closeCalendar(ctx: DemoCtx) {
    await tap(ctx, "#calok");
    $(ctx.m, ".cal-overlay").remove();
    ctx.m.dataset.overlay = "false";
}

/** A dark frame closes in from the stage edges onto `el`, like a crop box. */
async function spotlight(ctx: DemoCtx, el: HTMLElement) {
    const spot = ctx.spot;
    if (!spot) return;
    const st = ctx.stage.getBoundingClientRect();
    const k = st.width / ctx.stage.offsetWidth || 1;
    const box = (left: number, top: number, width: number, height: number, radius: number) => Object.assign(spot.style, {
        left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, borderRadius: `${radius}px`,
    });
    spot.style.transition = "none";
    spot.dataset.on = "false";
    box(0, 0, ctx.stage.offsetWidth, ctx.stage.offsetHeight, 20);
    await ctx.run.sleep(700);
    const c = el.getBoundingClientRect();
    const pad = 5;
    spot.style.transition = "left .9s cubic-bezier(.6,0,.2,1), top .9s cubic-bezier(.6,0,.2,1), width .9s cubic-bezier(.6,0,.2,1), height .9s cubic-bezier(.6,0,.2,1), border-radius .9s, box-shadow .4s, opacity .3s";
    spot.dataset.on = "true";
    box((c.left - st.left) / k - pad, (c.top - st.top) / k - pad, c.width / k + pad * 2, c.height / k + pad * 2, 12);
    await ctx.run.sleep(1700);
}

async function spotOff(ctx: DemoCtx) {
    if (ctx.spot) ctx.spot.dataset.on = "false";
    await ctx.run.sleep(350);
}

async function showDone(ctx: DemoCtx) {
    const done = document.createElement("div");
    done.className = cls("m-done");
    done.innerHTML = `<span class="${cls("ok")}">✓</span><b>완료</b>`;
    ctx.m.appendChild(done);
    markSlots(ctx.m);
    void done.offsetWidth;
    addClass(done, "on");
    await ctx.run.sleep(2000);
    done.remove();
}

/** The touch follows the pen stroke while the signature is drawn along its path. */
async function drawSign(ctx: DemoCtx) {
    const path = ctx.m.querySelector<SVGPathElement>('[data-g="sigpath"]');
    const length = path && typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
    if (!path || !length || typeof path.getPointAtLength !== "function") {
        // No SVG geometry here (jsdom): keep the loop's timing, skip the stroke.
        await ctx.run.sleep(900);
        await reveal(ctx, $(ctx.m, ".signature"));
        await ctx.run.sleep(550 + 1700 + 200);
        path?.removeAttribute("visibility");
        $(ctx.m, ".sig .hint").style.opacity = "0";
    } else {
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
        await ctx.run.sleep(900);
        await reveal(ctx, $(ctx.m, ".signature"));
        const svg = path.ownerSVGElement ?? path;
        const s = ctx.stage.getBoundingClientRect();
        const r = svg.getBoundingClientRect();
        const k = s.width / ctx.stage.offsetWidth || 1;
        const scale = r.width / 208;
        const at = (p: DOMPoint): [number, number] => [(r.left - s.left + p.x * scale) / k, (r.top - s.top + p.y * scale) / k];
        const [x0, y0] = at(path.getPointAtLength(0));
        ctx.touch.style.transition = "transform .5s, opacity .25s";
        ctx.touch.style.opacity = "1";
        ctx.touch.style.transform = `translate(${x0}px,${y0}px)`;
        await ctx.run.sleep(550);
        $(ctx.m, ".sig .hint").style.opacity = "0";
        path.removeAttribute("visibility");
        ctx.touch.style.transition = "opacity .25s";
        const duration = 1700;
        const t0 = performance.now();
        for (;;) {
            const now = await ctx.run.frame();
            const f = Math.min(1, (now - t0) / duration);
            path.style.strokeDashoffset = String(length - length * f);
            const [x, y] = at(path.getPointAtLength(length * f));
            ctx.touch.style.transform = `translate(${x}px,${y}px)`;
            if (f >= 1) break;
        }
        await ctx.run.sleep(200);
    }
    turnOn(ctx, "#sigok");
    removeClass($(ctx.m, "#go"), "off");
}

/* ---------- demo scripts ---------- */

const DEMOS: Record<DemoName, (ctx: DemoCtx) => Promise<void>> = {
    async basics(ctx) {
        renderInitialFrame("basics", ctx.m);
        await ctx.run.sleep(500);
        await type(ctx, "#f1", "이예지", 110);
        await type(ctx, "#f2", "1994-03-15", 60);
        await type(ctx, "#f3", "이아기", 110);
        await type(ctx, "#f4", "2026-09-20", 60);
        await tap(ctx, "#d1", () => { removeClass($(ctx.m, "#d0"), "on"); turnOn(ctx, "#d1"); });
        await type(ctx, "#f5", "3.2", 110);
        await tap(ctx, "#go");
        hideTouch(ctx);
        await showDone(ctx);
    },

    async grid(ctx) {
        renderInitialFrame("grid", ctx.m);
        const current = $(ctx.m, "#c4");
        await spotlight(ctx, current);
        await spotOff(ctx);
        await tap(ctx, current);
        setScreen(ctx.m, momScreen(false));
        await ctx.run.sleep(700);
        await tap(ctx, "#sd");
        await openCalendar(ctx, false);
        await pickDay(ctx);
        await closeCalendar(ctx);
        fillValue(ctx.m, "sd", "4회차 · 2026.11.05");
        $(ctx.m, "#session").textContent = "4회차 · 2026.11.05";
        addClass($(ctx.m, "#sd"), "date-filled");
        hideTouch(ctx);
        await ctx.run.sleep(1300);
    },

    async form(ctx) {
        renderInitialFrame("form", ctx.m);
        await ctx.run.sleep(600);
        await type(ctx, "#meal", "2", 110);
        await type(ctx, "#snack", "1", 110);
        await tap(ctx, "#go");
        setScreen(ctx.m, recordScreen("baby"));
        await ctx.run.sleep(500);
        await type(ctx, "#temp", "36.6", 110);
        await type(ctx, "#bf", "6", 110);
        await tap(ctx, "#go");
        setScreen(ctx.m, recordScreen("svc"));
        await ctx.run.sleep(500);
        await type(ctx, "#note", "오후 수유 시간 조정", 90);
        await tap(ctx, "#pay0", (el) => addClass(el, "on"));
        await tap(ctx, "#go");
        setScreen(ctx.m, signScreen());
        hideTouch(ctx);
        await ctx.run.sleep(1200);
    },

    async sign(ctx) {
        renderInitialFrame("sign", ctx.m);
        await ctx.run.sleep(600);
        await drawSign(ctx);
        await ctx.run.sleep(500);
        await tap(ctx, "#go");
        await confirmModal(ctx);
        hideTouch(ctx);
        await showDone(ctx);
        setScreen(ctx.m, gridScreen(["done", "done", "done", "done", "current", "locked", "locked", "locked", "locked", "locked"]));
        await ctx.run.sleep(400);
        await toast(ctx, "4회차 기록이 제출됐어요", 1800);
    },

    async edit(ctx) {
        renderInitialFrame("edit", ctx.m);
        const submitted = $(ctx.m, "#c1");
        await spotlight(ctx, submitted);
        await spotOff(ctx);
        await tap(ctx, submitted);
        setScreen(ctx.m, reviewScreen());
        await ctx.run.sleep(800);
        await tap(ctx, "#e-date");
        await openCalendar(ctx, true);
        await pickDay(ctx);
        await closeCalendar(ctx);
        setScreen(ctx.m, reviewScreen(true));
        await ctx.run.sleep(1200);
        await tap(ctx, "#go");
        hideTouch(ctx);
        await showDone(ctx);
        setScreen(ctx.m, reviewScreen(true));
        await ctx.run.sleep(500);
        const del = $(ctx.m, "#del");
        await spotlight(ctx, del);
        await spotOff(ctx);
        await tap(ctx, del);
        const md = $(ctx.m, ".m-modal");
        $(md, "h4").textContent = "1회차 기록을 삭제할까요?";
        $(md, "p").textContent = "기록과 고객 서명이 모두 삭제됩니다.";
        const ok = $(md, "#mok");
        ok.textContent = "삭제";
        addClass(ok, "destructive");
        ctx.m.dataset.overlay = "true";
        addClass(md, "on");
        await ctx.run.sleep(1300);
        await tap(ctx, ok);
        hideTouch(ctx);
        ctx.m.dataset.overlay = "false";
        setScreen(ctx.m, gridScreen(["current", "done", "done", "current", "locked", "locked", "locked", "locked", "locked", "locked"]));
        await toast(ctx, "1회차 기록을 삭제했어요", 1400);
    },
};

function fillValue(root: HTMLElement, id: string, text: string) {
    const el = $(root, `#${id}`);
    addClass(el, "has");
    $(el, ".v").textContent = text;
}

/* ---------- player ---------- */

async function play(name: DemoName, ctx: DemoCtx, fill: HTMLElement) {
    const { run } = ctx;
    let t0 = 0;
    const tick = async () => {
        try {
            for (;;) {
                const now = await run.frame();
                const f = Math.min(0.99, (now - t0) / loopMs[name]);
                fill.style.transform = `scaleX(${f})`;
            }
        } catch {
            // stopped
        }
    };
    void tick();
    try {
        for (;;) {
            ctx.m.dataset.overlay = "false";
            if (ctx.spot) ctx.spot.dataset.on = "false";
            ctx.touch.dataset.tap = "false";
            ctx.touch.style.transition = "none";
            ctx.touch.style.opacity = "0";
            t0 = performance.now();
            await DEMOS[name](ctx);
            await run.sleep(250);
            loopMs[name] = performance.now() - t0;
        }
    } catch (error) {
        if (!(error instanceof DemoStop)) console.error(error);
    }
}

/** Starts the looping script for `name`; the returned function stops it and everything it scheduled. */
export function startDemo(name: DemoName, els: DemoElements): () => void {
    const run = createDemoRun();
    void play(name, { run, stage: els.stage, m: els.m, touch: els.touch, spot: els.spot }, els.fill);
    return () => run.stop();
}

/** Build the first frame before the browser paints, also used to synchronously reset each loop. */
export function renderInitialFrame(name: DemoName, m: HTMLElement): void {
    const screens: Record<DemoName, () => string> = {
        basics: basicsScreen,
        grid: () => gridScreen(GRID_STATES),
        form: momScreen,
        sign: signScreen,
        edit: () => gridScreen(GRID_STATES),
    };
    setScreen(m, screens[name]());
}

/** The `prefers-reduced-motion` frame: useful date/review states, with nothing scheduled. */
export function renderStaticFrame(name: DemoName, m: HTMLElement): void {
    renderInitialFrame(name, m);
    switch (name) {
        case "basics": {
            const values: Record<string, string> = { f1: "이예지", f2: "1994-03-15", f3: "이아기", f4: "2026-09-20", f5: "3.2" };
            for (const [id, text] of Object.entries(values)) fillValue(m, id, text);
            removeClass($(m, "#d0"), "on");
            addClass($(m, "#d1"), "on");
            break;
        }
        case "grid":
            setScreen(m, momScreen());
            break;
        case "form":
            fillValue(m, "meal", "2");
            fillValue(m, "snack", "1");
            break;
        case "sign":
            $(m, "#sigok").className = cls("done-chip on");
            $(m, ".sig .hint").style.opacity = "0";
            $(m, "#sigpath").removeAttribute("visibility");
            removeClass($(m, "#go"), "off");
            scrollBodyTo($(m, ".m-body"), $(m, ".m-body").scrollHeight, false);
            break;
        case "edit":
            setScreen(m, reviewScreen(true));
            break;
    }
}
