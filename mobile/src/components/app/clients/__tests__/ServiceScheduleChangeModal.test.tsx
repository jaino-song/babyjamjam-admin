import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useBusinessDayCalendar, type UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import { ServiceScheduleChangeModal } from "../ServiceScheduleChangeModal";

jest.mock("@/hooks/useBusinessDayCalendar");

const slotOf = (field: HTMLElement) =>
    document.getElementById(field.getAttribute("aria-describedby") ?? "") as HTMLElement;

beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
});

describe("ServiceScheduleChangeModal", () => {
    const defaultProps = {
        "data-component": "mobile_clients_detail-sheet_stack_detail-page_content_schedule-change-modal",
        open: true,
        sessionIndex: 3,
        currentDate: "2026-07-20",
        minimumDate: "2026-07-20",
        selectedDate: "2026-07-20",
        isPending: false,
        onDateChange: jest.fn(),
        onClose: jest.fn(),
        onSubmit: jest.fn(),
    };

    it("types the date as text digits with an example placeholder", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} />);

        expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toBeInTheDocument();
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("type", "text");
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("inputmode", "numeric");
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("placeholder", "2026-12-01");
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("maxlength", "10");
    });

    it("shows the date rule as guidance on first load, even while the prefilled date is not yet a postponement", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} />);

        const input = screen.getByLabelText("3회차 서비스 제공 날짜");
        expect(slotOf(input)).toHaveTextContent("출산일 이후만 가능해요");
        expect(slotOf(input)).toHaveAttribute("aria-live", "polite");
        expect(input).not.toHaveAttribute("aria-invalid", "true");
    });

    it("replaces the date guidance with the error and restores it once the date is valid", () => {
        const { rerender } = render(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-07" />);
        const input = screen.getByLabelText("3회차 서비스 제공 날짜");

        fireEvent.focus(input);
        fireEvent.blur(input);
        expect(slotOf(input)).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
        expect(slotOf(input)).not.toHaveTextContent("출산일 이후만 가능해요");

        rerender(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-12-01" />);
        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("출산일 이후만 가능해요");
    });

    it("hints while the date is incomplete and errors once the field is left", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-07" />);
        const input = screen.getByLabelText("3회차 서비스 제공 날짜");

        fireEvent.focus(input);
        expect(slotOf(input)).toHaveTextContent("YYYY-MM-DD 형식");
        expect(slotOf(input)).not.toHaveTextContent("입력해 주세요");

        fireEvent.blur(input);
        expect(slotOf(input)).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
        expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("says so in the slot when the typed date is before the earliest allowed date", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-07-19" />);
        const input = screen.getByLabelText("3회차 서비스 제공 날짜");

        fireEvent.blur(input);

        expect(slotOf(input)).toHaveTextContent("2026-07-20 이후로 입력해 주세요");
        expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("reports a date that does not exist", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-02-30" />);

        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("존재하지 않는 날짜예요");
    });

    it("keeps the button pressable; pressing it with a problem shows the message and does not submit", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...defaultProps} onSubmit={onSubmit} />);

        await user.click(screen.getByRole("button", { name: "일정 변경" }));

        const input = screen.getByLabelText("3회차 서비스 제공 날짜");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(slotOf(input)).toHaveTextContent("현재 예정일과 다른 날짜를 입력해 주세요");
        expect(input).toHaveFocus();
    });

    it("calls a cleared prefilled date required", () => {
        const { rerender } = render(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2026-07-25" />);
        rerender(<ServiceScheduleChangeModal {...defaultProps} selectedDate="" />);

        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("서비스 제공 날짜를 입력해 주세요");
    });

    it("formats a typed date without opening a native date picker", () => {
        const onDateChange = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                selectedDate=""
                onDateChange={onDateChange}
            />,
        );

        fireEvent.change(screen.getByLabelText("3회차 서비스 제공 날짜"), {
            target: { value: "20260722" },
        });

        expect(onDateChange).toHaveBeenCalledWith("2026-07-22");
    });

    it("submits a postponed date", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                selectedDate="2026-07-21"
                onSubmit={onSubmit}
            />,
        );

        await user.click(screen.getByRole("button", { name: "일정 변경" }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(false);
    });

    it("asks before moving a session onto a weekend and submits only once confirmed", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                minimumDate="2026-07-17"
                selectedDate="2026-07-19"
                onSubmit={onSubmit}
            />,
        );

        await user.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText("주말·공휴일이에요")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
        expect(onSubmit).toHaveBeenCalledWith(true);
    });

    it("submits a date earlier than the current service date when it is not before the birth date", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                currentDate="2026-10-05"
                minimumDate="2026-09-20"
                selectedDate="2026-09-28"
                onSubmit={onSubmit}
            />,
        );

        await user.click(screen.getByRole("button", { name: "일정 변경" }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});

