import { fireEvent, render, screen } from "@testing-library/react";
import { createKrBusinessDayCalendar } from "@/lib/date/business-days";
import { ServiceDateSheet, classifyServiceDate, GAP_ROOM, ORDER_AFTER, ORDER_BEFORE } from "../ServiceDateSheet";
import type { ServiceDateSheetProps } from "../ServiceDateSheet";

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-11T03:00:00Z"));
});
afterEach(() => { jest.useRealTimers(); });

const calendar = createKrBusinessDayCalendar(["2026-11-09"], { supportedYears: [2026] });
const props = (overrides: Partial<ServiceDateSheetProps> = {}): ServiceDateSheetProps => ({
    "data-component": "mobile_service-record_wizard_service-date-sheet",
    context: { totalSessions: 4, startDate: "2026-11-02", endDate: "2026-11-17", header: {}, sessions: [] },
    day: 1, value: "", editing: false, calendar, calendarReady: true,
    onClose: jest.fn(), onSelect: jest.fn(), onOrderBlocked: jest.fn(), ...overrides,
});

describe("initial calendar month", () => {
    const context = { totalSessions: 12, startDate: "2026-10-22", endDate: "2026-11-11", header: {}, sessions: [] };

    it("opens an empty session on today's month within the selectable window", () => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        expect(screen.getByText("2026년 11월")).toBeInTheDocument();
        expect(screen.queryByText(/고를 수 있는 기간/)).toBeNull();
        expect(screen.getByText("서비스 기간: 10.22(목) ~ 11.11(수)")).toBeInTheDocument();
    });

    it.each([
        ["2026-10-01T03:00:00Z", "2026년 10월"],
        ["2026-12-05T03:00:00Z", "2026년 11월"],
        ["2026-10-31T15:30:00Z", "2026년 11월"],
    ])("clamps today %s to the window month %s", (today, month) => {
        jest.setSystemTime(new Date(today));
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        expect(screen.getByText(month)).toBeInTheDocument();
    });

    it("opens an edited session on its value's month instead of today's month", () => {
        render(<ServiceDateSheet {...props({ context, day: 12, editing: true, value: "2026-10-22" })} />);
        expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    });
});

