/**
 * The guide's demo player: six scripted loops that act on a miniature, decorative copy of the
 * service-record screens (touch indicator, typing, page swaps, signature, modal, spotlight).
 *
 * It drives plain DOM through refs (the mini screen is not React state), so every wait goes through a
 * `DemoRun`. Stopping the run clears every pending timer / animation frame at once and rejects the
 * waits, which unwinds the running script — nothing fires after a slide change, a close or an unmount.
 * Only static strings are written with `innerHTML`; typed text and labels go through `textContent`.
 */
import styles from "./ServiceRecordGuide.module.css";

export type DemoName = "basics" | "grid" | "form" | "sign" | "edit" | "sched";

/** Loop lengths in ms, refined from every completed loop so the progress bar stays honest. */
const EXPECTED_LOOP_MS: Record<DemoName, number> = {
    basics: 13700, grid: 6100, form: 21200, sign: 13700, edit: 16300, sched: 12100,
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

function field(id: string, label: string, placeholder: string, extra = ""): string {
    return `<div class="${cls("fld")}"><span class="${cls("fld-l")}">${label}</span><div class="${cls(`inp ${extra}`.trim())}" data-g="${id}"><span class="${cls("ph")}">${placeholder}</span><span class="${cls("v")}"></span></div></div>`;
}

function chips(id: string, question: string, options: string[]): string {
    return `<div class="${cls("grp")}"><div class="${cls("q")}">${question}</div><div class="${cls("chips")}">${options.map((option, index) => `<span class="${cls("ch")}" data-g="${id}${index}">${option}</span>`).join("")}</div></div>`;
}

function head(crumb: string, title: string, progress?: number): string {
    const bar = progress == null ? "" : `<div class="${cls("m-prog")}">${[0, 1, 2, 3].map((index) => `<i class="${index < progress ? cls("on") : ""}"></i>`).join("")}</div>`;
    return `<div class="${cls("m-head")}"><div class="${cls("m-crumb")}">${crumb}</div><div class="${cls("m-title")}">${title}</div>${bar}</div>`;
}

const modal = (title: string, body: string): string => `<div class="${cls("m-modal")}"><div class="${cls("m-box")}"><h4>${title}</h4><p>${body}</p><div class="${cls("acts")}"><div class="${cls("m-btn cancel")}">취소</div><div class="${cls("m-btn")}" data-g="mok">확인</div></div></div></div><div class="${cls("toast")}"></div>`;

type CardState = "done" | "current" | "locked";

function cardHTML(index: number, state: CardState): string {
    const label = { done: "제출완료", current: "입력 가능", locked: "대기" }[state];
    return `<div class="${cls(`card ${state}`)}" data-g="c${index}"><div class="${cls("d")}">2026.12.0${index}</div><div class="${cls("n")}">${index}</div><div class="${cls("s")}">${label}</div></div>`;
}

function gridScreen(states: CardState[], buttonLabel: string): string {
    return `${head("3단계 · 일자별 기록", "제공기록표")}<div class="${cls("m-body")}"><div class="${cls("m-help")}">제출된 기록은 눌러서 수정할 수 있습니다.</div><div class="${cls("cards")}">${states.map((state, index) => cardHTML(index + 1, state)).join("")}</div></div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}">${buttonLabel}</div><div class="${cls("m-btn ghost")}">서비스 일정 변경</div></div>${modal("", "")}`;
}

const PAGES = {
    mom: chips("p", "① 회음절개부위 (또는 수술부위)", ["이상없음", "열상", "혈종", "불편감"])
        + chips("b", "② 유방상태", ["이상없음", "울혈", "통증"])
        + chips("u", "③ 배뇨/배변", ["이상없음", "불편감"])
        + chips("z", "④ 좌욕", ["실시", "미실시"])
        + `<div class="${cls("grp")}"><div class="${cls("q")}">⑤ 식사/간식</div><div class="${cls("nums")}">${field("meal", "식사 (회)", "0")}${field("snack", "간식 (회)", "0")}</div></div>`,
    baby: field("temp", "⑥ 체온 (℃)", "36.5")
        + chips("sl", "⑦ 수면 양상", ["잘 잠", "잘 못 잠"])
        + `<div class="${cls("nums")}">${field("bf", "⑧ 모유수유 (회)", "0")}${field("ff", "⑨ 분유수유 (회)", "0")}</div>`
        + chips("pp", "⑩ 배변양상", ["정상변", "이상변"])
        + chips("bt", "⑪ 목욕·제대관리", ["실시", "미실시"]),
    svc: field("etc", "기타 서비스 (필요 시 기재)", "예: 신생아 옷 정리", "area")
        + field("note", "특이사항 (필요 시 기재)", "예: 산모 요청으로 간식 시간을 변경함", "area")
        + chips("pay", "결제 확인", ["결제 확인 완료"]),
};

const basicsScreen = (): string => `${head("2단계 · 서비스 기본정보", "서비스 기본정보")}<div class="${cls("m-body")}"><div class="${cls("ro")}"><span>제공인력</span><b>김도우미</b></div>${field("f1", "산모 성명", "예: 이예지")}${field("f2", "산모 생년월일", "1994-03-15")}${field("f3", "신생아 성명", "예: 이아기")}${field("f4", "신생아 출생일자", "2026-09-20")}<div class="${cls("fld")}"><span class="${cls("fld-l")}">분만형태</span><div class="${cls("chips")}"><span class="${cls("ch on")}" data-g="d0">자연분만</span><span class="${cls("ch")}" data-g="d1">제왕절개</span></div></div>${field("f5", "신생아 몸무게 (kg)", "예: 3.2")}</div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}" data-g="go">다음</div></div>${modal("", "")}`;

const SIGN_PATH = "M18 50 C 26 18, 40 18, 36 44 C 33 60, 50 56, 58 34 C 62 22, 70 22, 68 40 C 66 56, 84 54, 92 36 C 98 24, 110 26, 106 44 C 104 56, 122 52, 132 30 C 138 20, 146 34, 150 46 C 156 58, 170 44, 178 34 L 190 40";

function reviewHTML({ submitted, temp = "36.5℃", signed = false }: { submitted: boolean; temp?: string; signed?: boolean }): string {
    const editButton = (section: string) => (submitted ? `<div class="${cls("edit")}" data-g="e-${section}">수정</div>` : "");
    const banner = submitted
        ? `<div class="${cls("banner warn")}">이미 제출된 회차입니다.</div>`
        : `<div class="${cls("banner")}">최종 기록을 확인해 주세요.</div>`;
    const signature = signed
        ? `<span class="${cls("done-chip on")}">서명 완료 · 2026.12.02</span>`
        : `<div class="${cls("sig-l")}">산모 서명 <small>지우기</small></div>
     <div class="${cls("sig")}"><span class="${cls("hint")}">여기에 손가락으로 서명해 주세요</span>
       <svg viewBox="0 0 208 74"><path data-g="sigpath" d="${SIGN_PATH}" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
     </div>
     <div class="${cls("sig-note")}">기록 내용을 확인하였음을 서명으로 확인합니다.</div>
     <span class="${cls("done-chip")}" data-g="sigok">서명 완료 · 2026.12.03</span>`;
    return `${banner}
    <div class="${cls("sec")}"><div class="${cls("sec-h")}">산모${editButton("mom")}</div><div class="${cls("rw")}"><span>회음절개부위</span><b>이상없음</b></div><div class="${cls("rw")}"><span>좌욕</span><b>실시</b></div></div>
    <div class="${cls("sec")}"><div class="${cls("sec-h")}">신생아${editButton("baby")}</div><div class="${cls("rw")}"><span>체온</span><b data-g="r-temp">${temp}</b></div><div class="${cls("rw")}"><span>수면 양상</span><b>잘 잠</b></div></div>
    <div class="${cls("sec")}"><div class="${cls("sec-h")}">서비스 기록${editButton("svc")}</div><div class="${cls("rw")}"><span>결제 확인</span><b>✓ 확인 완료</b></div></div>
    ${signature}`;
}

const signScreen = (): string => `${head("3회차 · 기록 내용 확인 (4/4)", "기록 내용 확인", 4)}<div class="${cls("m-body")}">${reviewHTML({ submitted: false })}</div><div class="${cls("m-foot")}"><div class="${cls("m-btn off")}" data-g="go">확인</div></div>${modal("제출하시겠어요?", "")}`;

const reviewScreen = (temp: string): string => `${head("2회차 · 기록 내용 확인 (4/4)", "기록 내용 확인", 4)}<div class="${cls("m-body")}">${reviewHTML({ submitted: true, temp, signed: true })}</div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}" data-g="go">확인</div></div>${modal("", "")}`;

const momScreen = (): string => `${head("3회차 · 산모 기록 (1/4)", "산모 기록", 1)}<div class="${cls("m-body")}"><div class="${cls("page")}">${PAGES.mom}</div></div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}" data-g="go">다음</div></div>${modal("", "")}`;

const babyEditScreen = (): string => `${head("2회차 · 신생아 기록 (2/4)", "신생아 기록", 2)}<div class="${cls("m-body")}"><div class="${cls("page")}">${PAGES.baby}</div></div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}" data-g="go">저장</div></div>${modal("", "")}`;

const GRID_STATES: CardState[] = ["done", "done", "current", "locked", "locked", "locked"];

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
    if (!body || !body.contains(el)) return;
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

async function confirmModal(ctx: DemoCtx, title: string, body: string) {
    const md = $(ctx.m, ".m-modal");
    $(md, "h4").textContent = title;
    $(md, "p").textContent = body;
    addClass(md, "on");
    await ctx.run.sleep(700);
    await tap(ctx, "#mok", async (button) => {
        button.textContent = "제출 중…";
        await ctx.run.sleep(600);
    });
    removeClass(md, "on");
    await ctx.run.sleep(300);
}

async function swapPage(ctx: DemoCtx, crumb: string, title: string, progress: number, html: string) {
    const body = $(ctx.m, ".m-body");
    scrollBodyTo(body, 0, false);
    const old = find(body, ".page");
    const page = document.createElement("div");
    page.className = cls("page in");
    page.innerHTML = html;
    body.appendChild(page);
    $(ctx.m, ".m-crumb").textContent = crumb;
    $(ctx.m, ".m-title").textContent = title;
    ctx.m.querySelectorAll(toSelector(".m-prog i")).forEach((bar, index) => bar.classList.toggle(styles.on ?? "on", index < progress));
    void page.offsetWidth;
    if (old) addClass(old, "out");
    removeClass(page, "in");
    await ctx.run.sleep(450);
    old?.remove();
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
    void done.offsetWidth;
    addClass(done, "on");
    await ctx.run.sleep(2000);
}

/** The touch follows the pen stroke while the signature is drawn along its path. */
async function drawSign(ctx: DemoCtx) {
    const path = ctx.m.querySelector<SVGPathElement>('[data-g="sigpath"]');
    const length = path && typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
    if (!path || !length || typeof path.getPointAtLength !== "function") {
        // No SVG geometry here (jsdom): keep the loop's timing, skip the stroke.
        await ctx.run.sleep(900);
        await reveal(ctx, $(ctx.m, "#sigok"));
        await ctx.run.sleep(550 + 1700 + 200);
    } else {
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
        await ctx.run.sleep(900);
        await reveal(ctx, $(ctx.m, "#sigok"));
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
        ctx.m.innerHTML = basicsScreen();
        await ctx.run.sleep(500);
        await type(ctx, "#f1", "이예지");
        await type(ctx, "#f2", "1994-03-15", 55);
        await type(ctx, "#f3", "이아기");
        await type(ctx, "#f4", "2026-09-20", 55);
        await tap(ctx, "#d1", () => { removeClass($(ctx.m, "#d0"), "on"); turnOn(ctx, "#d1"); });
        await type(ctx, "#f5", "3.2");
        await tap(ctx, "#go", async (button) => {
            button.textContent = "저장 중";
            await ctx.run.sleep(700);
            button.textContent = "다음";
        });
        hideTouch(ctx);
        await showDone(ctx);
    },

    async grid(ctx) {
        ctx.m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
        const current = $(ctx.m, "#c3");
        await spotlight(ctx, current);
        await tap(ctx, current);
        hideTouch(ctx);
        await spotOff(ctx);
        ctx.m.innerHTML = `${head("3회차 · 산모 기록 (1/4)", "산모 기록", 1)}<div class="${cls("m-body")}"><div class="${cls("page")}">${PAGES.mom}</div></div><div class="${cls("m-foot")}"><div class="${cls("m-btn")}">다음</div></div>`;
        await ctx.run.sleep(1400);
    },

    async form(ctx) {
        ctx.m.innerHTML = momScreen();
        const pick = (selector: string) => tap(ctx, selector, (el) => addClass(el, "on"));
        await ctx.run.sleep(400);
        await pick("#p0"); await pick("#b0"); await pick("#u0"); await pick("#z0");
        await type(ctx, "#meal", "3", 120); await type(ctx, "#snack", "2", 120);
        await tap(ctx, "#go");
        await swapPage(ctx, "3회차 · 신생아 기록 (2/4)", "신생아 기록", 2, PAGES.baby);
        await type(ctx, "#temp", "36.6", 100);
        await pick("#sl0");
        await type(ctx, "#bf", "6", 120);
        await pick("#pp0"); await pick("#bt0");
        await tap(ctx, "#go");
        await swapPage(ctx, "3회차 · 서비스 기록 (3/4)", "서비스 기록", 3, PAGES.svc);
        await type(ctx, "#note", "오후 수유 시간 조정", 80);
        await tap(ctx, "#pay0", (el) => addClass(el, "on"));
        await tap(ctx, "#go");
        hideTouch(ctx);
        await ctx.run.sleep(600);
    },

    async sign(ctx) {
        ctx.m.innerHTML = signScreen();
        await drawSign(ctx);
        await ctx.run.sleep(500);
        await tap(ctx, "#go");
        await confirmModal(ctx, "제출하시겠어요?", "확인하면 3회차 기록이 제출됩니다.");
        hideTouch(ctx);
        await showDone(ctx);
        ctx.m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
        await ctx.run.sleep(500);
        const c3 = $(ctx.m, "#c3");
        addClass(c3, "flip");
        await ctx.run.sleep(300);
        c3.className = cls("card done flip");
        $(c3, ".s").textContent = "제출완료";
        await ctx.run.sleep(450);
        const c4 = $(ctx.m, "#c4");
        c4.className = cls("card current pulse");
        $(c4, ".s").textContent = "입력 가능";
        await toast(ctx, "3회차 기록이 제출됐어요", 1700);
    },

    async edit(ctx) {
        ctx.m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
        const c2 = $(ctx.m, "#c2");
        await spotlight(ctx, c2);
        await tap(ctx, c2);
        await spotOff(ctx);
        ctx.m.innerHTML = reviewScreen("36.5℃");
        await ctx.run.sleep(900);
        await tap(ctx, "#e-baby");
        ctx.m.innerHTML = babyEditScreen();
        fillValue(ctx.m, "temp", "36.5");
        fillValue(ctx.m, "bf", "6");
        for (const selector of ["#sl0", "#pp0", "#bt0"]) turnOn(ctx, selector);
        await ctx.run.sleep(500);
        await type(ctx, "#temp", "36.8", 140);
        await tap(ctx, "#go");
        ctx.m.innerHTML = reviewScreen("36.8℃");
        addClass($(ctx.m, "#r-temp"), "hl");
        await ctx.run.sleep(900);
        await tap(ctx, "#go");
        await confirmModal(ctx, "제출하시겠어요?", "확인하면 2회차 기록이 수정 제출됩니다.");
        hideTouch(ctx);
        await showDone(ctx);
    },

    async sched(ctx) {
        ctx.m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
        const foot = $(ctx.m, ".m-foot .ghost");
        const md = $(ctx.m, ".m-modal");
        $(md, "h4").textContent = SCHEDULE_MODAL_TITLE;
        $(md, "p").textContent = SCHEDULE_MODAL_BODY;
        const ok = $(md, "#mok");
        ok.textContent = "승인 요청";
        await spotlight(ctx, foot);
        await tap(ctx, foot);
        await spotOff(ctx);
        addClass(md, "on");
        await ctx.run.sleep(1600);
        await tap(ctx, ok, async (button) => {
            button.textContent = "요청 중…";
            await ctx.run.sleep(700);
        });
        removeClass(md, "on");
        hideTouch(ctx);
        await ctx.run.sleep(300);
        foot.textContent = "일정 변경 요청 대기 중";
        addClass(foot, "pending");
        await ctx.run.sleep(1200);
        await showDone(ctx);
    },
};

const SCHEDULE_MODAL_TITLE = "3회차 서비스 일정을 조정할까요?";
const SCHEDULE_MODAL_BODY = "3회차 서비스를 12월 3일에서 12월 4일로 변경을 요청할까요? 본사 승인 후 일정이 조정됩니다.";

function fillValue(root: HTMLElement, id: string, text: string) {
    const el = $(root, `#${id}`);
    addClass(el, "has");
    $(el, ".v").textContent = text;
}

/* ---------- player ---------- */

async function play(name: DemoName, ctx: DemoCtx, fill: HTMLElement) {
    const { run } = ctx;
    let t0 = 0;
    let done = false;
    const tick = async () => {
        try {
            for (;;) {
                const now = await run.frame();
                const f = done ? 1 : Math.min(0.99, (now - t0) / loopMs[name]);
                fill.style.transform = `scaleX(${f})`;
            }
        } catch {
            // stopped
        }
    };
    void tick();
    try {
        for (;;) {
            ctx.touch.style.transition = "none";
            ctx.touch.style.opacity = "0";
            t0 = performance.now();
            done = false;
            await DEMOS[name](ctx);
            await run.sleep(900);
            loopMs[name] = performance.now() - t0;
            done = true;
            await run.sleep(120);
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

/** The `prefers-reduced-motion` frame: the mini screen in its end state, nothing scheduled. */
export function renderStaticFrame(name: DemoName, m: HTMLElement) {
    switch (name) {
        case "basics": {
            m.innerHTML = basicsScreen();
            const values: Record<string, string> = { f1: "이예지", f2: "1994-03-15", f3: "이아기", f4: "2026-09-20", f5: "3.2" };
            for (const [id, text] of Object.entries(values)) fillValue(m, id, text);
            removeClass($(m, "#d0"), "on");
            addClass($(m, "#d1"), "on");
            break;
        }
        case "grid":
            m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
            break;
        case "form":
            m.innerHTML = momScreen();
            for (const selector of ["#p0", "#b0", "#u0", "#z0"]) addClass($(m, selector), "on");
            fillValue(m, "meal", "3");
            fillValue(m, "snack", "2");
            break;
        case "sign":
            m.innerHTML = signScreen();
            $(m, "#sigok").className = cls("done-chip on");
            $(m, ".sig .hint").style.opacity = "0";
            removeClass($(m, "#go"), "off");
            break;
        case "edit":
            m.innerHTML = reviewScreen("36.8℃");
            addClass($(m, "#r-temp"), "hl");
            break;
        case "sched": {
            m.innerHTML = gridScreen(GRID_STATES, "다음 회차 입력");
            const button = $(m, ".m-foot .ghost");
            button.textContent = "일정 변경 요청 대기 중";
            addClass(button, "pending");
            break;
        }
    }
}
