import { createDemoRun, renderInitialFrame, renderStaticFrame, startDemo, type DemoName } from "../guideDemos";

const NAMES: DemoName[] = ["basics", "grid", "form", "sign", "edit"];

function makeStage() {
    const stage = document.createElement("div");
    const m = document.createElement("div");
    const touch = document.createElement("span");
    const spot = document.createElement("span");
    const fill = document.createElement("span");
    stage.append(m, spot, touch, fill);
    document.body.appendChild(stage);
    return { stage, m, touch, spot, fill };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({ left, top, width, height }) };
}

describe("guideDemos", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => {
        document.body.innerHTML = "";
        jest.useRealTimers();
    });

    describe("createDemoRun", () => {
        it("rejects a pending sleep and clears its timer when stopped", async () => {
            const run = createDemoRun();
            const pending = run.sleep(10_000);
            const settled = expect(pending).rejects.toThrow();
            expect(jest.getTimerCount()).toBe(1);
            run.stop();
            await settled;
            expect(jest.getTimerCount()).toBe(0);
            expect(run.stopped).toBe(true);
        });

        it("refuses new waits after stop", async () => {
            const run = createDemoRun();
            run.stop();
            await expect(run.sleep(1)).rejects.toThrow();
            await expect(run.frame()).rejects.toThrow();
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    const element = (m: HTMLElement, id: string) => m.querySelector<HTMLElement>(`[data-g="${id}"]`);
    const until = async (predicate: () => boolean) => {
        for (let elapsed = 0; elapsed < 40_000; elapsed += 100) {
            if (predicate()) return;
            await jest.advanceTimersByTimeAsync(100);
        }
        throw new Error("Expected demo step did not appear within 40s");
    };

    it("positions the first grid spotlight relative to the stage after its slide-in", async () => {
        const els = makeStage();
        let stageLeft = 400;
        jest.spyOn(els.stage, "getBoundingClientRect").mockImplementation(() => rect(stageLeft, 0, 0, 0));
        const stop = startDemo("grid", els);
        try {
            const c4 = els.m.querySelector('[data-g="c4"]');
            if (!c4) throw new Error("Expected the grid's first frame to render synchronously");
            jest.spyOn(c4, "getBoundingClientRect").mockImplementation(() => rect(stageLeft + 100, 200, 60, 40));

            await jest.advanceTimersByTimeAsync(300);
            stageLeft = 20;
            await jest.advanceTimersByTimeAsync(500);

            expect(els.spot.style.left).toBe("95px");
            expect(els.spot.style.top).toBe("195px");
        } finally { stop(); }
    });

    it("picks a free service date, with a disabled initial selection and no completion overlay", async () => {
        const els = makeStage();
        let completionAppeared = false;
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const added of record.addedNodes) {
                    if (added instanceof HTMLElement && (added.matches(".m-done") || added.querySelector(".m-done"))) completionAppeared = true;
                }
            }
        });
        observer.observe(els.m, { childList: true, subtree: true });
        const stop = startDemo("grid", els);
        try {
            expect(element(els.m, "c4")).toHaveTextContent("입력 가능");
            expect(element(els.m, "c4")?.querySelector(".d")?.textContent).toBe("");
            await until(() => Boolean(element(els.m, "sd")));
            expect(element(els.m, "sd")).toHaveTextContent("날짜를 선택하세요");
            await until(() => Boolean(element(els.m, "calok")));
            expect(els.m).toHaveTextContent("4회차 서비스 제공일");
            expect(els.m).not.toHaveTextContent(/오늘|현재|지금/);
            expect(els.m).toHaveTextContent("서비스 기간: 11.02(월) ~ 11.17(화)");
            expect(element(els.m, "day-2")).toHaveTextContent("1회차");
            expect(element(els.m, "day-2")).toHaveAttribute("data-blocked", "true");
            expect(element(els.m, "day-7")).toHaveAttribute("data-blocked", "true");
            expect(element(els.m, "calok")).toHaveAttribute("data-disabled", "true");
            const body = els.m.querySelector<HTMLElement>(".m-body") as HTMLElement;
            body.scrollTop = 83;
            await until(() => element(els.m, "calok")?.dataset.disabled === "false");
            expect(body.scrollTop).toBe(83);
            expect(els.m).toHaveAttribute("data-overlay", "true");
            await until(() => element(els.m, "sd")?.classList.contains("date-filled") === true);
            expect(element(els.m, "sd")?.querySelector(".v")?.textContent).toBe("2026-11-05");
            expect(element(els.m, "session")).toHaveTextContent("4회차 · 2026.11.05");
            expect(els.m).toHaveAttribute("data-overlay", "false");
            // Observe through the loop restart so a late completion overlay cannot escape the check.
            await until(() => Boolean(element(els.m, "c4")));
            expect(completionAppeared).toBe(false);
        } finally {
            stop();
            observer.disconnect();
        }
    });

    it("starts the form with its date filled, types every temperature character, then reaches review", async () => {
        const els = makeStage();
        const stop = startDemo("form", els);
        try {
            expect(element(els.m, "sd")).toHaveTextContent("2026-11-05");
            expect(element(els.m, "session")).toHaveTextContent("4회차 · 2026.11.05");
            await until(() => element(els.m, "snack")?.querySelector(".v")?.textContent === "1");
            expect(element(els.m, "meal")?.querySelector(".v")).toHaveTextContent("2");
            await until(() => element(els.m, "temp")?.querySelector(".v")?.textContent === "36.6");
            expect(element(els.m, "temp")).toHaveTextContent("36.6℃");
            await until(() => element(els.m, "pay0")?.classList.contains("on") === true);
            expect(element(els.m, "note")).toHaveTextContent("오후 수유 시간 조정");
            await until(() => Boolean(element(els.m, "sigpath")));
            expect(els.m).toHaveTextContent("기록 내용 확인");
            expect(els.m).toHaveTextContent("36.6℃");
        } finally { stop(); }
    });

    it("signs, confirms in a centered modal, and submits session four with the next card available", async () => {
        const els = makeStage();
        const stop = startDemo("sign", els);
        try {
            await until(() => Boolean(els.m.querySelector(".m-modal.on")));
            expect(els.m.querySelector(".m-modal.on")).toHaveTextContent("제출하시겠어요?확인하면 4회차 기록이 제출됩니다.");
            expect(element(els.m, "sigok")).toHaveTextContent("서명 완료");
            expect(els.m).toHaveAttribute("data-overlay", "true");
            await until(() => els.m.querySelector(".toast")?.textContent === "4회차 기록이 제출됐어요");
            expect(element(els.m, "c4")).toHaveTextContent("제출완료");
            expect(element(els.m, "c5")).toHaveTextContent("입력 가능");
            expect(element(els.m, "c5")?.querySelector(".d")?.textContent).toBe("");
        } finally { stop(); }
    });

    it("changes only the submitted record's date, saves, then deletes its record and signature", async () => {
        const els = makeStage();
        const stop = startDemo("edit", els);
        try {
            await until(() => Boolean(element(els.m, "e-date")));
            expect(els.m).toHaveTextContent("1회차 기록 수정제출완료");
            expect(element(els.m, "r-date")).toHaveTextContent("2026.11.02 (월)");
            await until(() => Boolean(element(els.m, "calok")));
            expect(els.m).toHaveTextContent("현재 2026.11.02(월)");
            expect(element(els.m, "day-2")).toHaveTextContent("2현재");
            expect(els.m).not.toHaveTextContent(/오늘|지금/);
            expect(element(els.m, "day-2")).toHaveClass("own");
            expect(element(els.m, "calok")).toHaveAttribute("data-disabled", "true");
            await until(() => Boolean(els.m.querySelector("del")));
            expect(element(els.m, "r-date")).toHaveTextContent("11.02 2026.11.05 (목)");
            expect(els.m).toHaveTextContent("다른 회차 날짜는 바뀌지 않아요.");
            await until(() => Boolean(els.m.querySelector(".m-done.on")));
            await until(() => Boolean(els.m.querySelector(".m-modal.on")));
            expect(els.m.querySelector(".m-modal.on")).toHaveTextContent("1회차 기록을 삭제할까요?기록과 고객 서명이 모두 삭제됩니다.취소삭제");
            expect(element(els.m, "mok")).toHaveClass("destructive");
            await until(() => els.m.querySelector(".toast")?.textContent === "1회차 기록을 삭제했어요");
            expect(element(els.m, "c1")).toHaveTextContent("입력 가능");
            expect(element(els.m, "c1")?.querySelector(".d")?.textContent).toBe("");
            expect(element(els.m, "c4")).toHaveTextContent("입력 가능");
            expect(element(els.m, "c5")).toHaveTextContent("대기");
            expect(element(els.m, "c4")?.querySelector(".d")?.textContent).toBe("");
            expect(element(els.m, "c2")).toHaveTextContent("2026.11.03");
            expect(element(els.m, "c3")).toHaveTextContent("2026.11.04");
        } finally { stop(); }
    });

    describe.each(NAMES)("%s", (name) => {
        it("plays against a layout-less DOM, then leaves no timer or frame after stop()", async () => {
            const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
            const els = makeStage();
            const firstFrameSelector: Record<DemoName, string> = {
                basics: '[data-g="f1"]',
                grid: '[data-g="c4"].current',
                form: '[data-g="meal"]',
                sign: '[data-g="sigpath"]',
                edit: '[data-g="c1"].done',
            };
            let initialFrames = 0;
            const observer = new MutationObserver((records) => {
                for (const record of records) {
                    for (const added of record.addedNodes) {
                        if (added instanceof HTMLElement && added.matches(".m-app") && added.querySelector(firstFrameSelector[name])) initialFrames += 1;
                    }
                }
            });
            observer.observe(els.m, { childList: true });
            const stop = startDemo(name, els);
            expect(els.m.childElementCount).toBeGreaterThan(0); // first paint is synchronous
            await jest.advanceTimersByTimeAsync(40_000);
            expect(els.m.childElementCount).toBeGreaterThan(0);
            expect(Number.parseFloat(els.fill.style.transform.replace("scaleX(", ""))).toBeGreaterThan(0);
            observer.disconnect();
            expect(initialFrames).toBeGreaterThanOrEqual(2);

            stop();
            expect(jest.getTimerCount()).toBe(0);
            const frozen = els.m.innerHTML;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(els.m.innerHTML).toBe(frozen);
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });

        it("prebuilds the initial frame without waiting or scheduling anything", () => {
            const { m } = makeStage();
            renderInitialFrame(name, m);
            expect(m.textContent).not.toBe("");
            expect(jest.getTimerCount()).toBe(0);
        });

        it("draws a still frame without scheduling anything", () => {
            const { m } = makeStage();
            renderStaticFrame(name, m);
            expect(m.textContent).not.toBe("");
            expect(jest.getTimerCount()).toBe(0);
        });
    });
});
