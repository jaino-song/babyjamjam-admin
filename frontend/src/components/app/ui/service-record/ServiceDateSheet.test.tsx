import { fireEvent, render, screen } from "@testing-library/react";

import { createKrBusinessDayCalendar } from "@/lib/date/business-days";
import { AdminServiceDateSheet, isSelectableServiceRecordDate, type AdminServiceDateSheetProps } from "./ServiceDateSheet";

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-11T03:00:00Z"));
});
afterEach(() => { jest.useRealTimers(); });

const calendar = createKrBusinessDayCalendar(["2026-11-09"], { supportedYears: [2026] });
const hatch = "bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)]";
const props = (overrides: Partial<AdminServiceDateSheetProps> = {}): AdminServiceDateSheetProps => ({
    "data-component": "desktop_service-record-admin_wizard_date-selection-dialog",
    open: true, onOpenChange: jest.fn(), currentServiceDate: "2026-11-11", sessionLabel: "3회차",
    calendar, windowStart: "2026-10-26", windowEnd: "2026-11-24",
    startDate: "2026-11-02", endDate: "2026-11-17",
    otherSessions: [{ sessionIndex: 1, serviceDate: "2026-11-02" }, { sessionIndex: 4, serviceDate: "2026-11-12" }],
    onApply: jest.fn(), ...overrides,
});

it("renders the caregiver copy, three legend items and actual service period", () => {
    render(<AdminServiceDateSheet {...props()} />);
    const sheet = screen.getByRole("dialog", { name: "3회차 서비스 제공일 수정" });
    expect(sheet).toHaveAttribute("data-source-component", "AdminServiceDateSheet");
    expect(sheet).toHaveAttribute("data-side", "bottom");
    expect(sheet).toHaveClass("data-[state=open]:slide-in-from-bottom", "sm:left-1/2");
    expect(screen.getByText("새로운 날짜를 선택해 주세요.")).toBeVisible();
    expect(screen.getByText("서비스 기간: 11.02(월) ~ 11.17(화)")).toBeVisible();
    for (const label of ["선택한 날", "선택 가능", "선택 불가"]) expect(screen.getByText(label)).toBeVisible();
    expect(sheet.querySelector('[data-slot="legend"]')?.children).toHaveLength(3);
    expect(screen.getByRole("button", { name: "2026.11.11(수) 현재" })).toHaveClass("border-dashed");
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});

it.each([
    { currentServiceDate: "2026-11-10", name: "2026.11.10(화) 현재" },
    { currentServiceDate: "2026-11-11", name: "2026.11.11(수) 현재" },
])("labels the stored date $currentServiceDate as 현재 and never labels today", ({ currentServiceDate, name }) => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate })} />);
    const current = screen.getByRole("button", { name });
    expect(current).toHaveAttribute("data-day-state", "current");
    expect(current).toHaveClass("border-dashed", "border-v3-primary!", "text-v3-primary");
    expect(current.querySelector("small")).toHaveTextContent(/^현재$/);
    expect(screen.queryByText("오늘")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: / 오늘$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("지금")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: / 지금$/ })).not.toBeInTheDocument();
});

it.each(["", "invalid", "2026-02-30"])("labels today without a valid stored date (%j)", (currentServiceDate) => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate })} />);
    const today = screen.getByRole("button", { name: "2026.11.11(수) 오늘" });
    const annotation = screen.getByText("오늘");
    expect(annotation).toHaveAttribute("data-component", `${props()["data-component"]}_calendar_days_day-11_annotation`);
    expect(annotation).toHaveClass("text-v3-primary", "text-[calc(12px*var(--glint-ui-scale,1))]");
    expect(today).toHaveAttribute("data-day-state", "available");
    expect(today).toBeEnabled();
    expect(today).toHaveClass("bg-white", "text-v3-dark", "border-[1.5px]", "border-v3-primary!");
    expect(today).not.toHaveClass("border-dashed");
    expect(today).not.toHaveClass(hatch);
    expect(screen.queryByText(/^(현재|지금)$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: / (현재|지금)$/ })).not.toBeInTheDocument();
});

it("lets the 오늘 annotation inherit white text when today is selected", () => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate: "" })} />);
    const today = screen.getByRole("button", { name: "2026.11.11(수) 오늘" });
    const annotation = screen.getByText("오늘");
    expect(annotation).toHaveClass("text-v3-primary");
    fireEvent.click(today);
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveClass("bg-v3-primary", "text-white");
    expect(annotation).not.toHaveClass("text-v3-primary");
    fireEvent.click(screen.getByRole("button", { name: "2026.11.10(화)" }));
    expect(today).toHaveAttribute("aria-pressed", "false");
    expect(annotation).toHaveClass("text-v3-primary");
});

