import { fireEvent, render, screen } from "@testing-library/react";

import { ServiceScheduleChangeModal } from "../ServiceScheduleChangeModal";

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
        expect(input).toHaveAttribute("type", "date");
        expect(input).toHaveAttribute("min", "2026-07-20");
        expect(input).toHaveValue("2026-07-20");
        expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toBeInTheDocument();
        expect(screen.queryByText(/현재 예정일/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
    });

    it("submits a date after the current service date", () => {
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
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});