describe("today and stored-date labels", () => {
    const context = { ...props().context, sessions: [{ sessionIndex: 1, serviceDate: "2026-11-02", locked: false }] };

    it.each([true, false])("marks today in register mode without changing its date state (calendar ready: %s)", (calendarReady) => {
        render(<ServiceDateSheet {...props({ context, value: "2026-11-02", calendarReady })} />);
        const today = screen.getByRole("button", { name: "2026.11.11(수) 오늘" });
        expect(today.querySelector("small")).toHaveTextContent("오늘");
        expect(today.querySelector("small")).toHaveClass("mt-0.5", "text-xs", "font-extrabold", "leading-none", "text-v3-primary");
        expect(today).toHaveAttribute("data-day-state", calendarReady ? "available" : "blocked");
        expect(today).toHaveAttribute("aria-disabled", String(!calendarReady));
        expect(today).toHaveAttribute("aria-pressed", "false");
        if (!calendarReady) {
            expect(today.className).toContain("bg-[repeating-linear-gradient");
            expect(today).toHaveClass("text-v3-text-muted/70", "border-v3-primary/40!");
            expect(today).not.toHaveClass("text-v3-primary", "border-dashed", "bg-v3-primary");
        }
        const stored = screen.getByRole("button", { name: "2026.11.02(월)" });
        expect(stored.querySelector("small")).toBeNull();
        expect(stored).not.toHaveClass("border-dashed", "text-v3-primary");
        expect(stored).toHaveAttribute("aria-disabled", "true");
        expect(stored).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByText(/현재|지금/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
    });

    it("keeps the stored register date unmarked when returning from a pending pick", () => {
        const p = props({ context, value: "2026-11-05" });
        render(<ServiceDateSheet {...p} />);
        const stored = screen.getByRole("button", { name: "2026.11.02(월)" });
        expect(stored.querySelector("small")).toBeNull();
        expect(stored).not.toHaveClass("border-dashed", "text-v3-primary");
        expect(stored).toHaveAttribute("aria-disabled", "false");
        expect(stored).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(stored);
        fireEvent.click(screen.getByRole("button", { name: "선택" }));
        expect(p.onSelect).toHaveBeenCalledWith("2026-11-02");
    });

    it("keeps today's label visible when selected in register mode", () => {
        render(<ServiceDateSheet {...props({ context, value: "2026-11-02" })} />);
        const today = screen.getByRole("button", { name: "2026.11.11(수) 오늘" });
        expect(today.querySelector("small")).toHaveClass("text-v3-primary");
        fireEvent.click(today);
        expect(today).toHaveAttribute("aria-pressed", "true");
        expect(today).toHaveClass("bg-v3-primary", "text-white");
        expect(today.querySelector("small")).toHaveTextContent("오늘");
        expect(today.querySelector("small")).not.toHaveClass("text-v3-primary");
    });

    it("gives another session's label priority over today in register mode", () => {
        const usedContext = { ...context, sessions: [...context.sessions, { sessionIndex: 2, serviceDate: "2026-11-11", locked: true }] };
        render(<ServiceDateSheet {...props({ context: usedContext, value: "2026-11-02" })} />);
        const used = screen.getByRole("button", { name: "2026.11.11(수) 2회차" });
        expect(used.querySelector("small")).toHaveTextContent("2회차");
        expect(used.querySelector("small")).not.toHaveClass("text-v3-primary");
        expect(used).toHaveAttribute("aria-disabled", "true");
        expect(screen.queryByText("오늘")).not.toBeInTheDocument();
        expect(screen.queryByText(/현재|지금/)).not.toBeInTheDocument();
    });

    it.each(["2026-11-02", "2026-11-11"])("marks only the stored date as 현재 in edit mode (%s)", (serviceDate) => {
        const editContext = { ...context, sessions: [{ sessionIndex: 1, serviceDate, locked: false }] };
        render(<ServiceDateSheet {...props({ context: editContext, value: serviceDate, editing: true })} />);
        const date = serviceDate === "2026-11-02" ? "2026.11.02(월)" : "2026.11.11(수)";
        const stored = screen.getByRole("button", { name: `${date} 현재` });
        expect(stored.querySelector("small")).toHaveTextContent("현재");
        expect(stored).toHaveClass("border-dashed", "border-v3-primary!", "text-v3-primary");
        expect(stored).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText(`현재 ${date}`)).toBeInTheDocument();
        expect(screen.queryByText("오늘")).not.toBeInTheDocument();
        expect(screen.queryByText(/지금/)).not.toBeInTheDocument();
        if (serviceDate !== "2026-11-11") expect(screen.getByRole("button", { name: "2026.11.11(수)" }).querySelector("small")).toBeNull();
    });

    it("labels today when it is also the stored register date", () => {
        const todayContext = { ...context, sessions: [{ sessionIndex: 1, serviceDate: "2026-11-11", locked: false }] };
        render(<ServiceDateSheet {...props({ context: todayContext, value: "2026-11-11" })} />);
        const today = screen.getByRole("button", { name: "2026.11.11(수) 오늘" });
        expect(today.querySelector("small")).toHaveTextContent("오늘");
        expect(today).not.toHaveClass("border-dashed", "text-v3-primary");
        expect(today).toHaveAttribute("aria-disabled", "true");
        expect(today).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByText(/현재|지금/)).not.toBeInTheDocument();
    });
});

describe("month navigation labels and sheet structure", () => {
    it("shows the adjacent month numbers in November", () => {
        render(<ServiceDateSheet {...props()} />);
        expect(screen.getByText("2026년 11월")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "이전 달 10월" })).toHaveTextContent(/^10월$/);
        expect(screen.getByRole("button", { name: "다음 달 12월" })).toHaveTextContent(/^12월$/);
    });

    it("labels January without a year when viewing December", () => {
        const context = { ...props().context, endDate: "2027-01-15" };
        render(<ServiceDateSheet {...props({ context, value: "2026-12-15" })} />);
        expect(screen.getByText("2026년 12월")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "이전 달 11월" })).toHaveTextContent(/^11월$/);
        const next = screen.getByRole("button", { name: "다음 달 1월" });
        expect(next).toHaveTextContent(/^1월$/);
        expect(next).toBeEnabled();
        fireEvent.click(next);
        expect(screen.getByText("2027년 1월")).toBeInTheDocument();
    });

    it("renders the bottom sheet directly after its overlay", () => {
        render(<ServiceDateSheet {...props()} />);
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveAttribute("data-side", "bottom");
        expect(dialog.previousElementSibling).toHaveAttribute("data-slot", "sheet-overlay");
    });
});