it("gives another session's annotation precedence over 오늘 without primary text", () => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate: "", otherSessions: [{ sessionIndex: 5, serviceDate: "2026-11-11" }] })} />);
    const today = screen.getByRole("button", { name: "2026.11.11(수) 5회차" });
    const annotation = screen.getByText("5회차");
    expect(today).not.toHaveClass("text-v3-primary");
    expect(annotation).not.toHaveClass("text-v3-primary");
    expect(screen.queryByText(/^(오늘|현재|지금)$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: / (오늘|현재|지금)$/ })).not.toBeInTheDocument();
    expect(today).toBeEnabled();
    fireEvent.click(today);
    expect(today).toHaveClass("bg-v3-primary", "text-white");
    expect(annotation).not.toHaveClass("text-v3-primary");
});

it.each([
    { iso: "2026-11-07", name: "2026.11.07(토) 오늘" },
    { iso: "2026-11-09", name: "2026.11.09(월) 오늘" },
    { iso: "2026-11-25", name: "2026.11.25(수) 오늘" },
])("preserves the blocked date state when today is $iso", ({ iso, name }) => {
    jest.setSystemTime(new Date(`${iso}T03:00:00Z`));
    render(<AdminServiceDateSheet {...props({ currentServiceDate: "" })} />);
    const today = screen.getByRole("button", { name });
    expect(today).toBeDisabled();
    expect(today).toHaveAttribute("data-day-state", "blocked");
    expect(today).toHaveClass(hatch);
    expect(today).not.toHaveClass("border-dashed");
    expect(today).not.toHaveClass("bg-v3-primary");
    expect(screen.getByText("오늘")).toHaveClass("text-v3-primary");
});

it.each([
    // February: Sunday start + 28 days = 4 rows; June: Monday + 30 = 5; May: Friday + 31 = 6.
    { currentServiceDate: "2026-02-02", month: "2026년 2월", cap: "calc((4 * 72px + 3 * 4px) * var(--glint-ui-scale,1))" },
    { currentServiceDate: "2026-06-01", month: "2026년 6월", cap: "calc((5 * 72px + 4 * 4px) * var(--glint-ui-scale,1))" },
    { currentServiceDate: "2026-05-01", month: "2026년 5월", cap: "calc((6 * 72px + 5 * 4px) * var(--glint-ui-scale,1))" },
])("fills the available calendar height with capped rows for $month", ({ currentServiceDate, month, cap }) => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate, windowStart: null, windowEnd: null })} />);
    expect(screen.getByText(month)).toBeVisible();
    const sheet = screen.getByRole("dialog");
    const calendarContainer = sheet.querySelector('[data-slot="calendar"]');
    const days = sheet.querySelector<HTMLElement>('[data-slot="calendar-days"]');
    expect(calendarContainer).toHaveClass("flex", "flex-col", "flex-1", "min-h-0", "overflow-y-auto");
    expect(days).toHaveClass("grid", "grid-cols-7", "flex-1", "gap-[calc(4px*var(--glint-ui-scale,1))]", "auto-rows-[minmax(calc(44px*var(--glint-ui-scale,1)),1fr)]");
    expect(days).not.toHaveClass("min-h-0");
    expect(days?.style.maxHeight).toBe(cap);
    for (const day of sheet.querySelectorAll('[data-slot="calendar-day"]')) {
        expect(day).toHaveClass("text-[calc(16px*var(--glint-ui-scale,1))]");
    }
    expect(screen.getByText("현재")).toHaveClass("text-[calc(12px*var(--glint-ui-scale,1))]");
});

