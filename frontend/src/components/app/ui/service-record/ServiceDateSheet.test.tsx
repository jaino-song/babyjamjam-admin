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
    expect(screen.getByRole("button", { name: "2026.11.11(수) 지금" })).toHaveClass("border-dashed");
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
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
