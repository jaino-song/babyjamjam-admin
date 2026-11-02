import { createDemoRun, renderStaticFrame, startDemo, type DemoName } from "../guideDemos";

const NAMES: DemoName[] = ["basics", "grid", "form", "sign", "edit", "sched"];

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

    describe.each(NAMES)("%s", (name) => {
        it("plays against a layout-less DOM, then leaves no timer or frame after stop()", async () => {
            const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
            const els = makeStage();
            const stop = startDemo(name, els);
            await jest.advanceTimersByTimeAsync(25_000);
            expect(els.m.childElementCount).toBeGreaterThan(0);
            expect(Number.parseFloat(els.fill.style.transform.replace("scaleX(", ""))).toBeGreaterThan(0);

            stop();
            expect(jest.getTimerCount()).toBe(0);
            const frozen = els.m.innerHTML;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(els.m.innerHTML).toBe(frozen);
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });

        it("draws a still frame without scheduling anything", () => {
            const { m } = makeStage();
            renderStaticFrame(name, m);
            expect(m.textContent).not.toBe("");
            expect(jest.getTimerCount()).toBe(0);
        });
    });
});