describe("service-period borders", () => {
    const context = {
        totalSessions: 12, startDate: "2026-10-22", endDate: "2026-11-11", header: {},
        sessions: [
            "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
            "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
        ].map((serviceDate, index) => ({ sessionIndex: index + 1, serviceDate, locked: true })),
    };
    const hatch = "bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)]";

    it.each(["2026.11.06(금)", "2026.11.11(수) 오늘"])("outlines available in-period day %s inclusively", (name) => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        const cell = screen.getByRole("button", { name });
        expect(cell).toHaveAttribute("data-day-state", "available");
        expect(cell).toHaveAttribute("data-in-period", "true");
        expect(cell).toHaveClass("border-v3-primary!", "border-[1.5px]");
        expect(cell).not.toHaveClass("border-v3-border!");
    });

    it("keeps the used-day border strong even when session order classifies it as before", () => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        const cell = screen.getByRole("button", { name: "2026.11.02(월) 8회차" });
        expect(cell).toHaveAttribute("data-day-state", "before");
        expect(cell).toHaveAttribute("data-in-period", "true");
        expect(cell).toHaveClass(hatch, "border-v3-primary!", "border-[1.5px]");
        expect(cell).not.toHaveClass("border-v3-primary/40!");
        expect(cell).toHaveTextContent("8회차");
    });

    it.each(["2026.11.07(토)", "2026.11.09(월)", "2026.11.01(일)"])("softens the border on hatched in-period day %s without another session", (name) => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        const cell = screen.getByRole("button", { name });
        expect(cell).toHaveAttribute("data-in-period", "true");
        expect(cell).toHaveClass(hatch, "border-v3-primary/40!", "border-[1.5px]");
        expect(cell).not.toHaveClass("border-v3-primary!");
    });

    it.each(["2026.11.12(목)", "2026.11.13(금)"])("leaves available margin day %s unchanged", (name) => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        const cell = screen.getByRole("button", { name });
        expect(cell).toHaveAttribute("data-day-state", "available");
        expect(cell).not.toHaveAttribute("data-in-period");
        expect(cell).toHaveClass("border", "border-v3-border", "bg-white", "text-v3-dark");
        expect(cell).not.toHaveClass("border-v3-primary!");
        expect(cell).not.toHaveClass("border-v3-primary/40!");
        expect(cell).not.toHaveClass("border-[1.5px]");
    });

    it("includes the first period day while leaving the preceding hatched margin unchanged", () => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        fireEvent.click(screen.getByRole("button", { name: "이전 달 10월" }));
        const first = screen.getByRole("button", { name: "2026.10.22(목) 1회차" });
        expect(first).toHaveAttribute("data-in-period", "true");
        expect(first).toHaveClass(hatch, "border-v3-primary!", "border-[1.5px]");
        expect(first).not.toHaveClass("border-v3-primary/40!");
        expect(first).toHaveTextContent("1회차");
        const margin = screen.getByRole("button", { name: "2026.10.21(수)" });
        expect(margin).toHaveAttribute("data-day-state", "before");
        expect(margin).not.toHaveAttribute("data-in-period");
        expect(margin).toHaveClass(hatch, "border", "border-v3-border");
        expect(margin).not.toHaveClass("border-v3-primary!");
        expect(margin).not.toHaveClass("border-v3-primary/40!");
    });

    it("preserves the selected fill on an in-period day", () => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        const cell = screen.getByRole("button", { name: "2026.11.06(금)" });
        fireEvent.click(cell);
        expect(cell).toHaveAttribute("aria-pressed", "true");
        expect(cell).toHaveClass("border-v3-primary!", "bg-v3-primary", "text-white");
        expect(cell).not.toHaveClass("bg-white");
        expect(screen.getByRole("button", { name: "선택" })).toBeEnabled();
    });

    it("forces the primary border and selected fill on an available margin day", () => {
        const p = props({ context, day: 12 });
        render(<ServiceDateSheet {...p} />);
        const cell = screen.getByRole("button", { name: "2026.11.12(목)" });
        expect(cell).toHaveAttribute("data-day-state", "available");
        fireEvent.click(cell);
        expect(cell).toHaveAttribute("aria-pressed", "true");
        expect(cell).toHaveClass("border-v3-primary!", "bg-v3-primary");
        expect(cell).not.toHaveAttribute("data-in-period");
        fireEvent.click(screen.getByRole("button", { name: "선택" }));
        expect(p.onSelect).toHaveBeenCalledWith("2026-11-12");
    });

    it("forces the dashed primary border on the current margin day", () => {
        const editingContext = { ...context, sessions: [...context.sessions, { sessionIndex: 12, serviceDate: "2026-11-12", locked: true }] };
        render(<ServiceDateSheet {...props({ context: editingContext, day: 12, editing: true, value: "2026-11-12" })} />);
        const cell = screen.getByRole("button", { name: "2026.11.12(목) 현재" });
        expect(cell).toHaveAttribute("data-day-state", "current");
        expect(cell).toHaveAttribute("aria-pressed", "false");
        expect(cell).toHaveClass("border-dashed", "border-v3-primary!");
        expect(cell).not.toHaveAttribute("data-in-period");
    });

    it("preserves the current dashed primary border and selected fill", () => {
        const editingContext = { ...context, sessions: [...context.sessions, { sessionIndex: 12, serviceDate: "2026-11-10", locked: true }] };
        render(<ServiceDateSheet {...props({ context: editingContext, day: 12, editing: true, value: "2026-11-11" })} />);
        const current = screen.getByRole("button", { name: "2026.11.10(화) 현재" });
        expect(current).toHaveAttribute("data-in-period", "true");
        expect(current).toHaveClass("border-dashed", "border-v3-primary!", "text-v3-primary");
        expect(current).not.toHaveClass("border-v3-primary/40!");
        fireEvent.click(current);
        expect(current).toHaveClass("border-dashed", "border-v3-primary!", "bg-v3-primary", "text-white");
        expect(current).not.toHaveClass("text-v3-primary");
    });

    it("omits the service period from the legend and keeps the blocked swatch", () => {
        render(<ServiceDateSheet {...props({ context, day: 12 })} />);
        expect(document.querySelector('[data-component$="_calendar_legend_period"]')).not.toBeInTheDocument();
        expect(screen.queryByText(/서비스 기간 \(/)).not.toBeInTheDocument();
        const selected = screen.getByText("선택한 날");
        expect(selected.parentElement?.firstElementChild).toBe(selected);
        expect(screen.getByText("선택 가능")).toBeInTheDocument();
        expect(screen.getByText("선택 불가").querySelector("i")).toHaveClass("mr-1", "inline-block", "h-3", "w-3", "rounded", "border", "align-middle", "border-v3-border", "text-v3-text-muted/70", hatch);
    });

    it.each([
        { ...context, endDate: null },
        { ...context, startDate: null },
    ])("omits period markers and legend without both bounds (case %#)", (incompleteContext) => {
        render(<ServiceDateSheet {...props({ context: incompleteContext, day: 12 })} />);
        expect(screen.queryByText(/^서비스 기간/)).not.toBeInTheDocument();
        expect(document.querySelector('[data-component$="_calendar_window"]')).not.toBeInTheDocument();
        for (const cell of screen.getAllByRole("button")) expect(cell).not.toHaveAttribute("data-in-period");
    });
});

