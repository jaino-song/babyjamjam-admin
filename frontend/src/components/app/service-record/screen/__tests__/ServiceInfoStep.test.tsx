import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ServiceRecordWizardSlots } from "@babyjamjam/service-record-ui";

import { useHeaderFieldState } from "../headerFieldState";
import { ServiceInfoStep, type ServiceInfoStepProps } from "../ServiceInfoStep";

const ROOT = "desktop_service-record-admin_wizard";

const COMPLETE_HEADER = {
    momName: "김산모",
    momBirth: "1990-01-01",
    babyName: "김아기",
    babyBirth: "2026-07-14",
    deliveryType: "자연분만",
    babyWeight: "3.2",
};

type HarnessProps = Omit<ServiceInfoStepProps, "fieldState">;

/** The screen root owns the field state; the harness plays that part. */
function Harness(props: HarnessProps) {
    const fieldState = useHeaderFieldState(props.header);
    return <ServiceInfoStep {...props} fieldState={fieldState} />;
}

const makeProps = (overrides: Partial<HarnessProps> = {}): HarnessProps => ({
    "data-component": ROOT,
    context: {
        totalSessions: 5,
        startDate: "2026-09-21",
        header: null,
        sessions: [],
        employee: { id: 1, name: "박제공" },
        org: { name: "인천 한마음" },
    },
    header: { ...COMPLETE_HEADER },
    readOnly: false,
    busy: false,
    onBack: jest.fn(),
    onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(),
    onSaveHeader: jest.fn(),
    ...overrides,
});

