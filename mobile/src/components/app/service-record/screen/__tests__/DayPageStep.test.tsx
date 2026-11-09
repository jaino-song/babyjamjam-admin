import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAILY_ITEMS, DEFAULT_DAILY_ANSWERS, getDailyItemProblem, resolvePlannedDates } from "@babyjamjam/service-record-ui";

import { DayPageStep as DayPageStepBase, type DayPageStepProps as BaseProps } from "../DayPageStep";
import { dailyFieldComponent, getDailyItemProblemId } from "../ids";
import { useServiceDateFieldState } from "../serviceDateFieldState";

type DayPageStepProps = Omit<BaseProps, "dateState">;

/** The step with the date-field state the screen root normally owns. */
function DayPageStep(props: DayPageStepProps) {
    const { currentServiceDate } = resolvePlannedDates({
        context: props.context, day: props.day, adminMode: false, draft: props.draft, defaultDate: props.defaultDate,
    });
    const dateState = useServiceDateFieldState({ currentServiceDate, day: props.day });
    return <DayPageStepBase {...props} dateState={dateState} />;
}

const ROOT = "mobile_service-record_wizard";

const makeProps = (overrides: Partial<DayPageStepProps> = {}): DayPageStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    pageIdx: 0,
    draft: { _date: "2026-09-21", ...DEFAULT_DAILY_ANSWERS },
    editing: false,
    isRecordFinalized: false,


    defaultDate: () => "2026-09-21",
    onBack: jest.fn(),


    onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(),
    onNextPage: jest.fn(),
    ...overrides,
});

const mealKeys = () => DAILY_ITEMS.find((item) => item.key === "meals")!.counts!.map((count) => `meals_${count.k}`);
const completeFirstPage = () => ({
    ...DEFAULT_DAILY_ANSWERS,
    _date: "2026-09-21",
    ...Object.fromEntries(mealKeys().map((key) => [key, "1"])),
});

describe("DayPageStep", () => {
    it("renders the first page: back, date chip, service date field, items and next", () => {
        render(<DayPageStep {...makeProps()} />);

        expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
        expect(document.querySelector(`[data-component="${ROOT}_body_date-chip"]`)).toHaveTextContent("1회차");
        expect(document.querySelector(`[data-component="${ROOT}_body_day-title"]`)).toHaveTextContent("산모 기록");
        expect(screen.getByRole("textbox", { name: "서비스 제공일" })).toHaveValue("1회차 · 2026.09.21");
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
        expect(screen.queryByRole("textbox", { name: "서비스 제공일" })).toBeNull();
        expect(document.querySelector(`[data-component="${ROOT}_body_date-chip"]`)).toBeNull();
    });

    describe("service date sheet trigger", () => {
        it("starts empty, opens the sheet, and requires a date before Next", async () => {
            const user = userEvent.setup();
            const props = makeProps({ draft: { ...completeFirstPage(), _date: "" }, onOpenDateSheet: jest.fn() });
            const { rerender } = render(<DayPageStep {...props} />);
            const input = screen.getByRole("textbox", { name: "서비스 제공일" });
            expect(input).toHaveValue("");
            expect(input).toHaveAttribute("placeholder", "날짜를 선택하세요");
            expect(input).toHaveAttribute("readonly");
            await user.click(input);
            expect(props.onOpenDateSheet).toHaveBeenCalledTimes(1);
            await user.click(screen.getByRole("button", { name: "다음" }));
            expect(props.onNextPage).not.toHaveBeenCalled();
            expect(input).toHaveFocus();
            expect(input).toHaveAttribute("aria-invalid", "true");
            rerender(<DayPageStep {...props} draft={completeFirstPage()} />);
            expect(input).toHaveValue("1회차 · 2026.09.21");
            await user.click(screen.getByRole("button", { name: "다음" }));
            expect(props.onNextPage).toHaveBeenCalledTimes(1);
        });
        it("shows the server's date refusal in the date field", () => {
            render(<DayPageStep {...makeProps({ serviceDateError: "고를 수 있는 기간이 아니에요." })} />);
            expect(document.getElementById("service-record-date-helper")).toHaveTextContent("고를 수 있는 기간이 아니에요.");
        });
    });
});
