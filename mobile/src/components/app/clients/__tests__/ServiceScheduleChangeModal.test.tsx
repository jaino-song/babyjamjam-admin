import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

        rerender(<ServiceScheduleChangeModal {...defaultProps} selectedDate="2099-01-01" />);
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