const byComponent = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`) as HTMLElement | null;
const messageSlots = () => Array.from(document.querySelectorAll('[data-slot="lab-msg"]'));

describe("ServiceInfoStep", () => {
    it("renders back, title, the two read-only rows and the six fields", () => {
        render(<Harness {...makeProps()} />);

        expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
        expect(byComponent("body_service-title")).toHaveTextContent("서비스 기본정보");
        expect(byComponent("body_readonly-row")).toHaveTextContent("제공인력박제공");
        expect(byComponent("body_readonly-row-2")).toHaveTextContent("제공기관인천 한마음");
        for (const label of ["산모 성명", "산모 생년월일", "신생아 성명", "신생아 출생일자", "신생아 몸무게 (kg)"]) {
            expect(screen.getByLabelText(label)).toBeInTheDocument();
        }
        const delivery = screen.getByRole("radiogroup", { name: "분만형태" });
        expect(within(delivery).getByRole("button", { name: "자연분만" })).toHaveAttribute("aria-pressed", "true");
        expect(within(delivery).getByRole("button", { name: "제왕절개" })).toHaveAttribute("aria-pressed", "false");
    });

    it("falls back to 정보 없음 and 인천 아이미래로 when the context names neither", () => {
        render(<Harness {...makeProps({ context: { totalSessions: 5, startDate: null, header: null, sessions: [] } })} />);
        expect(byComponent("body_readonly-row")).toHaveTextContent("정보 없음");
        expect(byComponent("body_readonly-row-2")).toHaveTextContent("인천 아이미래로");
    });

    it("lays the fields out in the two-column FormGrid", () => {
        render(<Harness {...makeProps()} />);
        const grid = byComponent("body_fields")!;
        expect(grid).toHaveAttribute("data-source-component", "FormGrid");
        expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2");
        expect(grid).toContainElement(screen.getByLabelText("산모 성명"));
    });

    it("keeps the shared wizard's ids, data-components, single message slot and optional inputs", () => {
        render(<Harness {...makeProps()} />);

        // Exactly one message slot per field: five inputs and 분만형태.
        expect(messageSlots()).toHaveLength(6);
        const mom = screen.getByLabelText("산모 성명");
        expect(mom).toHaveAttribute("id", "service-record-header-momName");
        expect(mom).toHaveAttribute("data-component", `${ROOT}_body_field_mom-name-input_control`);
        expect(mom).toHaveAttribute("aria-describedby", "service-record-header-momName-error");
        expect(mom).not.toBeRequired();
        expect(mom).toHaveAttribute("aria-required", "false");
        expect(document.getElementById("service-record-header-momName-error")).toHaveAttribute("data-slot", "lab-msg");
        const weight = screen.getByLabelText("신생아 몸무게 (kg)");
        expect(weight).toHaveAttribute("data-component", `${ROOT}_body_field-2_baby-weight-input_control`);
        expect(byComponent("body_field_mom-birth-input")).toBeInTheDocument();
        expect(byComponent("body_field_baby-name-input")).toBeInTheDocument();
        expect(byComponent("body_field_baby-birth-input")).toBeInTheDocument();
        // The label row is the input's direct predecessor in its field, so the label reaches the input by htmlFor only.
        expect(mom.previousElementSibling).toHaveAttribute("data-component", `${ROOT}_body_field_mom-name-input_label-row`);
        // 분만형태: its first option carries the focus id and every option points at the one message.
        const delivery = screen.getByRole("radiogroup", { name: "분만형태" });
        const first = within(delivery).getByRole("button", { name: "자연분만" });
        expect(first).toHaveAttribute("id", "service-record-header-deliveryType");
        expect(first).toHaveAttribute("aria-describedby", "service-record-header-deliveryType-error");
        expect(delivery).toHaveAttribute("aria-labelledby", "service-record-header-deliveryType-error-label");
    });

    it("shows no message until a field is edited, then the package's hint in the single slot", () => {
        const { rerender } = render(<Harness {...makeProps({ header: { ...COMPLETE_HEADER, momBirth: "" } })} />);
        for (const slot of messageSlots()) expect(slot).toBeEmptyDOMElement();

        const birth = screen.getByLabelText("산모 생년월일");
        fireEvent.focus(birth);
        rerender(<Harness {...makeProps({ header: { ...COMPLETE_HEADER, momBirth: "1999" } })} />);
        const slot = document.getElementById(birth.getAttribute("aria-describedby")!)!;
        expect(slot).toHaveTextContent("예: 19940315");
        expect(slot).toHaveAttribute("data-tone", "hint");
        expect(birth).not.toHaveAttribute("aria-invalid");
        expect(messageSlots()).toHaveLength(6);
    });

    it("shows a supplied header error in the field's slot and marks the field invalid", () => {
        render(<Harness {...makeProps({
            header: { ...COMPLETE_HEADER, babyBirth: "2026-02-30" },
            headerErrors: { babyBirth: "존재하지 않는 날짜예요" },
        })} />);

        const input = screen.getByLabelText("신생아 출생일자");
        expect(input).toHaveAttribute("aria-invalid", "true");
        const slot = document.getElementById(input.getAttribute("aria-describedby")!)!;
        expect(slot).toHaveTextContent("존재하지 않는 날짜예요");
        expect(slot).toHaveAttribute("data-tone", "error");
        expect(slot).toHaveAttribute("data-component", expect.stringContaining("baby-birth"));
    });

    it("formats typed birth dates like the shared wizard and forwards other keys untouched", () => {
        const props = makeProps();
        render(<Harness {...props} />);

        fireEvent.change(screen.getByLabelText("산모 생년월일"), { target: { value: "19940315" } });
        expect(props.onHeaderChange).toHaveBeenLastCalledWith("momBirth", "1994-03-15");
        fireEvent.change(screen.getByLabelText("신생아 출생일자"), { target: { value: "20260714" } });
        expect(props.onHeaderChange).toHaveBeenLastCalledWith("babyBirth", "2026-07-14");
        fireEvent.change(screen.getByLabelText("산모 성명"), { target: { value: "이예지" } });
        expect(props.onHeaderChange).toHaveBeenLastCalledWith("momName", "이예지");
        fireEvent.change(screen.getByLabelText("신생아 몸무게 (kg)"), { target: { value: "3.5" } });
        expect(props.onHeaderChange).toHaveBeenLastCalledWith("babyWeight", "3.5");
    });

    it("limits the date fields to ten characters", () => {
        render(<Harness {...makeProps()} />);
        expect(screen.getByLabelText("산모 생년월일")).toHaveAttribute("maxlength", "10");
        expect(screen.getByLabelText("신생아 출생일자")).toHaveAttribute("maxlength", "10");
        expect(screen.getByLabelText("산모 성명")).not.toHaveAttribute("maxlength");
    });

    it("sends the delivery type and goes back", () => {
        const props = makeProps();
        render(<Harness {...props} />);

        fireEvent.click(screen.getByRole("button", { name: "제왕절개" }));
        expect(props.onDeliveryTypeChange).toHaveBeenCalledWith("제왕절개");
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        expect(props.onBack).toHaveBeenCalledTimes(1);
    });

    it("is inert while read-only: every control disabled and no messages even with errors", () => {
        render(<Harness {...makeProps({
            readOnly: true,
            header: { ...COMPLETE_HEADER, babyBirth: "2026-02-30" },
            headerErrors: { babyBirth: "존재하지 않는 날짜예요" },
        })} />);

        for (const label of ["산모 성명", "산모 생년월일", "신생아 성명", "신생아 출생일자", "신생아 몸무게 (kg)"]) {
            expect(screen.getByLabelText(label)).toBeDisabled();
        }
        for (const option of ["자연분만", "제왕절개"]) expect(screen.getByRole("button", { name: option })).toBeDisabled();
        for (const slot of messageSlots()) expect(slot).toBeEmptyDOMElement();
        expect(screen.getByLabelText("신생아 출생일자")).not.toHaveAttribute("aria-invalid");
    });

    describe("action bar", () => {
        const adminHeaderAction: NonNullable<ServiceRecordWizardSlots["adminHeaderAction"]> = jest.fn(({ isHeaderComplete, headerErrors }) => (
            <button type="button" data-testid="slot-action" data-complete={String(isHeaderComplete)} data-errors={Object.keys(headerErrors).join(",")}>
                수정 확인
            </button>
        ));

        it("renders the adminHeaderAction slot inside the sticky bar with the resolved state", () => {
            render(<Harness {...makeProps({ header: { ...COMPLETE_HEADER, babyWeight: "-1" } })} adminHeaderAction={adminHeaderAction} />);

            const bar = byComponent("body_service-actions")!;
            expect(bar).toHaveAttribute("data-source-component", "StickyActionBar");
            const action = within(bar).getByTestId("slot-action");
            expect(action).toHaveAttribute("data-complete", "false");
            expect(action).toHaveAttribute("data-errors", "babyWeight");
            expect(screen.queryByRole("button", { name: "초안 저장" })).toBeNull();
        });

        it("falls back to 초안 저장, enabled for a complete header, and saves", () => {
            const props = makeProps();
            render(<Harness {...props} />);

            const save = within(byComponent("body_service-actions")!).getByRole("button", { name: "초안 저장" });
            expect(save).toBeEnabled();
            fireEvent.click(save);
            expect(props.onSaveHeader).toHaveBeenCalledTimes(1);
        });

        it("disables the fallback for an incomplete header, while busy and while read-only", () => {
            const { rerender } = render(<Harness {...makeProps({ header: { ...COMPLETE_HEADER, momName: "" } })} />);
            expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();

            rerender(<Harness {...makeProps({ busy: true })} />);
            expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();

            rerender(<Harness {...makeProps({ readOnly: true })} />);
            expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
        });
    });
});