it("allows inclusive window edges and blocks weekends, holidays, and unloaded years", () => {
    const rules = props();
    expect(classifyServiceDate("2026-10-26", rules)).toBe("available");
    expect(classifyServiceDate("2026-10-23", rules)).toBe("blocked");
    expect(classifyServiceDate("2026-11-24", rules)).toBe("available");
    expect(classifyServiceDate("2026-11-25", rules)).toBe("blocked");
    expect(classifyServiceDate("2026-11-07", rules)).toBe("blocked");
    expect(classifyServiceDate("2026-11-08", rules)).toBe("blocked");
    expect(classifyServiceDate("2026-11-09", rules)).toBe("blocked");
    expect(classifyServiceDate("2026-11-05", { ...rules, calendarReady: false })).toBe("blocked");
    expect(classifyServiceDate("2027-01-04", { ...rules, context: { ...rules.context, startDate: null, endDate: null } })).toBe("blocked");
    const enabled = { ...rules, calendar: calendar.withServiceDays({ saturday: true, sunday: true, holiday: true }) };
    for (const date of ["2026-11-07", "2026-11-08", "2026-11-09"]) expect(classifyServiceDate(date, enabled)).toBe("available");
});

it("uses nearest stored rows, including drafts, for both order bounds", () => {
    const rules = props({ day: 3, context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-02", locked: true },
        { sessionIndex: 2, serviceDate: "2026-11-04", locked: false },
        { sessionIndex: 4, serviceDate: "2026-11-11", locked: false },
    ] } });
    expect(classifyServiceDate("2026-11-03", rules)).toBe("before");
    expect(classifyServiceDate("2026-11-04", rules)).toBe("before");
    expect(classifyServiceDate("2026-11-05", rules)).toBe("available");
    expect(classifyServiceDate("2026-11-11", rules)).toBe("after");
    expect(classifyServiceDate("2026-11-12", rules)).toBe("after");
});