describe("branch calendar readiness", () => {
    const mockedCalendar = useBusinessDayCalendar as jest.MockedFunction<typeof useBusinessDayCalendar>;
    const retry = jest.fn();
    const result = (overrides: Partial<UseBusinessDayCalendarResult>): UseBusinessDayCalendarResult => ({
        calendar: KR_BUILTIN_CALENDAR,
        ready: true,
        error: null,
        retry,
        version: KR_BUILTIN_CALENDAR.version,
        ...overrides,
    });
    // The branch added Wednesday 2026-07-22 as its own holiday; the built-in list does not know it.
    const branchCalendar = createKrBusinessDayCalendar(["2026-07-22"], {
        supportedYears: [2026, 2031],
        version: "branch",
    });
    const notReady = result({ ready: false, error: null });
    const baseProps = {
        "data-component": "mobile_clients_detail-sheet_stack_detail-page_content_schedule-change-modal",
        open: true,
        sessionIndex: 3,
        currentDate: "2026-07-20",
        minimumDate: "2026-07-17",
        selectedDate: "2026-07-22",
        isPending: false,
        onDateChange: jest.fn(),
        onClose: jest.fn(),
    };

    beforeEach(() => retry.mockClear());
    afterEach(() => mockedCalendar.mockImplementation(() => result({})));

    it("does not classify the date or submit while the calendar is loading, then asks once it is ready", () => {
        mockedCalendar.mockImplementation(() => notReady);
        const onSubmit = jest.fn();
        const { rerender } = render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        const approve = screen.getByRole("button", { name: "일정 변경" });
        expect(approve).toBeDisabled();
        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("공휴일 정보를 불러오는 중이에요");
        fireEvent.click(approve);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.queryByText("주말·공휴일이에요")).not.toBeInTheDocument();

        mockedCalendar.mockImplementation(() => result({ calendar: branchCalendar }));
        rerender(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText("주말·공휴일이에요")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
        expect(onSubmit).toHaveBeenCalledWith(true);
    });

    it("does not throw for a year outside the built-in range while the calendar is not ready", () => {
        mockedCalendar.mockImplementation(() => notReady);
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} selectedDate="2031-07-22" onSubmit={onSubmit} />);

        expect(() => fireEvent.click(screen.getByRole("button", { name: "일정 변경" }))).not.toThrow();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("blocks a date in a year the ready calendar has no data for instead of throwing", () => {
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} selectedDate="2031-07-22" onSubmit={onSubmit} />);

        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("이 날짜의 공휴일 정보가 아직 없어요");
        expect(() => fireEvent.click(screen.getByRole("button", { name: "일정 변경" }))).not.toThrow();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows the load failure in the slot with a retry and keeps approval blocked", () => {
        mockedCalendar.mockImplementation(() => result({ ready: false, error: "load-failed" }));
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        expect(slotOf(screen.getByLabelText("3회차 서비스 제공 날짜"))).toHaveTextContent("공휴일 정보를 불러오지 못했어요");
        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
