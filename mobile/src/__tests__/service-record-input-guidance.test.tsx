import { useState, type ComponentType } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceRecordWizard } from "../../../packages/service-record-ui/src/ServiceRecordWizard";
import { DEFAULT_DAILY_ANSWERS } from "../../../packages/service-record-ui/src/form-definition";
import type { ServiceRecordWizardProps } from "../../../packages/service-record-ui/src/types";
import { MobileServiceRecordScreen } from "@/components/app/service-record/screen/MobileServiceRecordScreen";
import { dismissServiceRecordGuide } from "@/test-utils/service-record-guide";

type Tone = "error" | "hint" | undefined;
/**
 * The same behaviour tests run on the shared wizard and on the mobile screen. The
 * two differ only in how a message slot exposes its tone (class vs `data-tone`).
 */
interface WizardRow {
    name: string;
    Component: ComponentType<ServiceRecordWizardProps>;
    toneOf: (slot: HTMLElement | null) => Tone;
    messageSlots: (container: HTMLElement) => HTMLElement[];
}
const slotsOf = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-slot="lab-msg"]'));
const SHARED_ROW: WizardRow = {
    name: "shared wizard",
    Component: ServiceRecordWizard,
    toneOf: (slot) => (slot?.classList.contains("error") ? "error" : slot?.classList.contains("hint") ? "hint" : undefined),
    messageSlots: slotsOf,
};
const MOBILE_ROW: WizardRow = {
    name: "mobile screen",
    Component: MobileServiceRecordScreen,
    toneOf: (slot) => (slot?.getAttribute("data-tone") === "error" ? "error" : slot?.getAttribute("data-tone") === "hint" ? "hint" : undefined),
    messageSlots: slotsOf,
};
const ROWS = [SHARED_ROW, MOBILE_ROW];

// Ids both implementations must keep identical (aria-describedby and focus targets depend on them).
const FIELD_ROOT = "mobile_service-record_wizard_body_day-field";
const MEAL_INPUT_ID = `${FIELD_ROOT}_meals_count-options_meal-input-control`;
const PERINEUM_SLOT_ID = `${FIELD_ROOT}_perineum-helper`;
const PAYMENT_SLOT_ID = `${FIELD_ROOT}_payment-confirmed-helper`;

