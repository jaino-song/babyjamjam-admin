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

        it("shows no message on first render", () => {
            renderModal();

            expect(slot()).toBeNull();
            expect(screen.getByRole("button", { name: "일정 변경" })).not.toBeDisabled();
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
            expect(slot()).toHaveTextContent("YYYY-MM-DD 형식으로 입력해 주세요");
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
