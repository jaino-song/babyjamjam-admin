import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAILY_ITEMS, DEFAULT_DAILY_ANSWERS, getDailyItemProblem } from "@babyjamjam/service-record-ui";

import { DayPageStep, type DayPageStepProps } from "../DayPageStep";
import { dailyFieldComponent, getDailyItemProblemId } from "../ids";

const ROOT = "mobile_service-record_wizard";

const makeProps = (overrides: Partial<DayPageStepProps> = {}): DayPageStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    pageIdx: 0,
    draft: { ...DEFAULT_DAILY_ANSWERS },
    editing: false,
    isRecordFinalized: false,
    scheduleChangeBusy: false,
    hasServiceDateMismatch: false,
    defaultDate: () => "2026-09-21",
    onBack: jest.fn(),
    onServiceDateChange: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(),
    onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(),
    onNextPage: jest.fn(),
    ...overrides,
});

const mealKeys = () => DAILY_ITEMS.find((item) => item.key === "meals")!.counts!.map((count) => `meals_${count.k}`);
const completeFirstPage = () => ({
    ...DEFAULT_DAILY_ANSWERS,
    ...Object.fromEntries(mealKeys().map((key) => [key, "1"])),
});

/** Keeps the draft in state like the screen root will. */
function Harness(props: Partial<DayPageStepProps>) {
    const [draft, setDraft] = useState<Record<string, unknown>>({ ...DEFAULT_DAILY_ANSWERS });
    return (
        <DayPageStep
            {...makeProps({
                draft,
                onFieldChange: (key, value) => setDraft((current) => ({ ...current, [key]: value })),
                ...props,
            })}
        />
    );
}

