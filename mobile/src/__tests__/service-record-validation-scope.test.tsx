import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceRecordWizard } from "../../../packages/service-record-ui/src/ServiceRecordWizard";
import { hasServiceRecordHeaderValues, isServiceRecordHeaderComplete } from "../../../packages/service-record-ui/src/form-definition";
import type { ServiceRecordWizardProps } from "../../../packages/service-record-ui/src/types";

const legacyHeader = {
    momName: "이예지", momBirth: "900101", babyName: "이아기", babyBirth: "260615",
    deliveryType: "자연분만", babyWeight: "3.2",
};
function makeProps(overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps {
    return {
        "data-component": "mobile_service-record_wizard", screen: "service", phone: "", phoneError: null,
        context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
        header: legacyHeader, day: 1, pageIdx: 0, draft: {}, editing: false, clientSignature: null,
        busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
        scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
        onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
        onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
        onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
        onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
        onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
    };
}

describe("service record validation scope", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());

    it("does not let an empty supplied error map bypass employee validation", () => {
        const props = makeProps({ headerErrors: {} });
        render(<ServiceRecordWizard {...props} />);
        const next = screen.getByRole("button", { name: "다음" });
        expect(next).toBeDisabled();
        fireEvent.click(next);
        expect(props.onSaveHeader).not.toHaveBeenCalled();
    });
    it("validates the full header when an administrator supplies no scoped error map", () => {
        const props = makeProps({ adminMode: true });
        render(<ServiceRecordWizard {...props} />);
        const save = screen.getByRole("button", { name: "초안 저장" });
        expect(save).toBeDisabled();
        fireEvent.click(save);
        expect(props.onSaveHeader).not.toHaveBeenCalled();
    });
    it("preserves legacy values when the administrator explicitly validates a partial patch", () => {
        const props = makeProps({ adminMode: true, headerErrors: {} });
        render(<ServiceRecordWizard {...props} />);
        expect(screen.getByLabelText(/^산모 생년월일/)).toHaveValue("900101");
        expect(screen.getByRole("button", { name: "초안 저장" })).toBeEnabled();
        expect(props.onHeaderChange).not.toHaveBeenCalled();
    });
    it("still requires all basic information for an administrator patch", () => {
        render(<ServiceRecordWizard {...makeProps({ adminMode: true, headerErrors: {}, header: { ...legacyHeader, babyName: "" } })} />);
        expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
    });
    it("blocks a scoped patch error and displays its field message", () => {
        render(<ServiceRecordWizard {...makeProps({ adminMode: true, headerErrors: { momName: "띄어쓰기 없이 입력해 주세요." } })} />);
        expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
        expect(screen.getByLabelText("산모 성명")).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("alert")).toHaveTextContent("띄어쓰기 없이 입력해 주세요.");
    });
    it("keeps strict completeness distinct from presence for legacy records", () => {
        expect(hasServiceRecordHeaderValues(legacyHeader)).toBe(true);
        expect(isServiceRecordHeaderComplete(legacyHeader)).toBe(false);
        expect(isServiceRecordHeaderComplete({ ...legacyHeader, momBirth: "1990-01-01", babyBirth: "2026-06-15" })).toBe(true);
    });
});
