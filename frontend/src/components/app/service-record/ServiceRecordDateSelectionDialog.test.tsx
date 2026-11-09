import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import {
    getBusinessDayOptions,
    getInitialServiceRecordDateSelection,
    getSupportedKoreanBusinessYears,
    isSelectableServiceRecordDate,
    ServiceRecordDateSelectionDialog,
} from "./ServiceRecordDateSelectionDialog";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

const DATA_COMPONENT = "desktop_service-record-admin_date-selection-dialog";

function renderDialog(
    overrides: Partial<React.ComponentProps<typeof ServiceRecordDateSelectionDialog>> = {},
) {
    const props: React.ComponentProps<typeof ServiceRecordDateSelectionDialog> = {
        open: true,
        onOpenChange: jest.fn(),
        currentServiceDate: "2026-07-16",
        calendar: KR_BUILTIN_CALENDAR,
        sessionLabel: "3회차",
        onApply: jest.fn(),
        ...overrides,
    };

    return { ...render(<ServiceRecordDateSelectionDialog {...props} />), props };
}

function chooseOption(label: string, optionName: string) {
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("ServiceRecordDateSelectionDialog", () => {
    it("uses the approved mobile sheet layout without preview or save guidance", () => {
        renderDialog();
        const dialog = screen.getByRole("dialog", { name: "3회차 서비스 제공일 수정" });
        expect(dialog).toHaveClass("max-sm:bottom-0", "max-sm:w-full", "max-sm:translate-y-0");
        expect(screen.getByText("현재 2026년 7월 16일")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "일" })).toHaveClass("h-[54px]", "w-full");
        expect(dialog.querySelector('[data-slot="dialog-footer"]')).toHaveClass("grid", "grid-cols-[1fr_2fr]");
        expect(dialog.querySelector('[data-slot="preview"]')).toBeNull();
        expect(dialog.querySelector('[data-slot="notice"]')).toBeNull();
    });
    it("derives supported years from the shared calendar and filters weekends and holidays", () => {
        const years = getSupportedKoreanBusinessYears(KR_BUILTIN_CALENDAR);
        const julyOptions = getBusinessDayOptions(2026, 7, KR_BUILTIN_CALENDAR);

        expect(years).toEqual([...years].sort((left, right) => left - right));
        expect(years.length).toBeGreaterThan(1);
        expect(julyOptions.map((option) => option.value)).toContain("16");
        expect(julyOptions.map((option) => option.value)).not.toEqual(
            expect.arrayContaining(["17", "18", "19"]),
        );
        expect(isSelectableServiceRecordDate("2026-07-17", KR_BUILTIN_CALENDAR)).toBe(false);
        expect(isSelectableServiceRecordDate("2026-07-18", KR_BUILTIN_CALENDAR)).toBe(false);
        expect(isSelectableServiceRecordDate("2026-07-16", KR_BUILTIN_CALENDAR)).toBe(true);
    });

    it("blocks malformed and unsupported initial dates without guessing a fallback", () => {
        const years = getSupportedKoreanBusinessYears(KR_BUILTIN_CALENDAR);
        const unsupportedDate = `${Math.max(...years) + 1}-01-02`;

        expect(getInitialServiceRecordDateSelection("2026-02-30", KR_BUILTIN_CALENDAR)).toEqual({
            parts: null,
            reason: "malformed",
        });
        expect(getInitialServiceRecordDateSelection(unsupportedDate, KR_BUILTIN_CALENDAR)).toEqual({
            parts: null,
            reason: "unsupported-year",
        });

        const { rerender } = renderDialog({ currentServiceDate: "2026-02-30" });
        expect(screen.getByRole("alert")).toHaveTextContent("형식이 올바르지 않아");
        expect(screen.queryByRole("combobox", { name: "연도" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();

        rerender(
            <ServiceRecordDateSelectionDialog
                open
                onOpenChange={jest.fn()}
                currentServiceDate={unsupportedDate}
                calendar={KR_BUILTIN_CALENDAR}
                sessionLabel="3회차"
                onApply={jest.fn()}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent("지원하지 않는 달력");
        expect(screen.queryByRole("combobox", { name: "연도" })).not.toBeInTheDocument();
    });

    it("omits days outside the inclusive window from the helper and rendered options", () => {
        const windowStart = "2026-07-14";
        const windowEnd = "2026-07-16";
        expect(getBusinessDayOptions(2026, 7, KR_BUILTIN_CALENDAR, windowStart, windowEnd).map((option) => option.value))
            .toEqual(["14", "15", "16"]);
        expect(isSelectableServiceRecordDate("2026-07-13", KR_BUILTIN_CALENDAR, windowStart, windowEnd)).toBe(false);
        expect(isSelectableServiceRecordDate("2026-07-20", KR_BUILTIN_CALENDAR, windowStart, windowEnd)).toBe(false);
        expect(getInitialServiceRecordDateSelection("2026-07-13", KR_BUILTIN_CALENDAR, windowStart, windowEnd))
            .toEqual({ parts: { year: 2026, month: 7, day: null }, reason: null });
        expect(getInitialServiceRecordDateSelection(windowStart, KR_BUILTIN_CALENDAR, windowStart, windowEnd).reason).toBeNull();
        expect(isSelectableServiceRecordDate(windowEnd, KR_BUILTIN_CALENDAR, windowStart, windowEnd)).toBe(true);

        renderDialog({ windowStart, windowEnd });
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        expect(screen.queryByRole("option", { name: "13일" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "20일" })).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "14일" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "16일" })).toBeInTheDocument();
    });

    it("treats each null window bound as unbounded", () => {
        expect(isSelectableServiceRecordDate("2026-07-13", KR_BUILTIN_CALENDAR, null, "2026-07-16")).toBe(true);
        expect(isSelectableServiceRecordDate("2026-07-20", KR_BUILTIN_CALENDAR, "2026-07-14", null)).toBe(true);
    });

    it.each([
        {
            position: "after",
            currentServiceDate: "2026-09-14",
            currentDateLabel: "현재 2026년 9월 14일",
            month: "8월",
            allowedDay: "7일",
            excludedDay: "10일",
            expectedDate: "2026-08-07",
        },
        {
            position: "before",
            currentServiceDate: "2026-06-15",
            currentDateLabel: "현재 2026년 6월 15일",
            month: "7월",
            allowedDay: "6일",
            excludedDay: "3일",
            expectedDate: "2026-07-06",
        },
    ])("allows moving a session $position the window from the nearest edge month", ({
        currentServiceDate, currentDateLabel, month, allowedDay, excludedDay, expectedDate,
    }) => {
        const { props } = renderDialog({
            currentServiceDate,
            windowStart: "2026-07-06",
            windowEnd: "2026-08-07",
        });

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByText(currentDateLabel)).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "연도" })).toHaveTextContent("2026년");
        expect(screen.getByRole("combobox", { name: "월" })).toHaveTextContent(month);
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent(/^일$/);
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();

        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        expect(screen.getByRole("option", { name: allowedDay })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: excludedDay })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("option", { name: allowedDay }));
        expect(screen.getByRole("button", { name: "수정" })).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "수정" }));
        expect(props.onApply).toHaveBeenCalledTimes(1);
        expect(props.onApply).toHaveBeenCalledWith(expectedDate);
    });

    it.each([
        { selectedServiceDate: "2026-09-14", month: "8월", day: "7일", expectedDate: "2026-08-07" },
        { selectedServiceDate: "2026-07-18", month: "7월", day: "16일", expectedDate: "2026-07-16" },
    ])("allows replacing an unselectable retained source date $selectedServiceDate", ({
        selectedServiceDate, month, day, expectedDate,
    }) => {
        const { props } = renderDialog({
            currentServiceDate: "2026-07-13",
            selectedServiceDate,
            windowStart: "2026-07-06",
            windowEnd: "2026-08-07",
        });

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByText("현재 2026년 7월 13일")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "월" })).toHaveTextContent(month);
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent(/^일$/);
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();
        chooseOption("일", day);
        fireEvent.click(screen.getByRole("button", { name: "수정" }));
        expect(props.onApply).toHaveBeenCalledTimes(1);
        expect(props.onApply).toHaveBeenCalledWith(expectedDate);
    });

    it("refuses a retained provisional date at apply time if the window has narrowed", () => {
        const { rerender, props } = renderDialog({ windowStart: "2026-07-13", windowEnd: "2026-07-20" });
        chooseOption("일", "14일");
        rerender(<ServiceRecordDateSelectionDialog {...props} windowStart="2026-07-15" />);
        fireEvent.click(screen.getByRole("button", { name: "수정" }));
        expect(props.onApply).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("고를 수 있는 기간이 아니에요.");
    });

    it("does not apply a provisional choice when cancelled", () => {
        const onApply = jest.fn();
        const onOpenChange = jest.fn();
        renderDialog({ onApply, onOpenChange });

        chooseOption("일", "15일");
        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(onApply).not.toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("sends the selected ISO date only after explicit apply", () => {
        const onApply = jest.fn();
        const onOpenChange = jest.fn();
        renderDialog({ onApply, onOpenChange });

        chooseOption("일", "15일");
        expect(onApply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "수정" }));

        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenCalledWith("2026-07-15");
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("retains an explicitly controlled pending date after a failed save", () => {
        const onApply = jest.fn();
        const onReloadLatest = jest.fn();
        renderDialog({
            currentServiceDate: "2026-07-13",
            selectedServiceDate: "2026-07-15",
            error: "제공일을 저장하지 못했습니다.",
            onApply,
            onReloadLatest,
        });

        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("15일");
        expect(screen.queryByText(/적용 예정일/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "수정" }));
        expect(onApply).toHaveBeenCalledWith("2026-07-15");
        fireEvent.click(screen.getByRole("button", { name: "최신 초안 불러오기" }));
        expect(onReloadLatest).toHaveBeenCalledTimes(1);
    });

    it("clears the provisional day whenever year or month changes", () => {
        const onApply = jest.fn();
        renderDialog({ onApply });

        chooseOption("월", "8월");
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("일");
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();

        chooseOption("일", "3일");
        chooseOption("연도", "2025년");
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("일");
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();

        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        expect(screen.queryByRole("option", { name: "17일" })).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "1일" })).toBeInTheDocument();
    });

    it("disables all date actions while busy and refuses dismissal", () => {
        const onApply = jest.fn();
        const onOpenChange = jest.fn();
        renderDialog({ busy: true, onApply, onOpenChange });

        expect(screen.getByRole("button", { name: "적용 중…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
        expect(screen.getByRole("combobox", { name: "연도" })).toBeDisabled();

        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
        expect(onApply).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("keeps the dialog root and child slots under the caller data-component path", () => {
        renderDialog({ "data-component": DATA_COMPONENT });

        expect(document.querySelector(`[data-component="${DATA_COMPONENT}"]`)).toHaveAttribute(
            "data-source-component",
            "FormDialogShell",
        );
        expect(document.querySelector(`[data-component="${DATA_COMPONENT}_content_date-form"]`)).toHaveAttribute(
            "data-source-component",
            "ServiceRecordDateSelectionDialog",
        );
        expect(document.querySelector(`[data-component="${DATA_COMPONENT}_content_date-form_controls"]`)).toHaveAttribute(
            "data-slot",
            "date-controls",
        );
    });

    it("treats a branch-added holiday as a non-business day and drops it from the day options", () => {
        const branchCalendar = createKrBusinessDayCalendar(["2026-07-15"], {
            version: "kr-db-test",
            supportedYears: [2025, 2026, 2027],
        });
        expect(isSelectableServiceRecordDate("2026-07-15", KR_BUILTIN_CALENDAR)).toBe(true);
        expect(isSelectableServiceRecordDate("2026-07-15", branchCalendar)).toBe(false);
        expect(getBusinessDayOptions(2026, 7, branchCalendar).map((option) => option.value)).not.toContain("15");

        const { props } = renderDialog({ calendar: branchCalendar, currentServiceDate: "2026-07-15" });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByText("현재 2026년 7월 15일")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "연도" })).toHaveTextContent("2026년");
        expect(screen.getByRole("combobox", { name: "월" })).toHaveTextContent("7월");
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent(/^일$/);
        expect(screen.getByRole("button", { name: "수정" })).toBeDisabled();

        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        expect(screen.queryByRole("option", { name: "15일" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("option", { name: "16일" }));
        expect(screen.getByRole("button", { name: "수정" })).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "수정" }));
        expect(props.onApply).toHaveBeenCalledTimes(1);
        expect(props.onApply).toHaveBeenCalledWith("2026-07-16");
    });

    it("offers only the years the branch calendar covers and blocks a date outside them", () => {
        const branchCalendar = createKrBusinessDayCalendar(["2026-07-15"], {
            version: "kr-db-test",
            supportedYears: [2026],
        });
        expect(getSupportedKoreanBusinessYears(branchCalendar)).toEqual([2026]);
        expect(getInitialServiceRecordDateSelection("2025-07-16", branchCalendar)).toEqual({
            parts: null,
            reason: "unsupported-year",
        });
    });

    it("offers Saturday only on a calendar wrapped with the client's Saturday service", () => {
        const saturdayCalendar = KR_BUILTIN_CALENDAR.withServiceDays({ saturday: true, sunday: false, holiday: false });
        expect(isSelectableServiceRecordDate("2026-12-19", KR_BUILTIN_CALENDAR)).toBe(false);
        expect(isSelectableServiceRecordDate("2026-12-19", saturdayCalendar)).toBe(true);
        // Sunday stays closed: only the toggles the client has are opened.
        expect(isSelectableServiceRecordDate("2026-12-20", saturdayCalendar)).toBe(false);
        expect(getBusinessDayOptions(2026, 12, KR_BUILTIN_CALENDAR).map((option) => option.value)).not.toContain("19");
        expect(getBusinessDayOptions(2026, 12, saturdayCalendar).map((option) => option.value)).toContain("19");

        renderDialog({ calendar: saturdayCalendar, currentServiceDate: "2026-12-18" });
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        expect(screen.getByRole("option", { name: "19일" })).toBeInTheDocument();
    });
});