it.each([{ startDate: null }, { endDate: null }])("hides the period without both case bounds (%j)", (bounds) => {
    render(<AdminServiceDateSheet {...props(bounds)} />);
    expect(screen.queryByText(/^서비스 기간:/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-in-period="true"]')).toBeNull();
});

it.each(["2026.11.07(토)", "2026.11.09(월)", "2026.11.25(수)"])("hatches and disables a blocked day: %s", (name) => {
    const p = props();
    render(<AdminServiceDateSheet {...p} />);
    const cell = screen.getByRole("button", { name });
    expect(cell).toBeDisabled();
    expect(cell).toHaveClass(hatch);
    fireEvent.click(cell);
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
    expect(p.onApply).not.toHaveBeenCalled();
});

it.each(["2026.11.02(월) 1회차", "2026.11.07(토)", "2026.11.17(화)"])("outlines every in-period day including both case edges: %s", (name) => {
    render(<AdminServiceDateSheet {...props()} />);
    const cell = screen.getByRole("button", { name });
    expect(cell).toHaveAttribute("data-in-period", "true");
    expect(cell).toHaveClass("border-[1.5px]", "border-v3-primary!");
});

it("enforces both inclusive edges exactly, including a business day one day before the window", () => {
    render(<AdminServiceDateSheet {...props({ windowStart: "2026-11-03", windowEnd: "2026-11-24" })} />);
    expect(screen.getByRole("button", { name: "2026.11.02(월) 1회차" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026.11.03(화)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2026.11.24(화)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2026.11.25(수)" })).toBeDisabled();
});

it.each(["2026.11.02(월) 1회차", "2026.11.12(목) 4회차"])("keeps another session selectable regardless of order: %s", (name) => {
    const p = props();
    render(<AdminServiceDateSheet {...p} />);
    const cell = screen.getByRole("button", { name });
    expect(cell).toBeEnabled();
    expect(cell).not.toHaveClass(hatch);
    expect(cell).toHaveAttribute("data-in-period", "true");
    expect(cell).toHaveClass("border-[1.5px]", "border-v3-primary!");
    fireEvent.click(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    expect(cell).toHaveClass("bg-v3-primary", "text-white");
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(p.onApply).toHaveBeenCalledWith(name.startsWith("2026.11.02") ? "2026-11-02" : "2026-11-12");
});

it("starts at the current date's month, clamps navigation and allows the margin outside the actual period", () => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate: "2026-10-30" })} />);
    expect(screen.getByText("2026년 10월")).toBeVisible();
    expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(screen.getByText("2026년 11월")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
    const margin = screen.getByRole("button", { name: "2026.11.24(화)" });
    expect(margin).toBeEnabled();
    expect(margin).not.toHaveAttribute("data-in-period");
    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
});

it("uses the admin client's enabled service days, including Saturdays", () => {
    const saturday = calendar.withServiceDays({ saturday: true, sunday: false, holiday: false });
    render(<AdminServiceDateSheet {...props({ calendar: saturday })} />);
    expect(screen.getByRole("button", { name: "2026.11.07(토)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2026.11.08(일)" })).toBeDisabled();
});

it.each([
    { currentServiceDate: "2026-12-21", month: "2026년 11월", boundary: "다음 달", edgeDay: "2026.11.24(화)" },
    { currentServiceDate: "2026-09-21", month: "2026년 10월", boundary: "이전 달", edgeDay: "2026.10.26(월)" },
])("clamps an out-of-window current date $currentServiceDate to the edge month", ({ currentServiceDate, month, boundary, edgeDay }) => {
    render(<AdminServiceDateSheet {...props({ currentServiceDate })} />);
    expect(screen.getByText(month)).toBeVisible();
    expect(screen.getByRole("button", { name: boundary })).toBeDisabled();
    expect(screen.getByRole("button", { name: edgeDay })).toBeEnabled();
});

it("focuses the title on open, keeping initial focus inside the sheet", () => {
    render(<AdminServiceDateSheet {...props()} />);
    expect(screen.getByRole("heading", { name: "3회차 서비스 제공일 수정" })).toHaveFocus();
});

it("renders request errors as a destructive alert below the calendar", () => {
    render(<AdminServiceDateSheet {...props({ error: "회차 순서와 제공일을 확인해 주세요." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("제공일을 저장하지 못했습니다.");
    expect(screen.getByRole("alert")).toHaveTextContent("회차 순서와 제공일을 확인해 주세요.");
});

it("disables the day cells and apply when disabled, and keeps cancellation available", () => {
    const p = props({ disabled: true, selectedServiceDate: "2026-11-10" });
    render(<AdminServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "2026.11.10(화)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
});

it.each(["닫기", "취소", "Escape"])("closes without applying using %s", (action) => {
    const p = props();
    render(<AdminServiceDateSheet {...p} />);
    if (action === "Escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: action });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
    expect(p.onApply).not.toHaveBeenCalled();
});

it("discards a cancelled selection when reopened", () => {
    const p = props();
    const { rerender } = render(<AdminServiceDateSheet {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.10(화)" }));
    rerender(<AdminServiceDateSheet {...p} open={false} />);
    rerender(<AdminServiceDateSheet {...p} />);
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});

it("revalidates a selection if the window changes before applying", () => {
    const p = props();
    const { rerender } = render(<AdminServiceDateSheet {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.24(화)" }));
    rerender(<AdminServiceDateSheet {...p} windowEnd="2026-11-23" />);
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(screen.getByRole("alert")).toHaveTextContent("고를 수 있는 기간이 아니에요.");
    expect(p.onApply).not.toHaveBeenCalled();
});

it("revalidates a selection if its business day calendar changes before applying", () => {
    const p = props();
    const { rerender } = render(<AdminServiceDateSheet {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "2026.11.10(화)" }));
    rerender(<AdminServiceDateSheet {...p} calendar={createKrBusinessDayCalendar(["2026-11-10"], { supportedYears: [2026] })} />);
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(screen.getByRole("alert")).toHaveTextContent("선택한 날짜가 영업일이 아닙니다. 다시 선택해 주세요.");
    expect(p.onApply).not.toHaveBeenCalled();
});

it("rejects malformed dates, unsupported years, holidays and each bounded side", () => {
    for (const iso of ["2026-02-30", "invalid", "2027-11-02", "2026-11-09", "2026-11-07"]) {
        expect(isSelectableServiceRecordDate(iso, calendar)).toBe(false);
    }
    expect(isSelectableServiceRecordDate("2026-11-10", calendar, null, "2026-11-10")).toBe(true);
    expect(isSelectableServiceRecordDate("2026-11-10", calendar, "2026-11-10", null)).toBe(true);
    expect(isSelectableServiceRecordDate("2026-11-10", calendar, "2026-11-11", null)).toBe(false);
    expect(isSelectableServiceRecordDate("2026-11-10", calendar, null, "2026-11-09")).toBe(false);
});
