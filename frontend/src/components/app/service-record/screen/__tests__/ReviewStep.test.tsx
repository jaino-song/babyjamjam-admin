import { fireEvent, render, screen, within } from "@testing-library/react";
import { DAILY_ITEMS, type ServiceRecordWizardSlots } from "@babyjamjam/service-record-ui";

import { ReadOnlySignature } from "@/components/app/ui/service-record";

import { ReviewStep, type ReviewStepProps } from "../ReviewStep";

const ROOT = "desktop_service-record-admin_wizard";

// The page maps the slot's props onto the read-only part (as AW's own ReadOnlySignature does).
const signature: NonNullable<ServiceRecordWizardSlots["signature"]> = ({ "data-component": component, value, signedAt }) => (
    <ReadOnlySignature data-component={component} value={value} message={signedAt ? "서명됨" : "서명 없음"} messageId={`${component}-message`} />
);

const makeProps = (overrides: Partial<ReviewStepProps> = {}): ReviewStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    pageIdx: 3,
    draft: { perineum: ["이상없음"], sitzBath: "실시", notes: "산모 요청", paymentConfirmed: true },
    editing: false,
    clientSignature: null,
    busy: false,
    hasServiceDateMismatch: false,
    defaultDate: () => "2026-09-21",
    onBack: jest.fn(),
    onSignatureChange: jest.fn(),
    onOpenServiceDateEditor: jest.fn(),
    onEditSection: jest.fn(),
    signature,
    adminSessionAction: <button type="button" data-component={`${ROOT}_body_confirmation-action_confirm`}>수정 확인</button>,
    ...overrides,
});

