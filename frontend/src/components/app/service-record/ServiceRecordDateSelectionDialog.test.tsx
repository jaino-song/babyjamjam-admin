import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import {
    getBusinessDayOptions,
    getInitialServiceRecordDateSelection,
    getSupportedKoreanBusinessYears,
    isSelectableServiceRecordDate,
    ServiceRecordDateSelectionDialog,
} from "./ServiceRecordDateSelectionDialog";

const DATA_COMPONENT = "desktop_service-record-admin_date-selection-dialog";

function renderDialog(
    overrides: Partial<React.ComponentProps<typeof ServiceRecordDateSelectionDialog>> = {},
) {
    const props: React.ComponentProps<typeof ServiceRecordDateSelectionDialog> = {
        open: true,
        onOpenChange: jest.fn(),
        currentServiceDate: "2026-07-16",
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
    it("derives supported years from the shared calendar and filters weekends and holidays", () => {
        const years = getSupportedKoreanBusinessYears();
        const julyOptions = getBusinessDayOptions(2026, 7);

        expect(years).toEqual([...years].sort((left, right) => left - right));
        expect(years.length).toBeGreaterThan(1);
        expect(julyOptions.map((option) => option.value)).toContain("16");
        expect(julyOptions.map((option) => option.value)).not.toEqual(
            expect.arrayContaining(["17", "18", "19"]),
        );
        expect(isSelectableServiceRecordDate("2026-07-17")).toBe(false);
        expect(isSelectableServiceRecordDate("2026-07-18")).toBe(false);
        expect(isSelectableServiceRecordDate("2026-07-16")).toBe(true);
    });

    it("blocks malformed and unsupported initial dates without guessing a fallback", () => {
        const years = getSupportedKoreanBusinessYears();
        const unsupportedDate = `${Math.max(...years) + 1}-01-02`;

        expect(getInitialServiceRecordDateSelection("2026-02-30")).toEqual({
            parts: null,
            reason: "malformed",
        });
        expect(getInitialServiceRecordDateSelection(unsupportedDate)).toEqual({
            parts: null,
            reason: "unsupported-year",
        });

        const { rerender } = renderDialog({ currentServiceDate: "2026-02-30" });
        expect(screen.getByRole("alert")).toHaveTextContent("형식이 올바르지 않아");
        expect(screen.queryByRole("combobox", { name: "연도" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "날짜 적용" })).toBeDisabled();

        rerender(
            <ServiceRecordDateSelectionDialog
                open
                onOpenChange={jest.fn()}
                currentServiceDate={unsupportedDate}
                sessionLabel="3회차"
                onApply={jest.fn()}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent("지원하지 않는 달력");
        expect(screen.queryByRole("combobox", { name: "연도" })).not.toBeInTheDocument();
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
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));

        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenCalledWith("2026-07-15");
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("clears the provisional day whenever year or month changes", () => {
        const onApply = jest.fn();
        renderDialog({ onApply });

        chooseOption("월", "8월");
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("일");
        expect(screen.getByRole("button", { name: "날짜 적용" })).toBeDisabled();

        chooseOption("일", "3일");
        chooseOption("연도", "2025년");
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("일");
        expect(screen.getByRole("button", { name: "날짜 적용" })).toBeDisabled();

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
});
