import { fireEvent, render, screen, within } from "@testing-library/react";
import { DAILY_ITEMS, DEFAULT_DAILY_ANSWERS, type ServiceRecordWizardSlots } from "@babyjamjam/service-record-ui";

import { DayPageStep, type DayPageStepProps } from "../DayPageStep";

const ROOT = "desktop_service-record-admin_wizard";

const makeProps = (overrides: Partial<DayPageStepProps> = {}): DayPageStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    pageIdx: 0,
    draft: { ...DEFAULT_DAILY_ANSWERS },
    editing: false,
    busy: false,
    hasServiceDateMismatch: false,
    defaultDate: () => "2026-09-21",
    onBack: jest.fn(),
    onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(),
    onNextPage: jest.fn(),
    onOpenServiceDateEditor: jest.fn(),
    ...overrides,
});

const byComponent = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`) as HTMLElement | null;

const serviceDateDisplay: NonNullable<ServiceRecordWizardSlots["serviceDateDisplay"]> = ({ "data-component": component, serviceDate }) => (
    <span data-component={component} data-slot="date-display">{serviceDate}</span>
);
const serviceDateEditor: NonNullable<ServiceRecordWizardSlots["serviceDateEditor"]> = ({ "data-component": component, disabled, onOpen }) => (
    <button type="button" data-component={component} data-slot="sec-edit" aria-label="제공일 수정" disabled={disabled} onClick={onOpen}>수정</button>
);

describe("DayPageStep", () => {
    it("renders the first page: back, chip, title, items and 다음 without a public date field", () => {
        render(<DayPageStep {...makeProps()} />);

        expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
        expect(byComponent("body_date-chip")).toHaveTextContent("1회차");
        expect(byComponent("body_day-title")).toHaveTextContent("산모 기록");
        expect(screen.getByRole("group", { name: /회음절개부위/ })).toBeInTheDocument();
        expect(screen.getByRole("radiogroup", { name: /좌욕/ })).toBeInTheDocument();
        expect(screen.getByRole("spinbutton", { name: "식사" })).toBeInTheDocument();
        expect(screen.getByRole("spinbutton", { name: "간식" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
        // SRW:590 - the public service-date input (and the schedule change) never render in admin.
        expect(screen.queryByRole("textbox", { name: "제공일자" })).toBeNull();
        expect(document.getElementById("service-record-date")).toBeNull();
        expect(screen.queryByRole("button", { name: "서비스 일정 변경" })).toBeNull();
    });

    it("keeps every item's data-component for the Playwright specs", () => {
        render(<DayPageStep {...makeProps({ pageIdx: 1 })} />);
        const breast = byComponent("body_day-field_breast-feeding")!;
        const formula = byComponent("body_day-field_formula-feeding")!;
        expect(within(breast).getByRole("spinbutton", { name: "모유수유 횟수" })).toBeInTheDocument();
        expect(within(formula).getByRole("spinbutton", { name: "분유수유 횟수" })).toBeInTheDocument();
        expect(within(formula).getByRole("spinbutton", { name: "분유수유 회당" })).toBeInTheDocument();
    });

    it("forwards option and count changes with the shared wizard's arguments", () => {
        const props = makeProps();
        render(<DayPageStep {...props} />);

        fireEvent.click(within(screen.getByRole("group", { name: /회음절개부위/ })).getByRole("button", { name: "열상" }));
        expect(props.onToggleMulti).toHaveBeenCalledWith("perineum", "열상");
        fireEvent.click(within(screen.getByRole("radiogroup", { name: /좌욕/ })).getByRole("button", { name: "미실시" }));
        expect(props.onFieldChange).toHaveBeenCalledWith("sitzBath", "미실시");
        const mealKey = `meals_${DAILY_ITEMS.find((item) => item.key === "meals")!.counts![0].k}`;
        fireEvent.change(screen.getByRole("spinbutton", { name: "식사" }), { target: { value: "3" } });
        expect(props.onFieldChange).toHaveBeenCalledWith(mealKey, "3");
    });

    it("goes back with the 이전 button", () => {
        const props = makeProps();
        render(<DayPageStep {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        expect(props.onBack).toHaveBeenCalledTimes(1);
    });

    it("calls onNextPage without validation, with no argument, even for an empty page", () => {
        const props = makeProps({ draft: {} });
        render(<DayPageStep {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(props.onNextPage).toHaveBeenCalledTimes(1);
        expect(props.onNextPage).toHaveBeenCalledWith();
        // No focus-first-problem, no required messages (SRW:663-666).
        expect(document.activeElement).toBe(document.body);
        expect(screen.getByRole("spinbutton", { name: "식사" })).not.toHaveAttribute("aria-invalid");
    });

    it("keeps the label 다음 while editing a submitted day (SRW:1034)", () => {
        render(<DayPageStep {...makeProps({ editing: true })} />);
        expect(screen.getByRole("button", { name: "다음" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    });

    it("disables 다음 only while a number on this page is invalid (SRW:1031)", () => {
        const { rerender } = render(<DayPageStep {...makeProps({ draft: { meals_meal: "abc" } })} />);
        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        expect(screen.getByRole("spinbutton", { name: "식사" })).toHaveAttribute("aria-invalid", "true");

        // The invalid number is on page 0; another page is not blocked.
        rerender(<DayPageStep {...makeProps({ pageIdx: 2, draft: { meals_meal: "abc" } })} />);
        expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
    });

    describe("date chip and editor", () => {
        it("renders the display slot inside the chip only while editing, and the editor beside it", () => {
            const props = makeProps({ editing: true, serviceDateDisplay, serviceDateEditor });
            render(<DayPageStep {...props} />);

            const chip = byComponent("body_date-chip")!;
            expect(chip).toHaveAttribute("data-slot", "datechip");
            expect(chip).toHaveTextContent("1회차 · 2026-09-21");
            expect(within(chip).getByText("2026-09-21")).toHaveAttribute("data-component", `${ROOT}_body_date-chip_date-display`);

            const edit = byComponent("body_date-edit")!;
            expect(edit).toHaveAttribute("data-slot", "sec-edit");
            expect(edit.parentElement).toHaveClass("date-row");
            expect(chip.parentElement).toBe(edit.parentElement);
            expect(edit.parentElement).toHaveAttribute("data-slot", "date-row");
        });

        it("falls back to the month/day in the chip without a display slot, and shows nothing when not editing", () => {
            const { unmount } = render(<DayPageStep {...makeProps({ editing: true })} />);
            expect(byComponent("body_date-chip")).toHaveTextContent("1회차 · 2026.09.21");
            unmount();

            render(<DayPageStep {...makeProps({ editing: false, serviceDateDisplay })} />);
            expect(byComponent("body_date-chip")).toHaveTextContent(/^1회차$/);
            expect(byComponent("body_date-chip_date-display")).toBeNull();
        });

        it("hands the editor SRW's arguments and wires onOpenServiceDateEditor with the day", () => {
            const editor = jest.fn(serviceDateEditor);
            const props = makeProps({ day: 3, serviceDateEditor: editor });
            render(<DayPageStep {...props} />);

            expect(editor).toHaveBeenCalledWith(expect.objectContaining({
                "data-component": `${ROOT}_body_date-edit`,
                sessionIndex: 3,
                serviceDate: "2026-09-21",
                disabled: false,
            }));
            fireEvent.click(screen.getByRole("button", { name: "제공일 수정" }));
            expect(props.onOpenServiceDateEditor).toHaveBeenCalledWith(3);
        });

        it.each([["busy", { busy: true }], ["readOnly", { readOnly: true }]])("disables the editor while %s", (_name, overrides) => {
            render(<DayPageStep {...makeProps({ serviceDateEditor, ...overrides })} />);
            expect(screen.getByRole("button", { name: "제공일 수정" })).toBeDisabled();
        });

        it("renders no editor without the slot", () => {
            render(<DayPageStep {...makeProps()} />);
            expect(byComponent("body_date-edit")).toBeNull();
            expect(byComponent("body_date-chip")!.parentElement).toHaveClass("date-row");
        });
    });

    describe("service date caution", () => {
        it("shows a read-only row on page 0 too, in the field's message slot", () => {
            render(<DayPageStep {...makeProps({ hasServiceDateMismatch: true })} />);
            const row = byComponent("body_service-date-readonly")!;
            expect(row).toHaveTextContent("서비스 제공일자");
            expect(row.querySelector('[data-slot="ro"]')).toHaveTextContent("2026-09-21");
            const message = row.querySelector('[data-slot="lab-msg"]')!;
            expect(message).toHaveTextContent("오늘과 다른 날짜예요");
            expect(message).toHaveAttribute("data-tone", "hint");
            expect(message).toHaveAttribute("id", "service-record-date-readonly-helper");
        });

        it("also shows while editing, but never in read-only mode (SRW:956)", () => {
            const { unmount } = render(<DayPageStep {...makeProps({ hasServiceDateMismatch: true, editing: true })} />);
            expect(byComponent("body_service-date-readonly")).not.toBeNull();
            unmount();

            render(<DayPageStep {...makeProps({ hasServiceDateMismatch: true, readOnly: true })} />);
            expect(byComponent("body_service-date-readonly")).toBeNull();
        });

        it("is absent when the date does not mismatch", () => {
            render(<DayPageStep {...makeProps()} />);
            expect(byComponent("body_service-date-readonly")).toBeNull();
        });
    });

    describe("readOnly", () => {
        it("disables every control but keeps 이전 and 다음 live (SRW:1031, :1034)", () => {
            const props = makeProps({ readOnly: true, draft: { meals_meal: "abc" } });
            render(<DayPageStep {...props} />);
            for (const input of screen.getAllByRole("spinbutton")) expect(input).toBeDisabled();
            for (const option of within(screen.getByRole("group", { name: /회음절개부위/ })).getAllByRole("button")) expect(option).toBeDisabled();

            expect(screen.getByRole("button", { name: "이전" })).toBeEnabled();
            const next = screen.getByRole("button", { name: "다음" });
            expect(next).toBeEnabled();
            fireEvent.click(next);
            expect(props.onNextPage).toHaveBeenCalledTimes(1);
        });
    });
});