describe("DayPageStep", () => {
    it("renders the first page: back, date chip, service date field, items and next", () => {
        render(<DayPageStep {...makeProps()} />);

        expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
        expect(document.querySelector(`[data-component="${ROOT}_body_date-chip"]`)).toHaveTextContent("1회차");
        expect(document.querySelector(`[data-component="${ROOT}_body_day-title"]`)).toHaveTextContent("산모 기록");
        expect(screen.getByRole("textbox", { name: "제공일자" })).toHaveValue("2026-09-21");
        expect(screen.getByRole("group", { name: /회음절개부위/ })).toBeInTheDocument();
        expect(screen.getByRole("radiogroup", { name: /좌욕/ })).toBeInTheDocument();
        expect(screen.getByRole("spinbutton", { name: "식사" })).toBeInTheDocument();
        expect(screen.getByRole("spinbutton", { name: "간식" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
    });

    it("keeps every item's data-component for the Playwright specs", () => {
        render(<DayPageStep {...makeProps({ pageIdx: 1 })} />);
        const breast = document.querySelector(`[data-component="${ROOT}_body_day-field_breast-feeding"]`) as HTMLElement;
        const formula = document.querySelector(`[data-component="${ROOT}_body_day-field_formula-feeding"]`) as HTMLElement;
        expect(within(breast).getByRole("spinbutton", { name: "모유수유 횟수" })).toBeInTheDocument();
        expect(within(formula).getByRole("spinbutton", { name: "분유수유 횟수" })).toBeInTheDocument();
        expect(within(formula).getByRole("spinbutton", { name: "분유수유 회당" })).toBeInTheDocument();
    });

    it("forwards option and count changes with the shared wizard's arguments", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        render(<DayPageStep {...props} />);

        await user.click(within(screen.getByRole("group", { name: /회음절개부위/ })).getByRole("button", { name: "열상" }));
        expect(props.onToggleMulti).toHaveBeenCalledWith("perineum", "열상");
        await user.click(within(screen.getByRole("radiogroup", { name: /좌욕/ })).getByRole("button", { name: "미실시" }));
        expect(props.onFieldChange).toHaveBeenCalledWith("sitzBath", "미실시");
        await user.type(screen.getByRole("spinbutton", { name: "식사" }), "3");
        expect(props.onFieldChange).toHaveBeenCalledWith(mealKeys()[0], "3");
    });

    it("goes back with the 이전 button", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        render(<DayPageStep {...props} />);
        await user.click(screen.getByRole("button", { name: "이전" }));
        expect(props.onBack).toHaveBeenCalledTimes(1);
    });

    it("blocks 다음, focuses the first problem and shows its message", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        render(<DayPageStep {...props} />);

        await user.click(screen.getByRole("button", { name: "다음" }));

        expect(props.onNextPage).not.toHaveBeenCalled();
        const item = DAILY_ITEMS.find((candidate) => candidate.key === "meals")!;
        const expectedId = getDailyItemProblemId(
            item,
            dailyFieldComponent(ROOT, item),
            getDailyItemProblem(item, props.draft, {}),
        );
        expect(expectedId).toBeTruthy();
        expect(document.activeElement).toBe(document.getElementById(expectedId!));
        expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: "식사" }));
        expect(screen.getByRole("spinbutton", { name: "식사" })).toHaveAttribute("aria-invalid", "true");
    });

    it("advances once every item of the page is answered", async () => {
        const user = userEvent.setup();
        const props = makeProps({ draft: completeFirstPage() });
        render(<DayPageStep {...props} />);
        await user.click(screen.getByRole("button", { name: "다음" }));
        expect(props.onNextPage).toHaveBeenCalledTimes(1);
    });

    it("labels the action 저장 and hides the service date field while editing a submitted day", () => {
        render(<DayPageStep {...makeProps({ editing: true, draft: completeFirstPage() })} />);
        expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "다음" })).toBeNull();
        expect(screen.queryByRole("textbox", { name: "제공일자" })).toBeNull();
        expect(document.querySelector(`[data-component="${ROOT}_body_date-chip"]`)).toHaveTextContent("1회차 · 2026.09.21");
    });

    describe("service date", () => {
        it("shows the mismatch caution in the field's own message slot", () => {
            render(<DayPageStep {...makeProps({ hasServiceDateMismatch: true })} />);
            const slot = document.getElementById("service-record-date-helper")!;
            expect(slot).toHaveTextContent("오늘과 다른 날짜예요");
            expect(slot).toHaveAttribute("data-tone", "hint");
            expect(slot).toHaveAttribute("data-slot", "lab-msg");
            expect(screen.getByRole("textbox", { name: "제공일자" })).toHaveAttribute("aria-describedby", "service-record-date-helper");
            expect(document.querySelector(`[data-component="${ROOT}_body_service-date-readonly"]`)).toBeNull();
            expect(document.querySelector(`[data-component="${ROOT}_body_date-mismatch-notice"]`)).toBeNull();
        });

        it("keeps the caution in a read-only row on later pages", () => {
            render(<DayPageStep {...makeProps({ pageIdx: 1, hasServiceDateMismatch: true })} />);
            const row = document.querySelector(`[data-component="${ROOT}_body_service-date-readonly"]`) as HTMLElement;
            expect(row).not.toBeNull();
            expect(row).toHaveTextContent("서비스 제공일자");
            expect(row.querySelector('[data-slot="ro"]')).toHaveTextContent("2026-09-21");
            expect(row.querySelector('[data-slot="lab-msg"]')).toHaveTextContent("오늘과 다른 날짜예요");
            expect(document.getElementById("service-record-date-helper")).toBeNull();
            expect(screen.queryByRole("textbox", { name: "제공일자" })).toBeNull();
        });

        it("shows no date row on later pages when the date matches today", () => {
            render(<DayPageStep {...makeProps({ pageIdx: 1 })} />);
            expect(document.querySelector(`[data-component="${ROOT}_body_service-date-readonly"]`)).toBeNull();
            expect(screen.queryByText("오늘과 다른 날짜예요")).toBeNull();
        });

        it("reports a complete valid date and shows the range message for an earlier one", async () => {
            const user = userEvent.setup();
            const props = makeProps();
            render(<Harness {...props} />);
            const input = screen.getByRole("textbox", { name: "제공일자" });

            await user.clear(input);
            await user.type(input, "2026-09-25");
            expect(props.onServiceDateChange).toHaveBeenCalledWith("2026-09-25");

            await user.clear(input);
            await user.type(input, "2020-01-01");
            await user.tab();
            expect(document.getElementById("service-record-date-helper")).toHaveTextContent("이전 날짜는 선택할 수 없어요");
            expect(input).toHaveAttribute("aria-invalid", "true");
        });

        it("focuses a blocked service date before any item on 다음", async () => {
            const user = userEvent.setup();
            const props = makeProps();
            render(<Harness {...props} />);
            const input = screen.getByRole("textbox", { name: "제공일자" });

            await user.clear(input);
            await user.type(input, "2020-01-01");
            await user.click(screen.getByRole("button", { name: "다음" }));

            expect(props.onNextPage).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(input);
            expect(document.activeElement?.id).toBe("service-record-date");
        });

        it("locks the date to the planned dates and offers the schedule change", async () => {
            const user = userEvent.setup();
            const props = makeProps({
                context: {
                    totalSessions: 2, startDate: "2026-09-21", header: null, sessions: [],
                    plannedSessionDates: [
                        { sessionIndex: 1, serviceDate: "2026-09-21" },
                        { sessionIndex: 2, serviceDate: "2026-09-22" },
                    ],
                },
            });
            render(<DayPageStep {...props} />);

            expect(screen.getByRole("textbox", { name: "제공일자" })).toBeDisabled();
            expect(screen.getByText("제공일자를 바꾸려면 일정 변경을 요청해 주세요.")).toBeInTheDocument();
            await user.click(screen.getByRole("button", { name: "서비스 일정 변경" }));
            expect(props.onOpenScheduleChangePreview).toHaveBeenCalledTimes(1);
        });

        it("disables the schedule change while a request is pending", () => {
            render(<DayPageStep {...makeProps({
                context: {
                    totalSessions: 1, startDate: "2026-09-21", header: null, sessions: [],
                    plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-21" }],
                    pendingScheduleChange: { id: "p", sessionIndex: 1, fromDate: "2026-09-21", toDate: "2026-09-22" },
                },
            })} />);
            expect(screen.getByRole("button", { name: "일정 변경 요청 대기 중" })).toBeDisabled();
        });
    });
});
