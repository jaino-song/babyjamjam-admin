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
    lockedDays: new Set(),
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

    it.each([
        ["수정중", { changedSessionIndexes: new Set([1]), adminEditedSessionIndexes: new Set([1]) }, "warning"],
        ["수정 완료", { adminEditedSessionIndexes: new Set([1]) }, "success"],
        ["제출완료", { lockedDays: new Set([1]) }, "primary"],
        ["편집 가능", {}, "primary"],
        ["조회 가능", { readOnly: true }, "primary"],
    ] as const)("shows the numbered title with the %s badge", (label, overrides, tone) => {
        render(<ReviewStep {...makeProps({ editing: true, ...overrides })} />);
        expect(byComponent("body_day-title")).toHaveTextContent(/^1회차 기록$/);
        const badge = byComponent("body_submitted-badge")!;
        expect(badge).toHaveTextContent(label);
        expect(byComponent("body_day-title")!.parentElement).toContainElement(badge);
        expect(badge).toHaveClass(tone === "primary" ? "bg-v3-primary-light" : `bg-status-${tone}`);
        expect(badge).toHaveClass(tone === "primary" ? "text-v3-primary" : `text-status-${tone}-fg`);
    });

    it("shows only a changed answer as old then new, including an unsaved edit in the badge", () => {
        render(<ReviewStep {...makeProps({
            baseSessionDraft: { _date: "2026-09-21", breast: ["이상없음"], perineum: ["이상없음"] },
            draft: { breast: ["울혈"], perineum: ["이상없음"] },
            adminEditedSessionIndexes: new Set([1]),
        })} />);
        const row = screen.getByRole("group", { name: /유방상태/ });
        expect(row.querySelector('[data-slot="old-value"]')).toHaveTextContent(/^이상없음$/);
        expect(row.querySelector('[data-slot="old-value"]')).toHaveClass("line-through", "text-v3-text-muted", "mr-[calc(6px*var(--glint-ui-scale,1))]");
        expect(row.querySelector('[data-slot="new-value"]')).toHaveTextContent(/^울혈$/);
        expect(row.querySelector('[data-slot="new-value"]')).toHaveClass("text-v3-burgundy");
        expect(row).toHaveTextContent(/이상없음 변경 후 울혈$/);
        const unchanged = screen.getByRole("group", { name: /회음절개부위/ });
        expect(within(unchanged).getAllByText("이상없음")).toHaveLength(1);
        expect(unchanged.querySelector('[data-slot="old-value"]')).toBeNull();
        expect(byComponent("body_submitted-badge")).toHaveTextContent("수정중");
    });

    it.each([
        ["유방상태", "이상없음", "울혈"],
        ["서비스 제공일", "2026.09.21(월)", "2026.09.22(화)"],
    ])("announces before and after labels for the changed %s row", (label, old, next) => {
        render(<ReviewStep {...makeProps({
            baseSessionDraft: { _date: "2026-09-21", breast: ["이상없음"] },
            draft: { _date: "2026-09-22", breast: ["울혈"] },
        })} />);
        const row = screen.getByRole("group", { name: new RegExp(label) });
        expect(row).toHaveTextContent("변경 전");
        expect(row).toHaveTextContent("변경 후");
        expect(row.querySelector('[data-slot="old-value-label"]')).toHaveClass("sr-only");
        expect(row.querySelector('[data-slot="new-value-label"]')).toHaveClass("sr-only");
        expect(row.querySelector('[data-slot="old-value"]')?.textContent).toBe(old);
        expect(row.querySelector('[data-slot="new-value"]')?.textContent).toBe(next);
    });

    it.each([
        [{ notes: "기존 메모" }, { notes: "" }, "기존 메모", "입력 없음"],
        [{}, { notes: "새 메모" }, "입력 없음", "새 메모"],
        [{ meals_meal: 3 }, { meals_meal: "3" }, null, null],
    ])("uses formatted values and an empty label on either side", (base, draft, old, next) => {
        render(<ReviewStep {...makeProps({ baseSessionDraft: { _date: "2026-09-21", ...base }, draft })} />);
        if (old) {
            const note = screen.getByRole("group", { name: /특이사항/ });
            expect(note.querySelector('[data-slot="old-value"]')).toHaveTextContent(old);
            expect(note.querySelector('[data-slot="new-value"]')).toHaveTextContent(next!);
        } else {
            expect(screen.getByRole("group", { name: /식사/ }).querySelector('[data-slot="old-value"]')).toBeNull();
            expect(byComponent("body_submitted-badge")).toHaveTextContent("편집 가능");
        }
    });

    it("renders pending dates from the confirmed session rather than the planned original date", () => {
        const display = jest.fn(() => <span>원본 09.19</span>);
        const props = makeProps({
            baseSessionDraft: { _date: "2026-09-21" }, draft: { _date: "2026-09-22" }, serviceDateDisplay: display,
        });
        const { rerender } = render(<ReviewStep {...props} />);
        const row = screen.getByRole("group", { name: "서비스 제공일" });
        expect(row.querySelector('[data-slot="old-value"]')).toHaveTextContent(/^2026.09.21\(월\)$/);
        expect(row.querySelector('[data-slot="old-value"]')).toHaveClass("line-through", "text-v3-text-muted");
        expect(row.querySelector('[data-slot="new-value"]')).toHaveTextContent(/^2026.09.22\(화\)$/);
        expect(row.querySelector('[data-slot="new-value"]')).toHaveClass("text-v3-burgundy");
        expect(byComponent("body_submitted-badge")).toHaveTextContent("수정중");
        expect(display).not.toHaveBeenCalled();
        rerender(<ReviewStep {...props} draft={{ _date: "2026-09-21" }} />);
        expect(row).toHaveTextContent(/2026.09.21\(월\)$/);
        expect(row.querySelector('[data-slot="old-value"]')).toBeNull();
        expect(within(row).getAllByText("2026.09.21(월)")).toHaveLength(1);
    });

    it("drops strike rows and shows 수정 완료 when the refreshed base matches the confirmed draft", () => {
        const draft = { _date: "2026-09-22", breast: ["울혈"] };
        render(<ReviewStep {...makeProps({ draft, baseSessionDraft: draft, adminEditedSessionIndexes: new Set([1]) })} />);
        expect(document.querySelector('[data-slot="old-value"]')).toBeNull();
        expect(byComponent("body_submitted-badge")).toHaveTextContent("수정 완료");
    });

    it("keeps supplemental variants without a base free of diffs", () => {
        render(<ReviewStep {...makeProps({ draft: { breast: ["울혈"] }, baseSessionDraft: undefined, readOnly: true })} />);
        expect(document.querySelector('[data-slot="old-value"]')).toBeNull();
        expect(byComponent("body_submitted-badge")).toHaveTextContent("조회 가능");
    });

    it.each([{ busy: true }, { readOnly: true }])("keeps the date editor disabled rules", (overrides) => {
        render(<ReviewStep {...makeProps({ ...overrides, serviceDateEditor: ({ disabled, onOpen }) => <button disabled={disabled} onClick={onOpen} aria-label="제공일 수정">수정</button> })} />);
        expect(screen.getByRole("button", { name: "제공일 수정" })).toBeDisabled();
    });

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
        expect(byComponent("body_day-title")).toHaveTextContent("1회차 기록");
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

    it("lets an 80-character unbroken note wrap instead of widening the page", () => {
        render(<ReviewStep {...makeProps({ draft: { notes: "W".repeat(80) } })} />);
        const finish = screen.getByRole("region", { name: "서비스 기록" });
        const note = within(finish).getByRole("group", { name: /특이사항/ });
        const value = within(note).getByText("W".repeat(80));
        expect(value).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
        expect(note).toHaveClass("min-w-0");
    });

    it("removes the admin handover banner and keeps the resign notice absent even when editing", () => {
        render(<ReviewStep {...makeProps({ editing: true })} />);
        expect(byComponent("body_handover-banner")).toBeNull();
        expect(screen.queryByText("관리자 수정 내용을 확인해 주세요.")).toBeNull();
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
        it("goes back, and renders the service date block and editor outside the answer review", () => {
            const props = makeProps({
                editing: true,
                serviceDateEditor: ({ "data-component": component, disabled, onOpen }) => (
                    <button type="button" data-component={component} disabled={disabled} onClick={onOpen}>제공일 수정</button>
                ),
            });
            render(<ReviewStep {...props} />);

            fireEvent.click(screen.getByRole("button", { name: "이전" }));
            expect(props.onBack).toHaveBeenCalledTimes(1);
            expect(byComponent("body_date-chip")).toBeNull();
            expect(screen.getByRole("region", { name: "서비스 제공일" })).toHaveTextContent("2026.09.21(월)");
            expect(byComponent("body_service-date")).toContainElement(byComponent("body_date-edit"));
            expect(document.querySelector('[data-slot="review"]')).not.toContainElement(byComponent("body_date-edit"));
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