const validHeader = {
    momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
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

function Harness({ Component, onSave = jest.fn() }: { Component: WizardRow["Component"]; onSave?: (header: Record<string, string>) => void }) {
    const [header, setHeader] = useState<Record<string, string>>(validHeader);
    return <Component {...makeProps({ header, onSaveHeader: () => onSave({ ...header }),
        onHeaderChange: (key, value) => setHeader((current) => ({ ...current, [key]: value })),
    })} />;
}

const slotOf = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby")!)!;

describe.each(ROWS)("employee service record inline guidance ($name)", (row) => {
    const { Component } = row;
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    // On the mobile screen a header-less context opens the how-to guide over this form; a user skips it first.
    const skipGuide = async () => { if (row === MOBILE_ROW) await dismissServiceRecordGuide(); };

    it("shows no message on a first render of the basic-information step", async () => {
        const { container } = render(<Harness Component={Component} />);
        await skipGuide();
        expect(row.messageSlots(container)).toHaveLength(6);
        for (const slot of row.messageSlots(container)) expect(slot).toBeEmptyDOMElement();
        expect(container.querySelector(".field-helper")).toBeNull();
        expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    });

    it("renders every message in a one-line slot inside the label row, never below the input", async () => {
        render(<Harness Component={Component} />);
        await skipGuide();
        const name = screen.getByLabelText("산모 성명");
        const slot = slotOf(name);
        expect(slot).toHaveAttribute("aria-live", "polite");
        expect(slot.parentElement).toContainElement(screen.getByText("산모 성명"));
        expect(slot.parentElement!.nextElementSibling).toBe(name);
    });

    it("computes its own field errors and blocks Next with every problem shown in its slot", async () => {
        const save = jest.fn();
        render(<Harness Component={Component} onSave={save} />);
        await skipGuide();
        const name = screen.getByLabelText("산모 성명");
        expect(name).not.toHaveAttribute("aria-invalid", "true");
        fireEvent.compositionStart(name);
        fireEvent.change(name, { target: { value: "이 예지" } });
        fireEvent.compositionEnd(name);
        fireEvent.blur(name);
        expect(name).toHaveValue("이 예지");
        expect(name).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(name)).toHaveTextContent("띄어쓰기 없이 입력해 주세요");
        expect(row.toneOf(slotOf(name))).toBe("error");
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).not.toHaveBeenCalled();
        expect(name).toHaveFocus();
        fireEvent.change(name, { target: { value: "이예지" } });
        expect(name).not.toHaveAttribute("aria-invalid", "true");
        expect(slotOf(name)).toBeEmptyDOMElement();
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("keeps Next enabled on an empty form, shows each required message after pressing it and focuses the first problem", async () => {
        const save = jest.fn();
        const empty = { momName: "", momBirth: "", babyName: "", babyBirth: "", deliveryType: "", babyWeight: "" };
        render(<Component {...makeProps({ header: empty, onSaveHeader: save })} />);
        await skipGuide();
        const next = screen.getByRole("button", { name: "다음" });
        expect(next).toBeEnabled();
        fireEvent.click(next);
        expect(save).not.toHaveBeenCalled();
        expect(slotOf(screen.getByLabelText("산모 성명"))).toHaveTextContent("산모 성명을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("산모 생년월일"))).toHaveTextContent("산모 생년월일을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("신생아 성명"))).toHaveTextContent("신생아 성명을 입력해 주세요");
        expect(slotOf(screen.getByLabelText("신생아 출생일자"))).toHaveTextContent("신생아 출생일자를 입력해 주세요");
        expect(slotOf(screen.getByLabelText("신생아 몸무게 (kg)"))).toHaveTextContent("신생아 몸무게를 입력해 주세요");
        expect(document.getElementById("service-record-header-deliveryType-error")).toHaveTextContent("분만형태를 선택해 주세요");
        expect(screen.getByLabelText("산모 성명")).toHaveFocus();
        expect(screen.getByLabelText("산모 성명")).toHaveAttribute("aria-invalid", "true");
    });

    it.each([
        ["산모 생년월일", "1994-03-15", "산모 생년월일을 입력해 주세요"],
        ["신생아 출생일자", "2026-09-20", "신생아 출생일자를 입력해 주세요"],
    ])("formats incremental digits, hints while focused and errors after leaving for %s", async (label, placeholder, required) => {
        render(<Harness Component={Component} />);
        await skipGuide();
        const birth = screen.getByLabelText(label);
        expect(birth).toHaveAttribute("placeholder", placeholder);
        expect(birth).toHaveAttribute("inputmode", "numeric");
        expect(birth).toHaveAttribute("maxlength", "10");
        expect(screen.queryByLabelText(`${label} (YYYY-MM-DD)`)).not.toBeInTheDocument();
        fireEvent.focus(birth);
        for (const [value, expected] of [
            ["", ""], ["1", "1"], ["19", "19"], ["199", "199"], ["1999", "1999"],
            ["19990", "1999-0"], ["199901", "1999-01"], ["1999010", "1999-01-0"],
            ["19990101", "1999-01-01"],
        ]) {
            fireEvent.change(birth, { target: { value } });
            expect(birth).toHaveValue(expected);
        }
        fireEvent.change(birth, { target: { value: "1999-01-0" } });
        expect(slotOf(birth)).toHaveTextContent("예: 19940315");
        expect(slotOf(birth)).not.toHaveTextContent("입력해 주세요");
        expect(row.toneOf(slotOf(birth))).toBe("hint");
        expect(birth).not.toHaveAttribute("aria-invalid", "true");
        fireEvent.blur(birth);
        expect(birth).toHaveValue("1999-01-0");
        expect(birth).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(birth)).toHaveTextContent("8자리로 입력해 주세요");
        expect(row.toneOf(slotOf(birth))).toBe("error");
        fireEvent.change(birth, { target: { value: "" } });
        expect(birth).toHaveValue("");
        expect(slotOf(birth)).toHaveTextContent(required);
        fireEvent.change(birth, { target: { value: "19990101" } });
        expect(birth).toHaveValue("1999-01-01");
        expect(birth).not.toHaveAttribute("aria-invalid", "true");
        expect(slotOf(birth)).toBeEmptyDOMElement();
    });
    it("formats compact, spaced and hyphenated date input before saving parent state and keeps the payload unchanged", async () => {
        const save = jest.fn();
        render(<Harness Component={Component} onSave={save} />);
        await skipGuide();
        const momBirth = screen.getByLabelText("산모 생년월일");
        const babyBirth = screen.getByLabelText("신생아 출생일자");
        for (const value of ["19990101", "1999 01 01", "1999-01-01"]) {
            fireEvent.change(momBirth, { target: { value } });
            expect(momBirth).toHaveValue("1999-01-01");
        }
        fireEvent.change(babyBirth, { target: { value: "20260615" } });
        fireEvent.blur(momBirth);
        fireEvent.blur(babyBirth);
        expect(babyBirth).toHaveValue("2026-06-15");
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).toHaveBeenCalledWith({
            momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
            deliveryType: "자연분만", babyWeight: "3.2",
        });
    });
    it("submits the brief's example birthday and weight exactly as before", async () => {
        const save = jest.fn();
        render(<Harness Component={Component} onSave={save} />);
        await skipGuide();
        fireEvent.change(screen.getByLabelText("산모 생년월일"), { target: { value: "19940315" } });
        fireEvent.change(screen.getByLabelText("신생아 출생일자"), { target: { value: "20260920" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ momBirth: "1994-03-15", babyBirth: "2026-09-20", babyWeight: "3.2" }));
    });
    it.each([
        ["19990229", "존재하지 않는 날짜예요"],
        ["20260922", "미래 날짜는 입력할 수 없어요"],
        ["990101", "8자리로 입력해 주세요"],
    ])("does not accept an invalid or incomplete formatted birthday: %s", async (value, message) => {
        render(<Harness Component={Component} />);
        await skipGuide();
        const birth = screen.getByLabelText("산모 생년월일");
        fireEvent.change(birth, { target: { value } });
        fireEvent.blur(birth);
        expect(birth).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(birth)).toHaveTextContent(message);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(birth).toHaveFocus();
        fireEvent.change(birth, { target: { value: "20000229" } });
        expect(birth).toHaveValue("2000-02-29");
        expect(birth).not.toHaveAttribute("aria-invalid", "true");
    });
    it("passes formatted birthdays through the shared callback in adminMode=false", async () => {
        const onHeaderChange = jest.fn();
        render(<Component {...makeProps({ onHeaderChange })} />);
        await skipGuide();
        fireEvent.change(screen.getByLabelText("산모 생년월일"), { target: { value: "19990101" } });
        fireEvent.change(screen.getByLabelText("신생아 출생일자"), { target: { value: "20260615" } });
        expect(onHeaderChange).toHaveBeenCalledWith("momBirth", "1999-01-01");
        expect(onHeaderChange).toHaveBeenCalledWith("babyBirth", "2026-06-15");
    });
    it("shows a missing-field message after a value was cleared and removes it after correction", async () => {
        render(<Harness Component={Component} />);
        await skipGuide();
        const weight = screen.getByLabelText("신생아 몸무게 (kg)");
        fireEvent.change(weight, { target: { value: "" } });
        expect(slotOf(weight)).toHaveTextContent("신생아 몸무게를 입력해 주세요");
        expect(weight).toHaveAttribute("aria-invalid", "true");
        fireEvent.change(weight, { target: { value: "3.2" } });
        expect(weight).not.toHaveAttribute("aria-invalid", "true");
        fireEvent.change(weight, { target: { value: "0" } });
        fireEvent.blur(weight);
        expect(slotOf(weight)).toHaveTextContent("0보다 큰 숫자로 (예: 3.2)");
    });
    it("moves optional text counters, limits and abnormal-stool instructions into the label-row slot", () => {
        const { rerender, container } = render(<Component {...makeProps({ screen: "day", pageIdx: 2, draft: { etcService: "옷 정리" } })} />);
        const notes = screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" });
        expect(notes).toHaveAttribute("maxlength", "40");
        expect(slotOf(notes)).toHaveTextContent("4/40자");
        expect(row.toneOf(slotOf(notes))).toBe("hint");
        expect(slotOf(screen.getByRole("textbox", { name: "특이사항 (필요 시 기재)" }))).toBeEmptyDOMElement();
        expect(container.querySelector(".field-helper")).toBeNull();
        rerender(<Component {...makeProps({ screen: "day", pageIdx: 2, draft: { etcService: "가".repeat(41) } })} />);
        expect(slotOf(screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" }))).toHaveTextContent("40자 이내로 줄여 주세요");
        rerender(<Component {...makeProps({ screen: "day", pageIdx: 1, draft: { stool: "이상변" } })} />);
        const stool = screen.getByLabelText("이상변의 색깔과 상태");
        expect(slotOf(stool)).toBeEmptyDOMElement();
        fireEvent.blur(stool);
        expect(slotOf(stool)).toBeEmptyDOMElement();
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(stool).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(stool)).toHaveTextContent("변 색깔·상태를 적어 주세요");
    });
});