it("shows 현재 and other session labels, refuses order clicks with the exact feedback, and selects a different day", () => {
    const p = props({ day: 2, editing: true, value: "2026-11-04", context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-02", locked: true },
        { sessionIndex: 2, serviceDate: "2026-11-04", locked: true },
        { sessionIndex: 3, serviceDate: "2026-11-11", locked: true },
    ] } });
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByText("현재 2026.11.04(수)")).toBeInTheDocument();
    const select = screen.getByRole("button", { name: "선택" });
    expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.11.04(수) 현재" }));
    expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.11.02(월) 1회차" }));
    expect(p.onOrderBlocked).toHaveBeenLastCalledWith(ORDER_BEFORE);
    expect(screen.getByRole("button", { name: "2026.11.11(수) 3회차" }).querySelector("small")).not.toHaveClass("text-v3-primary");
    fireEvent.click(screen.getByRole("button", { name: "2026.11.11(수) 3회차" }));
    expect(p.onOrderBlocked).toHaveBeenLastCalledWith(ORDER_AFTER);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.07(토)" }));
    expect(select).toBeDisabled();
    expect(p.onOrderBlocked).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.05(목)" }));
    expect(select).toBeEnabled();
    fireEvent.click(select);
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(p.onSelect).toHaveBeenCalledWith("2026-11-05");
});

it("closes once from the header without applying a selection", () => {
    const p = props();
    render(<ServiceDateSheet {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSelect).not.toHaveBeenCalled();
});

it("limits month navigation to window months and cancels without applying a selection", () => {
    const p = props();
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "다음 달 12월" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "이전 달 10월" }));
    expect(screen.getByRole("button", { name: "이전 달 9월" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.10.26(월)" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSelect).not.toHaveBeenCalled();
});

it("opens with the pending pick selected and lets it return to the stored 현재 day", () => {
    const p = props({ editing: true, value: "2026-11-05", context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-04", locked: true },
    ] } });
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "2026.11.05(목)" })).toHaveAttribute("aria-pressed", "true");
    const current = screen.getByRole("button", { name: "2026.11.04(수) 현재" });
    expect(current).toHaveClass("border-dashed");
    expect(current).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(current);
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "선택" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(p.onSelect).toHaveBeenCalledWith("2026-11-04");
});

