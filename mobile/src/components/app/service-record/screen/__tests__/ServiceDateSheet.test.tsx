import { fireEvent, render, screen } from "@testing-library/react";
import { createKrBusinessDayCalendar } from "@/lib/date/business-days";
import { ServiceDateSheet, classifyServiceDate, ORDER_AFTER, ORDER_BEFORE } from "../ServiceDateSheet";
import type { ServiceDateSheetProps } from "../ServiceDateSheet";

const calendar = createKrBusinessDayCalendar(["2026-11-09"], { supportedYears: [2026] });
const props = (overrides: Partial<ServiceDateSheetProps> = {}): ServiceDateSheetProps => ({
    "data-component": "mobile_service-record_wizard_service-date-sheet",
    context: { totalSessions: 4, startDate: "2026-11-02", endDate: "2026-11-17", header: {}, sessions: [] },
    day: 1, value: "", editing: false, calendar, calendarReady: true,
    onClose: jest.fn(), onSelect: jest.fn(), onOrderBlocked: jest.fn(), ...overrides,
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

it("shows 지금 and other session labels, refuses order clicks with the exact feedback, and selects a different day", () => {
    const p = props({ day: 2, editing: true, value: "2026-11-04", context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-02", locked: true },
        { sessionIndex: 2, serviceDate: "2026-11-04", locked: true },
        { sessionIndex: 3, serviceDate: "2026-11-11", locked: true },
    ] } });
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByText("지금 2026.11.04(수)")).toBeInTheDocument();
    const select = screen.getByRole("button", { name: "선택" });
    expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.11.04(수) 지금" }));
    expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.11.02(월) 1회차" }));
    expect(p.onOrderBlocked).toHaveBeenLastCalledWith(ORDER_BEFORE);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.11(수) 3회차" }));
    expect(p.onOrderBlocked).toHaveBeenLastCalledWith(ORDER_AFTER);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.07(토)" }));
    expect(select).toBeDisabled();
    expect(p.onOrderBlocked).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.05(목)" }));
    expect(select).toBeEnabled();
    fireEvent.click(select);
    expect(p.onSelect).toHaveBeenCalledWith("2026-11-05");
});

it("limits month navigation to window months and cancels without applying a selection", () => {
    const p = props();
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2026.10.26(월)" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSelect).not.toHaveBeenCalled();
});

it("opens with the pending pick selected and lets it return to the stored 지금 day", () => {
    const p = props({ editing: true, value: "2026-11-05", context: { ...props().context, sessions: [
        { sessionIndex: 1, serviceDate: "2026-11-04", locked: true },
    ] } });
    render(<ServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "2026.11.05(목)" })).toHaveAttribute("aria-pressed", "true");
    const current = screen.getByRole("button", { name: "2026.11.04(수) 지금" });
    expect(current).toHaveClass("border-dashed");
    expect(current).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(current);
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "선택" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(p.onSelect).toHaveBeenCalledWith("2026-11-04");
});

it("does not preselect a new empty day's initial calendar date", () => {
    render(<ServiceDateSheet {...props()} />);
    expect(screen.getByRole("button", { name: "2026.11.02(월)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});