const byComponent = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`) as HTMLElement | null;
const endingWith = (suffix: string) => document.querySelectorAll(`[data-component$="${suffix}"]`);

describe("ReviewStep", () => {
    it("names the three review sections and their rows under the review root", () => {
        render(<ReviewStep {...makeProps()} />);

        const review = document.querySelector('[data-slot="review"]')!;
        expect(review).toHaveAttribute("data-component", `${ROOT}_body_review`);
        const mom = screen.getByRole("region", { name: "산모" });
        expect(within(mom).getByRole("group", { name: /회음절개부위/ })).toHaveTextContent("이상없음");
        expect(screen.getByRole("region", { name: "신생아" })).toBeInTheDocument();
        const finish = screen.getByRole("region", { name: "서비스 기록" });
        expect(within(finish).getByRole("group", { name: /특이사항/ })).toHaveTextContent("산모 요청");
        expect(within(finish).getByRole("group", { name: /결제 확인/ })).toHaveTextContent("✓ 확인 완료");
        expect(within(finish).getByRole("group", { name: /기타 서비스/ })).toHaveTextContent("입력 없음");
        expect(byComponent("body_day-title")).toHaveTextContent("기록 내용 확인");
    });

    it("keeps the data-component counts the admin specs rely on", () => {
        render(<ReviewStep {...makeProps()} />);
        expect(endingWith("_body_review_section")).toHaveLength(3);
        expect(endingWith("_body_review_section_row").length + endingWith("_body_review_section_note").length).toBe(DAILY_ITEMS.length);
        expect(endingWith("_body_review_section_note")).toHaveLength(2);
        expect(endingWith("_body_review_section_grid")).toHaveLength(3);
    });

    it("lays rows out in a two-column grid and keeps the text rows full width", () => {
        render(<ReviewStep {...makeProps()} />);
        const grid = byComponent("body_review_section_grid")!;
        expect(grid).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2");
        const finish = screen.getByRole("region", { name: "서비스 기록" });
        expect(within(finish).getByRole("group", { name: /특이사항/ })).toHaveClass("sm:col-span-2");
        expect(within(finish).getByRole("group", { name: /결제 확인/ })).not.toHaveClass("sm:col-span-2");
    });

    it("shows the admin handover banner and never the resign notice, even when editing (SRW:972, :978)", () => {
        render(<ReviewStep {...makeProps({ editing: true })} />);
        expect(byComponent("body_handover-banner")).toHaveTextContent("관리자 수정 내용을 확인해 주세요.");
        expect(screen.queryByText("최종 기록을 확인해 주세요.")).toBeNull();
        expect(byComponent("body_resign-notice")).toBeNull();
    });

    describe("section edit buttons (SRW:418)", () => {
        it("are absent before a day is submitted", () => {
            render(<ReviewStep {...makeProps()} />);
            expect(screen.queryByRole("button", { name: /수정$/ })).toBeNull();
            expect(document.querySelector('[data-slot="review"] [data-slot="sec-edit"]')).toBeNull();
        });

        it("send the section index while editing", () => {
            const props = makeProps({ editing: true });
            render(<ReviewStep {...props} />);

            const edits = document.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]');
            expect(edits).toHaveLength(3);
            fireEvent.click(screen.getByRole("button", { name: "산모 수정" }));
            fireEvent.click(screen.getByRole("button", { name: "신생아 수정" }));
            fireEvent.click(screen.getByRole("button", { name: "서비스 기록 수정" }));
            expect(props.onEditSection).toHaveBeenNthCalledWith(1, 0);
            expect(props.onEditSection).toHaveBeenNthCalledWith(2, 1);
            expect(props.onEditSection).toHaveBeenNthCalledWith(3, 2);
        });

        it("are absent, not disabled, while read-only", () => {
            render(<ReviewStep {...makeProps({ editing: true, readOnly: true })} />);
            expect(screen.queryByRole("button", { name: /수정$/ })).toBeNull();
            expect(document.querySelector('[data-slot="review"] [data-slot="sec-edit"]')).toBeNull();
        });
    });

    describe("signature slot", () => {
        it("renders the slot node under the review with SRW's arguments", () => {
            const slot = jest.fn(signature);
            render(<ReviewStep {...makeProps({
                signature: slot,
                context: {
                    totalSessions: 5, startDate: "2026-09-21", header: null,
                    sessions: [{
                        sessionIndex: 1, serviceDate: "2026-09-21", locked: true,
                        clientSignature: "data:image/png;base64,SAVED", clientSignedAt: "2026-09-21T01:00:00.000Z",
                    }],
                },
            })} />);

            expect(slot).toHaveBeenCalledWith({
                "data-component": `${ROOT}_body_mom-sign`,
                value: "data:image/png;base64,SAVED",
                signedAt: "2026-09-21T01:00:00.000Z",
                onChange: expect.any(Function),
                locked: true,
            });
            expect(screen.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", "data:image/png;base64,SAVED");
        });

        it("falls back to the clientSignature prop, unlocked, and renders nothing without a slot", () => {
            const slot = jest.fn(signature);
            const { unmount } = render(<ReviewStep {...makeProps({ signature: slot, clientSignature: "data:image/png;base64,DRAFT" })} />);
            expect(slot).toHaveBeenCalledWith(expect.objectContaining({ value: "data:image/png;base64,DRAFT", signedAt: null, locked: false }));
            unmount();

            render(<ReviewStep {...makeProps({ signature: undefined })} />);
            expect(byComponent("body_mom-sign")).toBeNull();
            expect(screen.queryByRole("img", { name: "산모 서명" })).toBeNull();
        });
    });

    describe("admin session action", () => {
        it("replaces the submit button inside the sticky bar", () => {
            render(<ReviewStep {...makeProps()} />);
            const bar = byComponent("body_confirmation-action")!;
            expect(within(bar).getByRole("button", { name: "수정 확인" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
            expect(screen.queryByRole("button", { name: "초안 저장" })).toBeNull();
            expect(screen.queryByRole("button", { name: "조회 전용" })).toBeNull();
        });

        it("calls a function action with whether any answer is a bad number (SRW:1022)", () => {
            const action = jest.fn(({ hasInvalidNumericAnswers }: { hasInvalidNumericAnswers: boolean }) => (
                <button type="button" disabled={hasInvalidNumericAnswers}>저장</button>
            ));
            const { rerender } = render(<ReviewStep {...makeProps({ adminSessionAction: action })} />);
            expect(action).toHaveBeenLastCalledWith({ hasInvalidNumericAnswers: false });
            expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();

            // The check covers the whole draft, not just the review page.
            rerender(<ReviewStep {...makeProps({ adminSessionAction: action, draft: { meals_meal: "abc" } })} />);
            expect(action).toHaveBeenLastCalledWith({ hasInvalidNumericAnswers: true });
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
        });
    });

    describe("head", () => {
        it("goes back, and renders the date chip and editor on the confirmation page", () => {
            const props = makeProps({
                editing: true,
                serviceDateEditor: ({ "data-component": component, disabled, onOpen }) => (
                    <button type="button" data-component={component} disabled={disabled} onClick={onOpen}>제공일 수정</button>
                ),
            });
            render(<ReviewStep {...props} />);

            fireEvent.click(screen.getByRole("button", { name: "이전" }));
            expect(props.onBack).toHaveBeenCalledTimes(1);
            expect(byComponent("body_date-chip")).toHaveTextContent("1회차 · 2026.09.21");
            expect(byComponent("body_date-edit")!.parentElement).toHaveClass("date-row");
            fireEvent.click(screen.getByRole("button", { name: "제공일 수정" }));
            expect(props.onOpenServiceDateEditor).toHaveBeenCalledWith(1);
        });

        it("keeps the date caution row on the review page", () => {
            render(<ReviewStep {...makeProps({ hasServiceDateMismatch: true })} />);
            const row = byComponent("body_service-date-readonly")!;
            expect(row.querySelector('[data-slot="lab-msg"]')).toHaveTextContent("오늘과 다른 날짜예요");
        });
    });
});