it("does not preselect a new empty day's initial calendar date", () => {
    render(<ServiceDateSheet {...props()} />);
    expect(screen.getByRole("button", { name: "2026.11.02(월)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});

it("enlarges the date sheet title, calendar, annotations and actions one step", () => {
    render(<ServiceDateSheet {...props({ value: "2026-11-02", context: { ...props().context, sessions: [{ sessionIndex: 1, serviceDate: "2026-11-02", locked: true }] } })} />);
    expect(screen.getByRole("heading", { name: "1회차 서비스 제공일" })).toHaveClass("text-2xl");
    expect(screen.getByText("날짜를 골라 주세요.")).toHaveClass("text-sm");
    expect(screen.getByText("2026년 11월")).toHaveClass("text-base");
    const stored = screen.getByRole("button", { name: "2026.11.02(월)" });
    expect(stored).toHaveClass("min-h-11", "text-base", "leading-none");
    expect(stored.querySelector("small")).toBeNull();
    expect(screen.getByRole("button", { name: "2026.11.11(수) 오늘" }).querySelector("small")).toHaveClass("text-xs", "leading-none", "text-v3-primary");
    expect(document.querySelector('[data-component$="_calendar"]')).toHaveClass("flex", "flex-col", "min-h-0", "flex-1", "overflow-y-auto");
    expect(document.querySelector('[data-component$="_calendar_days"]')).toHaveClass("grid", "grid-cols-7", "flex-1", "auto-rows-[minmax(2.75rem,1fr)]");
    expect(screen.getByRole("button", { name: "취소" })).toHaveClass("text-base");
    expect(screen.getByRole("button", { name: "선택" })).toHaveClass("text-base");
});

it("caps February 2026 at exactly four rows", () => {
    const context = { ...props().context, startDate: "2026-02-10", endDate: "2026-02-20" };
    render(<ServiceDateSheet {...props({ context, value: "2026-02-10" })} />);
    expect(screen.getByText("2026년 2월")).toBeInTheDocument();
    const grid = document.querySelector('[data-component$="_calendar_days"]');
    // February 2026 starts on Sunday and has 28 days, filling exactly four rows.
    expect(grid).toHaveStyle({ maxHeight: "calc(4 * 4.5rem + 3 * 0.25rem)" });
});

it("updates the row height cap for five- and six-row months when navigating", () => {
    const context = { ...props().context, startDate: "2026-08-01" };
    render(<ServiceDateSheet {...props({ context })} />);
    const grid = document.querySelector('[data-component$="_calendar_days"]');
    expect(screen.getByText("2026년 11월")).toBeInTheDocument();
    // November starts on Sunday with 30 days; August starts on Saturday with 31.
    expect(grid).toHaveClass("flex-1", "auto-rows-[minmax(2.75rem,1fr)]");
    expect(grid).not.toHaveClass("min-h-0");
    expect(grid).toHaveStyle({ maxHeight: "calc(5 * 4.5rem + 4 * 0.25rem)" });
    for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: /^이전 달/ }));
    expect(screen.getByText("2026년 8월")).toBeInTheDocument();
    expect(grid).toHaveStyle({ maxHeight: "calc(6 * 4.5rem + 5 * 0.25rem)" });
    for (let index = 0; index < 3; index++) fireEvent.click(screen.getByRole("button", { name: /^다음 달/ }));
    expect(screen.getByText("2026년 11월")).toBeInTheDocument();
    expect(grid).toHaveStyle({ maxHeight: "calc(5 * 4.5rem + 4 * 0.25rem)" });
});


it("hatches a gap day, explains it on tap, and leaves the next service day available", () => {
    const p = props({ day: 3, context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-02", locked: true },
        { sessionIndex: 4, serviceDate: "2026-11-05", locked: true },
    ] } });
    render(<ServiceDateSheet {...p} />);
    const gap = screen.getByRole("button", { name: "2026.11.03(화)" });
    expect(gap).toHaveAttribute("data-day-state", "gap");
    expect(gap).toHaveAttribute("aria-disabled", "true");
    expect(gap.className).toContain("bg-[repeating-linear-gradient");
    fireEvent.click(gap);
    expect(p.onOrderBlocked).toHaveBeenCalledWith(GAP_ROOM);
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026.11.04(수)" })).toHaveAttribute("data-day-state", "available");
});

it("reserves leading gaps inside the window after applying ordinary blocked rules", () => {
    const rules = props({ day: 2, context: { ...props().context, sessions: [
        { sessionIndex: 3, serviceDate: "2026-11-04", locked: true },
    ] } });
    expect(classifyServiceDate("2026-10-26", rules)).toBe("gap");
    expect(classifyServiceDate("2026-10-27", rules)).toBe("available");
    expect(classifyServiceDate("2026-10-23", rules)).toBe("blocked");
});

it("reserves a service day for an empty upper session", () => {
    const rules = props({ day: 2, context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-02", locked: true },
        { sessionIndex: 4, serviceDate: "2026-11-05", locked: true },
    ] } });
    expect(classifyServiceDate("2026-11-04", rules)).toBe("gap");
    expect(classifyServiceDate("2026-11-03", rules)).toBe("available");
});
