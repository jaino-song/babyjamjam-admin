import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewStep, type ReviewStepProps } from "../ReviewStep";

// jsdom has no canvas: a stand-in that "signs" with a fixed data URI (same seam as the page contract tests).
jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: ({ onChange, locked, value }: { onChange: (dataUri: string | null) => void; locked: boolean; value: string | null }) => (
        <button type="button" data-locked={locked} data-value={value ?? ""} onClick={() => onChange("data:image/png;base64,AAAA")}>서명 입력</button>
    ),
}));

const ROOT = "mobile_service-record_wizard";

const makeProps = (overrides: Partial<ReviewStepProps> = {}): ReviewStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    pageIdx: 3,
    draft: { _date: "2026-09-21", perineum: ["이상없음"], sitzBath: "실시", notes: "산모 요청", paymentConfirmed: true },
    editing: false,
    clientSignature: null,
    busy: false,

    defaultDate: () => "2026-09-21",
    onBack: jest.fn(),
    onSignatureChange: jest.fn(),
    onOpenSubmitModal: jest.fn(),
    onEditSection: jest.fn(),
    onOpenDateSheet: jest.fn(),
    ...overrides,
});

const lockedContext = (employeeId?: number | null): ReviewStepProps["context"] => ({
    totalSessions: 5, startDate: "2026-09-21", header: null, employee: { id: 7, name: "김돌봄" },
    sessions: [{
        sessionIndex: 1, serviceDate: "2026-09-21", locked: true, clientSignature: "data:image/png;base64,SAVED",
        ...(employeeId === undefined ? {} : { employeeId }),
    }],
});
const ownLockedContext = lockedContext(7);

