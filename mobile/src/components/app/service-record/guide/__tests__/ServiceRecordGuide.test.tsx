import { readFileSync } from "fs";
import { join } from "path";
import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServiceRecordGuide } from "../ServiceRecordGuide";

const mockUseReducedMotion = jest.fn();
jest.mock("framer-motion", () => ({
    useReducedMotion: () => mockUseReducedMotion(),
}));

const BASE = "mobile_service-record_wizard_guide";
const q = (suffix: string) => document.querySelector<HTMLElement>(`[data-component="${BASE}_${suffix}"]`);

const TITLES = [
    "처음이세요? 사용방법을 알려드려요",
    "산모·신생아 정보를 먼저 입력해요",
    "오늘 날짜 버튼을 눌러 기록을 시작하세요",
    "서비스 제공 기록을 작성해 주세요",
    "최종 확인 후 산모님께 서명을 받아요",
    "이미 제출한 기록도 수정이 가능해요",
    "하루 쉬어가나요? 일정을 변경해 보세요",
];
const SLIDE_KEYS = ["intro", "basics", "grid", "form", "sign", "edit", "sched"] as const;

const dialog = () => screen.getByRole("dialog", { name: "제공기록지 작성 가이드" });
const counter = () => within(dialog()).getByText(/^\d \/ 7$/).textContent;
const nextButton = () => within(dialog()).getByRole("button", { name: /^(다음|기본정보 입력 시작)$/ });
const prevButton = () => within(dialog()).getByRole("button", { name: "이전" });