describe.each(ROWS)("employee service record phone step ($name)", (row) => {
    const { Component } = row;
    const phoneProps = (overrides: Partial<ServiceRecordWizardProps> = {}) => makeProps({ screen: "phone", ...overrides });
    it("uses the example placeholder and shows nothing on first load", () => {
        render(<Component {...phoneProps()} />);
        const phone = screen.getByLabelText("휴대폰 번호");
        expect(phone).toHaveAttribute("placeholder", "010-1234-5678");
        expect(slotOf(phone)).toBeEmptyDOMElement();
    });
    it("hints while typing, errors after leaving an incomplete number and keeps the 10-digit rule", () => {
        const { rerender } = render(<Component {...phoneProps({ phone: "010-12" })} />);
        const phone = screen.getByLabelText("휴대폰 번호");
        fireEvent.focus(phone);
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
        expect(row.toneOf(slotOf(phone))).toBe("hint");
        fireEvent.blur(phone);
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(phone).toHaveAttribute("aria-invalid", "true");
        rerender(<Component {...phoneProps({ phone: "010-123-4567" })} />);
        expect(slotOf(phone)).toBeEmptyDOMElement();
        expect(phone).not.toHaveAttribute("aria-invalid", "true");
    });
    it("blocks the submit with a required message and focus, and only sends a complete number", () => {
        const submit = jest.fn();
        const { rerender } = render(<Component {...phoneProps({ onSubmitPhone: submit })} />);
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
        expect(submit).not.toHaveBeenCalled();
        expect(slotOf(screen.getByLabelText("휴대폰 번호"))).toHaveTextContent("휴대폰 번호를 입력해 주세요");
        expect(screen.getByLabelText("휴대폰 번호")).toHaveFocus();
        rerender(<Component {...phoneProps({ onSubmitPhone: submit, phone: "010-1234-5678" })} />);
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
        expect(submit).toHaveBeenCalledTimes(1);
    });
    it("keeps a page-level failure out of the field slot", () => {
        render(<Component {...phoneProps({ phone: "010-1234-5678", phoneError: "확인 중 오류가 발생했습니다." })} />);
        expect(screen.getByRole("alert")).toHaveTextContent("확인 중 오류가 발생했습니다.");
        expect(slotOf(screen.getByLabelText("휴대폰 번호"))).toBeEmptyDOMElement();
    });
    it("shows a failure that belongs to the phone field in its slot, not as a page alert", () => {
        render(<Component {...phoneProps({ phone: "010-1234-5678", phoneFieldError: "휴대폰 번호가 일치하지 않아요" })} />);
        const phone = screen.getByLabelText("휴대폰 번호");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(slotOf(phone)).toHaveTextContent("휴대폰 번호가 일치하지 않아요");
        expect(phone).toHaveAttribute("aria-invalid", "true");
    });
    it("hints while the pressed-through phone is focused and incomplete, then errors once left", () => {
        render(<Component {...phoneProps({ phone: "010-12" })} />);
        const phone = screen.getByLabelText("휴대폰 번호");
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
        expect(phone).toHaveFocus();
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
        expect(slotOf(phone)).not.toHaveTextContent("입력해 주세요");
        fireEvent.blur(phone);
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(phone).toHaveAttribute("aria-invalid", "true");
    });
});

