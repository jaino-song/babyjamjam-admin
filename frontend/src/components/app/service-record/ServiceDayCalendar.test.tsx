import { fireEvent, render, screen } from "@testing-library/react";

import { ServiceDayCalendar, type ServiceDayCell, type ServiceDayCellState } from "./ServiceDayCalendar";

const DEFAULT_CELL: ServiceDayCell = { state: "available", order: null, extra: false, holiday: false };

function renderCalendar(overrides: {
    describeDay?: (iso: string) => ServiceDayCell;
    onSelectDay?: (iso: string) => void;
    onPrevious?: () => void;
    onNext?: () => void;
    canGoPrevious?: boolean;
    canGoNext?: boolean;
} = {}) {
    const onSelectDay = overrides.onSelectDay ?? jest.fn();
    const onPrevious = overrides.onPrevious ?? jest.fn();
    const onNext = overrides.onNext ?? jest.fn();
    const view = render(
        <ServiceDayCalendar
            data-component="test_calendar"
            year={2026}
            month={12}
            canGoPrevious={overrides.canGoPrevious ?? true}
            canGoNext={overrides.canGoNext ?? true}
            onPrevious={onPrevious}
            onNext={onNext}
            describeDay={overrides.describeDay ?? (() => DEFAULT_CELL)}
            onSelectDay={onSelectDay}
        />,
    );
    return { ...view, onSelectDay, onPrevious, onNext };
}

function day(iso: string): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>(`button[data-slot="day"][data-date="${iso}"]`);
    if (!element) throw new Error(`no day ${iso}`);
    return element;
}

describe("ServiceDayCalendar", () => {
    it("renders the month title, every day of the month and starts the first on the right weekday", () => {
        renderCalendar();

        expect(screen.getByText("2026년 12월")).toBeInTheDocument();
        expect(document.querySelectorAll('button[data-slot="day"]')).toHaveLength(31);
        // 2026-12-01 is a Tuesday: two blanks (Sun, Mon) come first.
        expect(document.querySelectorAll('[data-slot="weekday"]')).toHaveLength(7);
        const grid = document.querySelector('[role="group"]') as HTMLElement;
        const cells = Array.from(grid.children);
        expect(cells[7]).toHaveAttribute("aria-hidden", "true");
        expect(cells[8]).toHaveAttribute("aria-hidden", "true");
        expect(cells[9]).toBe(day("2026-12-01"));
    });

    it("calls onSelectDay for an interactive day and not for a disabled one", () => {
        const states: Record<string, ServiceDayCellState> = {
            "2026-12-14": "selected",
            "2026-12-15": "fixed",
            "2026-12-19": "skipped",
            "2026-12-20": "unavailable",
            "2026-12-13": "before-start",
        };
        const { onSelectDay } = renderCalendar({
            describeDay: (iso) => ({ ...DEFAULT_CELL, state: states[iso] ?? "available", order: states[iso] === "selected" || states[iso] === "fixed" ? 1 : null }),
        });

        for (const iso of ["2026-12-14", "2026-12-15", "2026-12-19", "2026-12-17"]) {
            expect(day(iso)).toBeEnabled();
            fireEvent.click(day(iso));
        }
        for (const iso of ["2026-12-20", "2026-12-13"]) {
            expect(day(iso)).toBeDisabled();
            fireEvent.click(day(iso));
        }

        expect((onSelectDay as jest.Mock).mock.calls.map((call) => call[0])).toEqual([
            "2026-12-14", "2026-12-15", "2026-12-19", "2026-12-17",
        ]);
    });

    it("exposes state, session number and pressed state to assistive tech", () => {
        renderCalendar({
            describeDay: (iso) => {
                if (iso === "2026-12-14") return { state: "fixed", order: 1, extra: false, holiday: false };
                if (iso === "2026-12-17") return { state: "selected", order: 4, extra: false, holiday: false };
                return DEFAULT_CELL;
            },
        });

        expect(day("2026-12-14")).toHaveAttribute("data-state", "fixed");
        expect(day("2026-12-14")).toHaveAttribute("aria-pressed", "true");
        expect(day("2026-12-14")).toHaveAccessibleName("12/14(월) 1회차, 바꿀 수 없음");
        expect(day("2026-12-17")).toHaveAttribute("data-state", "selected");
        expect(day("2026-12-17")).toHaveAccessibleName("12/17(목) 4회차, 누르면 뺍니다");
        expect(day("2026-12-18")).toHaveAttribute("aria-pressed", "false");
        expect(day("2026-12-18")).toHaveAccessibleName("12/18(금) 선택");
    });

    it("marks a holiday on its day", () => {
        renderCalendar({
            describeDay: (iso) => (iso === "2026-12-25"
                ? { state: "unavailable", order: null, extra: true, holiday: true }
                : DEFAULT_CELL),
        });

        expect(day("2026-12-25")).toHaveTextContent("공휴일");
        expect(day("2026-12-24")).not.toHaveTextContent("공휴일");
    });

    it("moves between months and disables a bound that is not allowed", () => {
        const { onPrevious, onNext, rerender } = renderCalendar();

        fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
        fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);

        rerender(
            <ServiceDayCalendar
                data-component="test_calendar"
                year={2026}
                month={12}
                canGoPrevious={false}
                canGoNext={false}
                onPrevious={onPrevious}
                onNext={onNext}
                describeDay={() => DEFAULT_CELL}
                onSelectDay={jest.fn()}
            />,
        );
        expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
    });

    it("shows the legend and names its root for the data-component convention", () => {
        const { container } = renderCalendar();

        expect(screen.getByText("평일")).toBeInTheDocument();
        expect(screen.getByText("주말·공휴일")).toBeInTheDocument();
        expect(screen.getByText("빠진 날")).toBeInTheDocument();
        expect(screen.getByText("선택 가능")).toBeInTheDocument();
        expect(screen.getByText("선택 불가")).toBeInTheDocument();
        expect(container.firstElementChild).toHaveAttribute("data-component", "test_calendar");
        expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceDayCalendar");
    });
});