describe("ServiceRecordGuide", () => {
    let consoleError: jest.SpyInstance;
    let user: ReturnType<typeof userEvent.setup>;
    const onClose = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        mockUseReducedMotion.mockReset();
        mockUseReducedMotion.mockReturnValue(false);
        onClose.mockReset();
        consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
        jest.useRealTimers();
    });

    const renderGuide = (open = true) => render(<ServiceRecordGuide data-component={BASE} open={open} onClose={onClose} />);

    it("renders nothing while closed", () => {
        renderGuide(false);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens as a modal dialog on slide 1 / 7 with 다음 focused and 이전 disabled", () => {
        renderGuide();
        expect(dialog()).toHaveAttribute("aria-modal", "true");
        expect(counter()).toBe("1 / 7");
        expect(prevButton()).toBeDisabled();
        expect(nextButton()).toHaveFocus();
        expect(q("sheet")).toBe(dialog());
    });

    it("shows the final copy of all seven slides, one active at a time", async () => {
        renderGuide();
        for (const [index, title] of TITLES.entries()) {
            expect(counter()).toBe(`${index + 1} / 7`);
            const active = document.querySelector('[data-active="true"]');
            expect(active).toHaveTextContent(title);
            expect(active).toBe(q(`sheet_slide-${SLIDE_KEYS[index]}`));
            expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
            if (index < TITLES.length - 1) await user.click(nextButton());
        }
        // The caption copy of the first slide.
        expect(q("sheet_slide-intro_caption")).toHaveTextContent("제공기록지 작성 가이드처음이세요? 사용방법을 알려드려요다음을 눌러 하나씩 살펴보세요.");
    });

    it("moves with 다음 / 이전 and ends on 기본정보 입력 시작, which closes the guide", async () => {
        renderGuide();
        await user.click(nextButton());
        expect(counter()).toBe("2 / 7");
        expect(prevButton()).toBeEnabled();
        await user.click(prevButton());
        expect(counter()).toBe("1 / 7");

        for (let i = 0; i < 6; i += 1) await user.click(nextButton());
        expect(counter()).toBe("7 / 7");
        expect(nextButton()).toHaveTextContent("기본정보 입력 시작");
        expect(onClose).not.toHaveBeenCalled();
        await user.click(nextButton());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes from 건너뛰기 and from Esc", async () => {
        renderGuide();
        await user.click(within(dialog()).getByRole("button", { name: "건너뛰기" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("pages with ArrowRight / ArrowLeft and stops at both ends", async () => {
        renderGuide();
        await user.keyboard("{ArrowLeft}");
        expect(counter()).toBe("1 / 7");
        await user.keyboard("{ArrowRight}{ArrowRight}");
        expect(counter()).toBe("3 / 7");
        await user.keyboard("{ArrowLeft}");
        expect(counter()).toBe("2 / 7");
        await user.keyboard("{ArrowRight>8/}");
        expect(counter()).toBe("7 / 7");
    });

    describe("focus stays inside the dialog", () => {
        it("moves focus from 이전 to 다음 when going back to slide 1 disables 이전", async () => {
            renderGuide();
            await user.click(nextButton());
            await user.click(prevButton());
            expect(counter()).toBe("1 / 7");
            expect(prevButton()).toBeDisabled();
            expect(nextButton()).toHaveFocus();
        });

        it("does the same when ArrowLeft pages back while 이전 has focus", async () => {
            renderGuide();
            await user.click(nextButton());
            prevButton().focus();
            expect(prevButton()).toHaveFocus();
            await user.keyboard("{ArrowLeft}");
            expect(counter()).toBe("1 / 7");
            expect(nextButton()).toHaveFocus();
        });

        it("leaves focus alone when nothing focused is disabled", async () => {
            renderGuide();
            const skip = within(dialog()).getByRole("button", { name: "건너뛰기" });
            skip.focus();
            await user.keyboard("{ArrowRight}");
            expect(counter()).toBe("2 / 7");
            expect(skip).toHaveFocus();
        });
    });

    describe("stage fit", () => {
        const clientHeight = jest.spyOn(HTMLElement.prototype, "clientHeight", "get");
        afterEach(() => clientHeight.mockReset());
        afterAll(() => clientHeight.mockRestore());

        it("scales the illustration down with a short stage frame, on the intro and on a demo", () => {
            clientHeight.mockReturnValue(206);
            renderGuide();
            for (const key of ["intro", "sched"]) {
                const frame = q(`sheet_slide-${key}_stage`) as HTMLElement;
                expect(frame.style.getPropertyValue("--fit")).toBe("0.5");
                expect(q(`sheet_slide-${key}_stage_fit`)?.parentElement).toBe(frame);
            }
        });

        it("never scales up a tall frame", () => {
            clientHeight.mockReturnValue(430);
            renderGuide();
            expect((q("sheet_slide-intro_stage") as HTMLElement).style.getPropertyValue("--fit")).toBe("1");
        });
    });

    describe("guide text never breaks inside a Korean word", () => {
        const css = readFileSync(join(__dirname, "../ServiceRecordGuide.module.css"), "utf8");
        const rule = (selector: string) => new RegExp(`\\n\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

        it.each([".chip", ".cap-title", ".cap-body", ".st-name", ".st-sub"])("%s keeps words whole", (selector) => {
            expect(rule(selector)).toMatch(/word-break:\s*keep-all/);
            expect(rule(selector)).toMatch(/overflow-wrap:\s*anywhere/);
        });
    });

    it("restarts on slide 1 when it is opened again", async () => {
        const { rerender } = renderGuide();
        await user.click(nextButton());
        rerender(<ServiceRecordGuide data-component={BASE} open={false} onClose={onClose} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        rerender(<ServiceRecordGuide data-component={BASE} open onClose={onClose} />);
        expect(counter()).toBe("1 / 7");
    });

    it("gives the last demo the corrected 본사 approval copy", async () => {
        renderGuide();
        for (let i = 0; i < 6; i += 1) await user.click(nextButton());
        await act(async () => { await jest.advanceTimersByTimeAsync(700); });
        const mini = q("sheet_slide-sched_stage_mini-screen");
        expect(mini).toHaveTextContent("3회차 서비스를 12월 3일에서 12월 4일로 변경을 요청할까요? 본사 승인 후 일정이 조정됩니다.");
        expect(mini).not.toHaveTextContent("관리자");
    });

    describe("focus restoration", () => {
        function Harness({ withOpener = true }: { withOpener?: boolean }) {
            const [open, setOpen] = useState(!withOpener);
            return (
                <>
                    {withOpener ? <button type="button" onClick={() => setOpen(true)}>사용방법</button> : null}
                    <ServiceRecordGuide data-component={BASE} open={open} onClose={() => setOpen(false)} />
                </>
            );
        }
        const settle = () => act(() => { jest.runOnlyPendingTimers(); });

        it("returns focus to the opener after 건너뛰기", async () => {
            render(<Harness />);
            const opener = screen.getByRole("button", { name: "사용방법" });
            await user.click(opener);
            expect(nextButton()).toHaveFocus();
            await user.click(within(dialog()).getByRole("button", { name: "건너뛰기" }));
            settle();
            expect(screen.queryByRole("dialog")).toBeNull();
            expect(opener).toHaveFocus();
        });

        it("returns focus to the opener after the final button", async () => {
            render(<Harness />);
            const opener = screen.getByRole("button", { name: "사용방법" });
            await user.click(opener);
            for (let i = 0; i < 6; i += 1) await user.click(nextButton());
            await user.click(nextButton());
            settle();
            expect(screen.queryByRole("dialog")).toBeNull();
            expect(opener).toHaveFocus();
        });

        it("returns focus to the opener after Esc", async () => {
            render(<Harness />);
            const opener = screen.getByRole("button", { name: "사용방법" });
            await user.click(opener);
            await user.keyboard("{Escape}");
            settle();
            expect(opener).toHaveFocus();
        });

        it("does not throw when it opened by itself and the opener was <body>", async () => {
            render(<Harness withOpener={false} />);
            expect(nextButton()).toHaveFocus();
            await user.click(within(dialog()).getByRole("button", { name: "건너뛰기" }));
            expect(() => settle()).not.toThrow();
            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });

    describe("demo player", () => {
        it("starts every demo and keeps its screen decorative (the full loops are covered in guideDemos.test)", async () => {
            renderGuide();
            for (const [index, key] of SLIDE_KEYS.entries()) {
                if (index > 0) {
                    await user.click(nextButton());
                    await act(async () => { await jest.advanceTimersByTimeAsync(2_000); });
                    const stage = q(`sheet_slide-${key}_stage`);
                    expect(stage).toHaveAttribute("aria-hidden", "true");
                    expect(stage?.querySelector("button, input, a, textarea, select")).toBeNull();
                }
            }
        });

        it("stops the previous slide's script as soon as the slide changes", async () => {
            renderGuide();
            await user.click(nextButton());
            await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
            const mini = q("sheet_slide-basics_stage_mini-screen") as HTMLElement;
            expect(mini.textContent).not.toBe("");
            await user.click(nextButton());
            const frozen = mini.innerHTML;
            await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
            expect(mini.innerHTML).toBe(frozen);
        });

        it("leaves no timer behind when it unmounts while a demo runs", async () => {
            const { unmount } = renderGuide();
            await user.click(nextButton());
            await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
            expect(jest.getTimerCount()).toBeGreaterThan(0);
            unmount();
            // Radix defers its own focus restore by one tick; everything the demo scheduled is already gone.
            act(() => { jest.runOnlyPendingTimers(); });
            expect(jest.getTimerCount()).toBe(0);
            await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
        });

        it("stops the demo when the guide closes", async () => {
            const { rerender } = renderGuide();
            await user.click(nextButton());
            await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
            rerender(<ServiceRecordGuide data-component={BASE} open={false} onClose={onClose} />);
            act(() => { jest.runOnlyPendingTimers(); });
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    describe("prefers-reduced-motion", () => {
        beforeEach(() => mockUseReducedMotion.mockReturnValue(true));

        it("schedules no demo timer and shows each demo's still frame without a progress bar", async () => {
            renderGuide();
            act(() => { jest.runOnlyPendingTimers(); }); // Radix's own mount tick
            for (const key of SLIDE_KEYS.slice(1)) {
                await user.click(nextButton());
                expect(q(`sheet_slide-${key}_stage_progress`)).toBeNull();
                expect(q(`sheet_slide-${key}_stage_mini-screen`)?.textContent).not.toBe("");
            }
            await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
            expect(jest.getTimerCount()).toBe(0);
            expect(q("sheet_slide-basics_stage_mini-screen")).toHaveTextContent("이예지");
            expect(q("sheet_slide-sign_stage_mini-screen")).toHaveTextContent("서명 완료");
            expect(q("sheet_slide-sched_stage_mini-screen")).toHaveTextContent("일정 변경 요청 대기 중");
        });

        it("turns the slide track without a transition", () => {
            renderGuide();
            const track = q("sheet_slide-intro")?.parentElement as HTMLElement;
            expect(track.style.transition).toBe("none");
        });
    });
});