describe.each(ROWS)("employee service record day step ($name)", (row) => {
    const { Component } = row;
    it("shows no message on first load and only hints nothing selected", () => {
        const { container } = render(<Component {...makeProps({ screen: "day", pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS } })} />);
        for (const slot of row.messageSlots(container)) expect(slot).toBeEmptyDOMElement();
        expect(container.querySelector(".field-helper")).toBeNull();
    });
    it("keeps Next enabled, blocks it and shows the required count messages after pressing it", () => {
        const next = jest.fn();
        render(<Component {...makeProps({ screen: "day", pageIdx: 0, onNextPage: next, draft: { ...DEFAULT_DAILY_ANSWERS } })} />);
        const button = screen.getByRole("button", { name: "다음" });
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(next).not.toHaveBeenCalled();
        const meal = document.getElementById(MEAL_INPUT_ID) as HTMLInputElement;
        expect(meal).toHaveFocus();
        expect(meal).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(meal)).toHaveTextContent("식사를 입력해 주세요");
        expect(row.toneOf(slotOf(meal))).toBe("error");
    });
    it("advances when the page is complete", () => {
        const next = jest.fn();
        render(<Component {...makeProps({ screen: "day", pageIdx: 0, onNextPage: next, draft: { ...DEFAULT_DAILY_ANSWERS, meals_meal: "2", meals_snack: "1" } })} />);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(next).toHaveBeenCalledTimes(1);
    });
    it("shows a choice-required message after every option of a multi-select is cleared", () => {
        const { rerender } = render(<Component {...makeProps({ screen: "day", pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS } })} />);
        const slot = () => document.getElementById(PERINEUM_SLOT_ID)!;
        expect(slot()).toBeEmptyDOMElement();
        rerender(<Component {...makeProps({ screen: "day", pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS, perineum: [] } })} />);
        expect(slot()).toHaveTextContent("회음절개부위를 선택해 주세요");
    });
    it("asks for the payment confirmation only after the page was submitted", () => {
        render(<Component {...makeProps({ screen: "day", pageIdx: 2, draft: { ...DEFAULT_DAILY_ANSWERS } })} />);
        const slot = document.getElementById(PAYMENT_SLOT_ID)!;
        expect(slot).toBeEmptyDOMElement();
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(slot).toHaveTextContent("결제 확인을 눌러 주세요");
    });
});

