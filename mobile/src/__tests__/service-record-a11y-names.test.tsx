import { render, screen, within } from "@testing-library/react";
import { ServiceRecordWizard } from "../../../packages/service-record-ui/src/ServiceRecordWizard";
import { DEFAULT_DAILY_ANSWERS } from "../../../packages/service-record-ui/src/form-definition";
import type { ServiceRecordWizardProps } from "../../../packages/service-record-ui/src/types";

const validHeader = {
    momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
    deliveryType: "자연분만", babyWeight: "3.2",
};
const makeProps = (overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps => ({
    "data-component": "mobile_service-record_wizard", screen: "day", phone: "", phoneError: null,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    header: validHeader, day: 1, pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS }, editing: false, clientSignature: null,
    busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
    scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
    onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
});

describe("service record accessible names", () => {
    it("names the option groups after their item", () => {
        render(<ServiceRecordWizard {...makeProps({ pageIdx: 0 })} />);
        const group = screen.getByRole("group", { name: /회음절개부위/ });
        expect(within(group).getByRole("button", { name: /이상없음/ })).toBeInTheDocument();
        expect(screen.getByRole("radiogroup", { name: /좌욕/ })).toBeInTheDocument();
    });

    it("names the delivery type group on the header step", () => {
        render(<ServiceRecordWizard {...makeProps({ screen: "service" })} />);
        const group = screen.getByRole("radiogroup", { name: "분만형태" });
        expect(within(group).getByRole("button", { name: /자연분만/ })).toBeInTheDocument();
    });

    it("keeps meal inputs unique on the first page", () => {
        render(<ServiceRecordWizard {...makeProps({ pageIdx: 0 })} />);
        expect(screen.getAllByLabelText(/식사/)).toHaveLength(1);
        expect(screen.getByLabelText("간식")).toBeInTheDocument();
    });

    it("prefixes ambiguous count inputs with their item and leaves unambiguous ones alone", () => {
        render(<ServiceRecordWizard {...makeProps({ pageIdx: 1 })} />);
        expect(screen.getByLabelText("체온")).toBeInTheDocument();
        expect(screen.getByLabelText("모유수유 횟수")).toBeInTheDocument();
        expect(screen.getByLabelText("분유수유 횟수")).toBeInTheDocument();
        expect(screen.getByLabelText("분유수유 회당")).toBeInTheDocument();
    });

    it("names the review sections, their edit buttons and their rows", () => {
        render(<ServiceRecordWizard {...makeProps({ pageIdx: 3, editing: true })} />);
        const mom = screen.getByRole("region", { name: "산모" });
        expect(within(mom).getByRole("group", { name: /회음절개부위/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "산모 수정" })).toHaveTextContent("수정");
        expect(screen.getByRole("button", { name: "신생아 수정" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "서비스 기록 수정" })).toBeInTheDocument();
    });
});
