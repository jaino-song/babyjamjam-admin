import { fireEvent, render, screen, within } from "@testing-library/react";
import { ServiceRecordWizard } from "../../../packages/service-record-ui/src/ServiceRecordWizard";
import { DEFAULT_DAILY_ANSWERS } from "../../../packages/service-record-ui/src/form-definition";
import type { ServiceRecordWizardProps } from "../../../packages/service-record-ui/src/types";
import { MobileServiceRecordScreen } from "@/components/app/service-record/screen/MobileServiceRecordScreen";

// The first-visit 작성 가이드 opens over a record with no saved header and is
// covered by its own tests; stub it so this file exercises the form beneath.
jest.mock("@/components/app/service-record/guide", () => ({ ServiceRecordGuide: () => null }));

// jsdom has no canvas: a stand-in for the mobile screen's signature pad (the shared wizard renders none without a slot).
jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: ({ onChange }: { onChange: (dataUri: string | null) => void }) => (
        <button type="button" onClick={() => onChange("data:image/png;base64,AAAA")}>서명 입력</button>
    ),
}));

const ROWS = [
    { name: "shared wizard", Component: ServiceRecordWizard },
    { name: "mobile screen", Component: MobileServiceRecordScreen },
];

const validHeader = {
    momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
    deliveryType: "자연분만", babyWeight: "3.2",
};
const makeProps = (overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps => ({
    "data-component": "mobile_service-record_wizard", screen: "day", phone: "", phoneError: null,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    header: validHeader, day: 1, pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS }, editing: false, clientSignature: null,
    busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
    hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
    onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
    onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
});

describe.each(ROWS)("service record accessible names ($name)", ({ Component }) => {
    it("names the option groups after their item", () => {
        render(<Component {...makeProps({ pageIdx: 0 })} />);
        const group = screen.getByRole("group", { name: /회음절개부위/ });
        expect(within(group).getByRole("button", { name: /이상없음/ })).toBeInTheDocument();
        expect(screen.getByRole("radiogroup", { name: /좌욕/ })).toBeInTheDocument();
    });

    it("names the delivery type group on the header step", () => {
        render(<Component {...makeProps({ screen: "service" })} />);
        const group = screen.getByRole("radiogroup", { name: "분만형태" });
        expect(within(group).getByRole("button", { name: /자연분만/ })).toBeInTheDocument();
    });

    it("keeps meal inputs unique on the first page", () => {
        render(<Component {...makeProps({ pageIdx: 0 })} />);
        expect(screen.getAllByLabelText(/식사/)).toHaveLength(1);
        expect(screen.getByLabelText("간식")).toBeInTheDocument();
    });

    it("prefixes ambiguous count inputs with their item and leaves unambiguous ones alone", () => {
        render(<Component {...makeProps({ pageIdx: 1 })} />);
        expect(screen.getByLabelText("체온")).toBeInTheDocument();
        expect(screen.getByLabelText("모유수유 횟수")).toBeInTheDocument();
        expect(screen.getByLabelText("분유수유 횟수")).toBeInTheDocument();
        expect(screen.getByLabelText("분유수유 회당")).toBeInTheDocument();
    });

    it("names the review sections, their edit buttons and their rows", () => {
        render(<Component {...makeProps({ pageIdx: 3, editing: true })} />);
        const mom = screen.getByRole("region", { name: "산모" });
        expect(within(mom).getByRole("group", { name: /회음절개부위/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "산모 수정" })).toHaveTextContent("수정");
        expect(screen.getByRole("button", { name: "신생아 수정" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "서비스 기록 수정" })).toBeInTheDocument();
    });
});


it("names the calendar trigger, announces its dialog, and opens it with the keyboard", () => {
    const open = jest.fn();
    render(<MobileServiceRecordScreen {...makeProps()} onOpenDateSheet={open} />);
    const input = screen.getByRole("textbox", { name: "서비스 제공일" });
    expect(input).toHaveAttribute("aria-haspopup", "dialog");
    expect(input).toHaveAttribute("readonly");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
});

describe.each(ROWS)("open-session overview ($name)", ({ Component }) => {
    it.each([true, false])("uses openDays when supplied and nextOpenDay as the fallback (explicit=%s)", (explicit) => {
        const props = makeProps({
            screen: "overview", lockedDays: new Set([2, 3]), nextOpenDay: () => 1,
            ...(explicit ? { openDays: () => [1, 4] } : {}),
            context: { totalSessions: 5, startDate: "2026-09-21", header: validHeader, sessions: [
                { sessionIndex: 2, locked: true, serviceDate: "2026-09-22" },
                { sessionIndex: 3, locked: true, serviceDate: "2026-09-23" },
            ] },
        });
        const { container } = render(<Component {...props} />);
        const cards = container.querySelectorAll<HTMLButtonElement>('[data-slot="day"], [data-source-component="DayCard"]');
        expect(cards).toHaveLength(5);
        expect(cards[0]).toBeEnabled();
        expect(cards[0]).toHaveTextContent("입력 가능");
        expect(cards[4]).toBeDisabled();
        expect(cards[4]).toHaveTextContent("대기");
        if (explicit) {
            expect(cards[3]).toBeEnabled();
            expect(cards[3]).toHaveTextContent("입력 가능");
            fireEvent.click(cards[3]);
            expect(props.onOpenDay).toHaveBeenLastCalledWith(4, false);
        } else {
            expect(cards[3]).toBeDisabled();
        }
        fireEvent.click(screen.getByRole("button", { name: "다음 회차 입력" }));
        expect(props.onOpenDay).toHaveBeenLastCalledWith(1);
    });
});