describe.each(ROWS)("employee service record service date ($name)", (row) => {
    const { Component } = row;
    const dayProps = (overrides: Partial<ServiceRecordWizardProps> = {}) => makeProps({ screen: "day", pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS, meals_meal: "2", meals_snack: "1" }, ...overrides });
    it("is a typed YYYY-MM-DD field, empty of messages on first load, with an example placeholder", () => {
        render(<Component {...dayProps()} />);
        const date = screen.getByLabelText("제공일자");
        expect(date).toHaveAttribute("type", "text");
        expect(date).toHaveAttribute("placeholder", "2026-12-01");
        expect(date).toHaveAttribute("maxlength", "10");
        expect(date).toHaveValue("2026-09-21");
        expect(slotOf(date)).toBeEmptyDOMElement();
    });
    it("formats typed digits, only reports a complete valid date and blocks Next on a partial one", () => {
        const onServiceDateChange = jest.fn();
        const next = jest.fn();
        render(<Component {...dayProps({ onServiceDateChange, onNextPage: next })} />);
        const date = screen.getByLabelText("제공일자");
        fireEvent.focus(date);
        fireEvent.change(date, { target: { value: "2026092" } });
        expect(date).toHaveValue("2026-09-2");
        expect(onServiceDateChange).not.toHaveBeenCalled();
        expect(slotOf(date)).toHaveTextContent("예: 19940315");
        fireEvent.blur(date);
        expect(slotOf(date)).toHaveTextContent("8자리로 입력해 주세요");
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(next).not.toHaveBeenCalled();
        expect(date).toHaveFocus();
        fireEvent.change(date, { target: { value: "20260923" } });
        expect(date).toHaveValue("2026-09-23");
        expect(onServiceDateChange).toHaveBeenCalledWith("2026-09-23");
    });
    it("rejects a date before the start and never reports it", () => {
        const onServiceDateChange = jest.fn();
        render(<Component {...dayProps({ onServiceDateChange })} />);
        const date = screen.getByLabelText("제공일자");
        fireEvent.change(date, { target: { value: "20260101" } });
        fireEvent.blur(date);
        expect(onServiceDateChange).not.toHaveBeenCalled();
        expect(slotOf(date)).toHaveTextContent("이전 날짜는 선택할 수 없어요");
    });
});

