import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceRecordWizard } from "../../../packages/service-record-ui/src/ServiceRecordWizard";
import type { ServiceRecordWizardProps } from "../../../packages/service-record-ui/src/types";

const validHeader = {
    momName: "이예지", momBirth: "900101", babyName: "이아기", babyBirth: "260615",
    deliveryType: "자연분만", babyWeight: "3.2",
};
const makeProps = (overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps => ({
    "data-component": "mobile_service-record_wizard", screen: "service", phone: "", phoneError: null,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    header: validHeader, day: 1, pageIdx: 0, draft: {}, editing: false, clientSignature: null,
    busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
    scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
    onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
});

function Harness({ onSave = jest.fn() }: { onSave?: () => void }) {
    const [header, setHeader] = useState<Record<string, string>>(validHeader);
    return <ServiceRecordWizard {...makeProps({ header, onSaveHeader: onSave,
        onHeaderChange: (key, value) => setHeader((current) => ({ ...current, [key]: value })),
    })} />;
}

describe("employee service record inline guidance", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());

    it("computes its own field errors without an administrator supplying headerErrors", () => {
        const save = jest.fn();
        render(<Harness onSave={save} />);
        const name = screen.getByLabelText("산모 성명");
        const helperId = name.getAttribute("aria-describedby")!;
        expect(document.getElementById(helperId)).toHaveAttribute("data-component", "mobile_service-record_wizard_body_field_mom-name-input_helper");
        expect(name).not.toHaveAttribute("aria-invalid", "true");
        fireEvent.compositionStart(name);
        fireEvent.change(name, { target: { value: "이 예지" } });
        fireEvent.compositionEnd(name);
        fireEvent.blur(name);
        expect(name).toHaveValue("이 예지");
        expect(name).toHaveAttribute("aria-invalid", "true");
        expect(document.getElementById(helperId)).toHaveTextContent("띄어쓰기를 사용할 수 없으니");
        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).not.toHaveBeenCalled();
        fireEvent.change(name, { target: { value: "이예지" } });
        expect(name).not.toHaveAttribute("aria-invalid", "true");
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).toHaveBeenCalledTimes(1);
    });
    it("does not silently truncate or normalize an eight-digit/spaced birthday", () => {
        render(<Harness />);
        const birth = screen.getByLabelText("산모 생년월일 (숫자 6자리)");
        expect(birth).toHaveAttribute("inputmode", "numeric");
        expect(birth).not.toHaveAttribute("maxlength", "6");
        fireEvent.change(birth, { target: { value: "1990 01 01" } });
        fireEvent.blur(birth);
        expect(birth).toHaveValue("1990 01 01");
        expect(birth).toHaveAttribute("aria-invalid", "true");
        expect(document.getElementById(birth.getAttribute("aria-describedby")!)).toHaveTextContent("900101");
        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    });
    it("shows a missing-field message after blur and removes it after correction", () => {
        render(<Harness />);
        const weight = screen.getByLabelText("신생아 몸무게 (kg)");
        fireEvent.change(weight, { target: { value: "" } });
        fireEvent.blur(weight);
        expect(document.getElementById(weight.getAttribute("aria-describedby")!)).toHaveTextContent("몸무게를 입력해 주세요");
        fireEvent.change(weight, { target: { value: "3.2" } });
        expect(weight).not.toHaveAttribute("aria-invalid", "true");
    });
    it("labels optional text, character limits and abnormal-stool instructions", () => {
        const { rerender } = render(<ServiceRecordWizard {...makeProps({ screen: "day", pageIdx: 2, draft: { etcService: "옷 정리" } })} />);
        const notes = screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" });
        expect(notes).toHaveAttribute("maxlength", "40");
        expect(document.getElementById(notes.getAttribute("aria-describedby")!)).toHaveTextContent("비워 두세요");
        expect(document.getElementById(notes.getAttribute("aria-describedby")!)).toHaveTextContent("4/40자");
        rerender(<ServiceRecordWizard {...makeProps({ screen: "day", pageIdx: 1, draft: { stool: "이상변" } })} />);
        const stool = screen.getByLabelText("이상변의 색깔과 상태");
        fireEvent.blur(stool);
        expect(stool).toHaveAttribute("aria-invalid", "true");
        expect(document.getElementById(stool.getAttribute("aria-describedby")!)).toHaveTextContent("변의 색깔");
    });
    it("does not turn legacy read-only names into editable errors", () => {
        render(<ServiceRecordWizard {...makeProps({ readOnly: true, header: { ...validHeader, momName: "이 예지" } })} />);
        expect(screen.getByLabelText("산모 성명")).toHaveValue("이 예지");
        expect(screen.getByLabelText("산모 성명")).toBeDisabled();
        expect(screen.getByLabelText("산모 성명")).not.toHaveAttribute("aria-invalid", "true");
    });
});