describe("ReviewStep", () => {
    it("names the three review sections and their rows", () => {
        render(<ReviewStep {...makeProps()} />);

        const mom = screen.getByRole("region", { name: "산모" });
        expect(within(mom).getByRole("group", { name: /회음절개부위/ })).toHaveTextContent("이상없음");
        expect(screen.getByRole("region", { name: "신생아" })).toBeInTheDocument();
        const finish = screen.getByRole("region", { name: "서비스 기록" });
        expect(within(finish).getByRole("group", { name: /특이사항/ })).toHaveTextContent("산모 요청");
        expect(within(finish).getByRole("group", { name: /결제 확인/ })).toHaveTextContent("✓ 확인 완료");
        expect(within(finish).getByRole("group", { name: /기타 서비스/ })).toHaveTextContent("입력 없음");
        expect(document.querySelector(`[data-component="${ROOT}_body_day-title"]`)).toHaveTextContent("기록 내용 확인");
        expect(document.querySelector(`[data-component="${ROOT}_body_handover-banner"]`)).toBeNull();
    });

    it("offers no edit buttons or resign notice before a day is submitted", () => {
        render(<ReviewStep {...makeProps()} />);
        expect(screen.queryByRole("button", { name: /수정$/ })).toBeNull();
        expect(document.querySelector(`[data-component="${ROOT}_body_resign-notice"]`)).toBeNull();
    });

    it("sends the section index from each 수정 button when editing a submitted day", async () => {
        const user = userEvent.setup();
        const props = makeProps({ editing: true, context: ownLockedContext });
        render(<ReviewStep {...props} />);

        expect(document.querySelector(`[data-component="${ROOT}_body_day-title"]`)).toHaveTextContent("1회차 기록 수정");
        expect(screen.getByRole("button", { name: "산모 수정" })).toHaveTextContent("수정");
        await user.click(screen.getByRole("button", { name: "산모 수정" }));
        await user.click(screen.getByRole("button", { name: "신생아 수정" }));
        await user.click(screen.getByRole("button", { name: "서비스 기록 수정" }));
        expect(props.onEditSection).toHaveBeenNthCalledWith(1, 0);
        expect(props.onEditSection).toHaveBeenNthCalledWith(2, 1);
        expect(props.onEditSection).toHaveBeenNthCalledWith(3, 2);
    });

    it("keeps the submit action disabled until the mom has signed", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        const { rerender } = render(<ReviewStep {...props} />);
        const submit = screen.getByRole("button", { name: "확인" });
        expect(submit).toBeDisabled();

        await user.click(screen.getByRole("button", { name: "서명 입력" }));
        expect(props.onSignatureChange).toHaveBeenCalledWith("data:image/png;base64,AAAA");

        rerender(<ReviewStep {...props} clientSignature="data:image/png;base64,AAAA" />);
        expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();
        await user.click(screen.getByRole("button", { name: "확인" }));
        expect(props.onOpenSubmitModal).toHaveBeenCalledTimes(1);
    });

    it("takes the signature of an already submitted session and locks the pad", () => {
        render(<ReviewStep {...makeProps({
            context: {
                totalSessions: 5, startDate: "2026-09-21", header: null, employee: { id: 7, name: "김돌봄" },
                sessions: [{ sessionIndex: 1, serviceDate: "2026-09-21", locked: true, employeeId: 7, clientSignature: "data:image/png;base64,SAVED" }],
            },
        })} />);
        expect(screen.getByRole("button", { name: "서명 입력" })).toHaveAttribute("data-locked", "true");
        expect(screen.getByRole("button", { name: "서명 입력" })).toHaveAttribute("data-value", "data:image/png;base64,SAVED");
        expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();
    });

    it("disables submit while busy and while an answer is invalid", () => {
        const signed = "data:image/png;base64,AAAA";
        const { rerender } = render(<ReviewStep {...makeProps({ clientSignature: signed, busy: true })} />);
        expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();

        rerender(<ReviewStep {...makeProps({ clientSignature: signed, draft: { meals_meal: "abc" } })} />);
        expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();

        rerender(<ReviewStep {...makeProps({ clientSignature: signed, draft: { notes: "가".repeat(81) } })} />);
        expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
    });

    it("shows a changed date with the old date struck out and opens date editing", async () => {
        const props = makeProps({ editing: true, context: ownLockedContext, draft: { _date: "2026-09-23" }, onOpenDateSheet: jest.fn(), onDeleteSession: jest.fn() });
        const { container } = render(<ReviewStep {...props} />);
        expect(container.querySelector("del")).toHaveTextContent("09.21");
        expect(screen.getByText("2026.09.23(수)")).toBeInTheDocument();
        expect(screen.getByText("다른 회차 날짜는 바뀌지 않아요.")).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole("button", { name: "서비스 제공일 수정" }));
        expect(props.onOpenDateSheet).toHaveBeenCalledTimes(1);
        await userEvent.setup().click(screen.getByRole("button", { name: "기록 삭제" }));
        expect(props.onDeleteSession).toHaveBeenCalledTimes(1);
    });
    it("uses burgundy utilities for the delete action on a stored session", () => {
        render(<ReviewStep {...makeProps({ editing: true, context: ownLockedContext })} />);

        const deleteButton = screen.getByRole("button", { name: "기록 삭제" });
        expect(deleteButton).toHaveClass("text-v3-burgundy", "border-v3-burgundy");
        expect(deleteButton.className).not.toContain("[var(--v3-burgundy)]");
    });

    it("hides the delete action when no stored session exists for the selected day", () => {
        const { rerender } = render(<ReviewStep {...makeProps({ context: ownLockedContext, day: 2 })} />);
        expect(screen.queryByRole("button", { name: "기록 삭제" })).not.toBeInTheDocument();

        rerender(<ReviewStep {...makeProps()} />);
        expect(screen.queryByRole("button", { name: "기록 삭제" })).not.toBeInTheDocument();
    });

    it("resubmits the caregiver's own submitted day: 수정 buttons and the submit action stay", async () => {
        const user = userEvent.setup();
        const props = makeProps({ editing: true, context: ownLockedContext });
        render(<ReviewStep {...props} />);

        expect(screen.getByRole("button", { name: "산모 수정" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "확인" }));
        expect(props.onOpenSubmitModal).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["another caregiver", 99],
        ["no recorded caregiver (null)", null],
        ["no recorded caregiver (missing)", undefined],
    ])("allows editing and resubmitting a day submitted by %s", async (_label, employeeId) => {
        const user = userEvent.setup();
        const props = makeProps({ editing: true, context: lockedContext(employeeId) });
        render(<ReviewStep {...props} />);

        expect(screen.queryByText(/다른 제공인력이\s제출한 회차라 수정할 수 없어요\./)).toBeNull();
        expect(document.querySelector(`[data-component="${ROOT}_body_day-title"]`)).toHaveTextContent("1회차 기록 수정");
        expect(screen.getAllByRole("button", { name: /수정$/ })).toHaveLength(4);
        await user.click(screen.getByRole("button", { name: "산모 수정" }));
        expect(props.onEditSection).toHaveBeenCalledWith(0);
        expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();
        await user.click(screen.getByRole("button", { name: "확인" }));
        expect(props.onOpenSubmitModal).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("region", { name: "산모" })).toBeInTheDocument();
    });
});
