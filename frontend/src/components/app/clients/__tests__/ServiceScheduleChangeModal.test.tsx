import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useBusinessDayCalendar, type UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";
import { ServiceScheduleChangeModal } from "../ServiceScheduleChangeModal";

jest.mock("@/hooks/useBusinessDayCalendar");

describe("ServiceScheduleChangeModal", () => {
    it("shows the next service date as the minimum and initial date", () => {
        render(
            <ServiceScheduleChangeModal
                open
                sessionIndex={3}
                currentDate="2026-07-20"
                minimumDate="2026-07-20"
                selectedDate="2026-07-20"
                isPending={false}
                onDateChange={jest.fn()}
                onClose={jest.fn()}
                onSubmit={jest.fn()}
            />,
        );

        const input = screen.getByLabelText("3회차 서비스 제공 날짜");
        expect(input).toHaveAttribute("type", "text");
        expect(input).toHaveAttribute("inputmode", "numeric");
        expect(input).toHaveAttribute("maxlength", "10");
        expect(input).toHaveAttribute("placeholder", "2026-12-01");
        expect(input).not.toHaveAttribute("aria-invalid", "true");
        expect(input).toHaveValue("2026-07-20");
        expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toBeInTheDocument();
        expect(screen.queryByText(/현재 예정일/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
    });

    it("submits a date after the current service date", async () => {
        const onSubmit = jest.fn();
        const onDateChange = jest.fn();
        render(
            <ServiceScheduleChangeModal
                open
                sessionIndex={3}
                currentDate="2026-07-20"
                minimumDate="2026-07-20"
                selectedDate="2026-07-23"
                isPending={false}
                onDateChange={onDateChange}
                onClose={jest.fn()}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.change(screen.getByLabelText("3회차 서비스 제공 날짜"), {
            target: { value: "2026-07-24" },
        });
        expect(onDateChange).toHaveBeenCalledWith("2026-07-24");

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit).toHaveBeenCalledWith(false);
    });

    it("asks before moving a session onto a weekend and submits only once confirmed", async () => {
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                open
                sessionIndex={3}
                currentDate="2026-07-20"
                minimumDate="2026-07-17"
                selectedDate="2026-07-19"
                isPending={false}
                onDateChange={jest.fn()}
                onClose={jest.fn()}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(onSubmit).not.toHaveBeenCalled();
        expect(await screen.findByText("주말·공휴일이에요")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(true));
    });

    it("submits a date earlier than the current service date but not before the birth date", async () => {
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                open
                sessionIndex={1}
                currentDate="2026-10-05"
                minimumDate="2026-09-20"
                selectedDate="2026-09-28"
                isPending={false}
                onDateChange={jest.fn()}
                onClose={jest.fn()}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    });

    it("blocks a date before the birth date", () => {
        render(
            <ServiceScheduleChangeModal
                open
                sessionIndex={1}
                currentDate="2026-10-05"
                minimumDate="2026-09-20"
                selectedDate="2026-09-18"
                isPending={false}
                onDateChange={jest.fn()}
                onClose={jest.fn()}
                onSubmit={jest.fn()}
            />,
        );

        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
        expect(screen.getByText("2026-09-20 이후로 입력해 주세요")).toBeInTheDocument();
    });

    describe("inline date message", () => {
        const renderModal = (overrides: Partial<React.ComponentProps<typeof ServiceScheduleChangeModal>> = {}) => {
            const onDateChange = jest.fn();
            const utils = render(
                <ServiceScheduleChangeModal
                    open
                    sessionIndex={3}
                    currentDate="2026-07-20"
                    minimumDate="2026-07-21"
                    selectedDate="2026-07-21"
                    isPending={false}
                    onDateChange={onDateChange}
                    onClose={jest.fn()}
                    onSubmit={jest.fn()}
                    {...overrides}
                />,
            );
            return { onDateChange, ...utils };
        };
        const slot = () => document.getElementById("service-schedule-change-date-message");

        it("shows the static guidance in the slot on first render", () => {
            renderModal();

            expect(slot()).toHaveTextContent("출산일 이후 날짜로 선택해 주세요");
            expect(slot()).toHaveAttribute("data-slot", "field-message");
            expect(screen.getByLabelText("3회차 서비스 제공 날짜")).not.toHaveAttribute("aria-invalid", "true");
            expect(screen.getByRole("button", { name: "일정 변경" })).not.toBeDisabled();
        });

        it("replaces the guidance with an error and brings it back once the date is fixed", () => {
            const { rerender, onDateChange } = renderModal({ selectedDate: "2026-07-20" });
            const input = screen.getByLabelText("3회차 서비스 제공 날짜");
            const modalProps = {
                open: true,
                sessionIndex: 3,
                currentDate: "2026-07-20",
                minimumDate: "2026-07-21",
                isPending: false,
                onDateChange,
                onClose: jest.fn(),
                onSubmit: jest.fn(),
            };

            expect(slot()).toHaveTextContent("2026-07-21 이후로 입력해 주세요");
            expect(slot()).toHaveAttribute("data-slot", "field-error-message");
            expect(slot()).not.toHaveTextContent("출산일 이후 날짜로 선택해 주세요");
            expect(input).toHaveAttribute("aria-invalid", "true");

            rerender(<ServiceScheduleChangeModal {...modalProps} selectedDate="2026-07-25" />);

            expect(slot()).toHaveTextContent("출산일 이후 날짜로 선택해 주세요");
            expect(slot()).toHaveAttribute("data-slot", "field-message");
            expect(input).not.toHaveAttribute("aria-invalid", "true");
        });

        it("renders nothing below the date input", () => {
            renderModal();

            expectNoFieldMessageBelowControl(document.body);
        });

        it("types digits into YYYY-MM-DD while keeping the payload ISO", () => {
            const { onDateChange } = renderModal();

            fireEvent.change(screen.getByLabelText("3회차 서비스 제공 날짜"), { target: { value: "20261201" } });
            expect(onDateChange).toHaveBeenCalledWith("2026-12-01");
        });

        it("shows a hint while a partial date is focused and the format error after leaving it", () => {
            renderModal({ selectedDate: "2026-12" });
            const input = screen.getByLabelText("3회차 서비스 제공 날짜");

            fireEvent.focus(input);
            expect(slot()).toHaveTextContent("YYYY-MM-DD 형식");
            expect(slot()).not.toHaveTextContent("입력해 주세요");

            fireEvent.blur(input);
            expect(slot()).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
            expect(slot()).toHaveAttribute("data-slot", "field-error-message");
            expect(input).toHaveAttribute("aria-invalid", "true");
            expect(input).toHaveAttribute("aria-describedby", "service-schedule-change-date-message");
            expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
        });

        it("reports a cleared date as required", () => {
            const { rerender, onDateChange } = renderModal();
            const input = screen.getByLabelText("3회차 서비스 제공 날짜");

            fireEvent.change(input, { target: { value: "" } });
            expect(onDateChange).toHaveBeenCalledWith("");
            rerender(
                <ServiceScheduleChangeModal
                    open
                    sessionIndex={3}
                    currentDate="2026-07-20"
                    minimumDate="2026-07-21"
                    selectedDate=""
                    isPending={false}
                    onDateChange={onDateChange}
                    onClose={jest.fn()}
                    onSubmit={jest.fn()}
                />,
            );
            expect(slot()).toHaveTextContent("서비스 제공 날짜를 입력해 주세요");
        });

        it("rejects a nonexistent date and a date before the minimum", () => {
            const { rerender } = renderModal({ selectedDate: "2026-13-45" });
            expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
            fireEvent.blur(screen.getByLabelText("3회차 서비스 제공 날짜"));
            expect(slot()).toHaveTextContent("존재하지 않는 날짜예요");

            rerender(
                <ServiceScheduleChangeModal
                    open
                    sessionIndex={3}
                    currentDate="2026-07-20"
                    minimumDate="2026-07-25"
                    selectedDate="2026-07-22"
                    isPending={false}
                    onDateChange={jest.fn()}
                    onClose={jest.fn()}
                    onSubmit={jest.fn()}
                />,
            );
            expect(slot()).toHaveTextContent("2026-07-25 이후로 입력해 주세요");
            expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
        });
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
        refreshForSave: async () => ({ ok: true, calendar: overrides.calendar ?? KR_BUILTIN_CALENDAR, changed: false }),
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
        open: true,
        sessionIndex: 3,
        currentDate: "2026-07-20",
        minimumDate: "2026-07-17",
        selectedDate: "2026-07-22",
        isPending: false,
        onDateChange: jest.fn(),
        onClose: jest.fn(),
    };
    const slot = () => document.getElementById("service-schedule-change-date-message");

    beforeEach(() => retry.mockClear());
    afterEach(() => mockedCalendar.mockImplementation(() => result({})));

    it("blocks a changed fresh classification even if the hook version already advanced", async () => {
        mockedCalendar.mockReturnValue(result({ refreshForSave: async () => ({ ok: true, calendar: branchCalendar, changed: false }) }));
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);
        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        await screen.findByText("공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 확인 후 다시 저장해 주세요.");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("blocks a refresh failure and prevents duplicate approvals while refreshing", async () => {
        let release: (value: { ok: false }) => void = () => undefined;
        const refreshForSave = jest.fn(() => new Promise<{ ok: false }>(resolve => { release = resolve; }));
        mockedCalendar.mockReturnValue(result({ refreshForSave }));
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);
        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(refreshForSave).toHaveBeenCalledTimes(1);
        await act(async () => release({ ok: false }));
        expect(slot()).toHaveTextContent("공휴일 정보를 불러오지 못했어요");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("closes the weekend confirm dialog when the fresh calendar turns out to lack the year", async () => {
        const unsupportedCalendar = {
            ...KR_BUILTIN_CALENDAR,
            isBusinessDay: () => { throw new Error("unsupported year"); },
        };
        const refreshForSave = jest
            .fn()
            .mockResolvedValueOnce({ ok: true, calendar: KR_BUILTIN_CALENDAR, changed: false })
            .mockResolvedValueOnce({ ok: true, calendar: unsupportedCalendar, changed: false });
        mockedCalendar.mockReturnValue(result({ refreshForSave }));
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} selectedDate="2026-07-19" onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(await screen.findByText("주말·공휴일이에요")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
        await waitFor(() => expect(refreshForSave).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(slot()).toHaveTextContent("이 날짜의 공휴일 정보가 아직 없어요"));
        expect(screen.queryByText("주말·공휴일이에요")).not.toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it.each([
        ["not ready", { ready: false, error: null }],
        ["load-failed", { ready: false, error: "load-failed" }],
    ] as const)("closes the weekend confirm dialog when the calendar becomes blocking (%s) and confirm is clicked", async (_label, blocking) => {
        mockedCalendar.mockReturnValue(result({}));
        const onSubmit = jest.fn();
        const { rerender } = render(<ServiceScheduleChangeModal {...baseProps} selectedDate="2026-07-19" onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(await screen.findByText("주말·공휴일이에요")).toBeInTheDocument();

        mockedCalendar.mockReturnValue(result({ ...blocking }));
        rerender(<ServiceScheduleChangeModal {...baseProps} selectedDate="2026-07-19" onSubmit={onSubmit} />);
        fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));

        await waitFor(() => expect(screen.queryByText("주말·공휴일이에요")).not.toBeInTheDocument());
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not classify the date or submit while the calendar is loading, then asks once it is ready", async () => {
        mockedCalendar.mockImplementation(() => notReady);
        const onSubmit = jest.fn();
        const { rerender } = render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        const approve = screen.getByRole("button", { name: "일정 변경" });
        expect(approve).toBeDisabled();
        expect(slot()).toHaveTextContent("공휴일 정보를 불러오는 중이에요");
        fireEvent.click(approve);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.queryByText("주말·공휴일이에요")).not.toBeInTheDocument();

        mockedCalendar.mockImplementation(() => result({ calendar: branchCalendar }));
        rerender(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole("button", { name: "일정 변경" }));
        expect(onSubmit).not.toHaveBeenCalled();
        expect(await screen.findByText("주말·공휴일이에요")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(true));
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
        expect(slot()).toHaveTextContent("이 날짜의 공휴일 정보가 아직 없어요");
        expect(slot()).toHaveAttribute("data-slot", "field-error-message");
        expect(() => fireEvent.click(screen.getByRole("button", { name: "일정 변경" }))).not.toThrow();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows the load failure in the slot with a retry and keeps approval blocked", () => {
        mockedCalendar.mockImplementation(() => result({ ready: false, error: "load-failed" }));
        const onSubmit = jest.fn();
        render(<ServiceScheduleChangeModal {...baseProps} onSubmit={onSubmit} />);

        expect(slot()).toHaveTextContent("공휴일 정보를 불러오지 못했어요");
        expect(slot()).toHaveAttribute("data-slot", "field-error-message");
        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
        expectNoFieldMessageBelowControl(document.body);

        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