// Cases that exercise the shared wizard's own DOM shape or its administrator / read-only props.
// The mobile screen omits those props (`adminMode`, `readOnly`), so they stay shared-only.
describe("shared wizard only: DOM shape, adminMode and readOnly", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());

    it("renders its message slot with the helper data-component, inside a .lab-row", () => {
        render(<Harness Component={ServiceRecordWizard} />);
        const name = screen.getByLabelText("산모 성명");
        const slot = slotOf(name);
        expect(slot).toHaveAttribute("data-component", "mobile_service-record_wizard_body_field_mom-name-input_helper");
        expect(slot.parentElement).toHaveClass("lab-row");
    });
    it("passes formatted birthdays through the shared callback in adminMode=true", () => {
        const onHeaderChange = jest.fn();
        render(<ServiceRecordWizard {...makeProps({ adminMode: true, onHeaderChange })} />);
        fireEvent.change(screen.getByLabelText("산모 생년월일"), { target: { value: "19990101" } });
        fireEvent.change(screen.getByLabelText("신생아 출생일자"), { target: { value: "20260615" } });
        expect(onHeaderChange).toHaveBeenCalledWith("momBirth", "1999-01-01");
        expect(onHeaderChange).toHaveBeenCalledWith("babyBirth", "2026-06-15");
    });
    it("does not turn legacy read-only names into editable errors", () => {
        render(<ServiceRecordWizard {...makeProps({ readOnly: true, header: { ...validHeader, momName: "이 예지" } })} />);
        expect(screen.getByLabelText("산모 성명")).toHaveValue("이 예지");
        expect(screen.getByLabelText("산모 성명")).toBeDisabled();
        expect(screen.getByLabelText("산모 성명")).not.toHaveAttribute("aria-invalid", "true");
    });
});
