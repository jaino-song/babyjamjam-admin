import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_DAILY_ANSWERS } from "@babyjamjam/service-record-ui";

import { OverviewStep, type OverviewStepProps } from "../OverviewStep";

const ROOT = "desktop_service-record-admin_wizard";

const makeProps = (overrides: Partial<OverviewStepProps> = {}): OverviewStepProps => ({
    "data-component": ROOT,
    context: {
        totalSessions: 4,
        startDate: "2026-09-21",
        header: null,
        sessions: [
            { sessionIndex: 1, serviceDate: "2026-09-21", locked: true, submittedAt: "2026-09-21T10:00:00.000Z" },
            { sessionIndex: 2, serviceDate: "2026-09-22", locked: false },
        ],
    },
    day: 1,
    draft: { ...DEFAULT_DAILY_ANSWERS },
    readOnly: false,
    defaultDate: (index) => `2026-09-${20 + index}`,
    lockedDays: new Set([1]),
    onOpenDay: jest.fn(),
    ...overrides,
});

const days = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="day"]'));
const byComponent = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`) as HTMLElement | null;

describe("OverviewStep", () => {
    it("renders the title, the editing help and one card per session", () => {
        render(<OverviewStep {...makeProps()} />);

        expect(byComponent("body_overview-title")).toHaveTextContent("제공기록표");
        expect(byComponent("body_overview-help")).toHaveTextContent("제출된 기록은 눌러서 수정할 수 있습니다.");
        expect(days()).toHaveLength(4);
        expect(byComponent("body_day-grid")).toHaveAttribute("data-source-component", "DayCardGrid");
        expect(byComponent("body_day-grid_day_number")).toHaveTextContent("1");
        // Each card is a real button named by its text, date first.
        expect(screen.getByRole("button", { name: /2026\.09\.21/ })).toBe(days()[0]);
    });

    it("labels cards while editing: 수정됨 for a pending edit, 제출완료, 편집 가능 - none disabled", () => {
        render(<OverviewStep {...makeProps({ changedSessionIndexes: new Set([2]) })} />);

        const [first, second, third] = days();
        expect(first).toHaveTextContent("제출완료");
        expect(first).toHaveAttribute("data-state", "readonly");
        expect(second).toHaveTextContent("수정됨");
        expect(second).not.toHaveTextContent("초안 변경");
        expect(second).toHaveAttribute("data-state", "changed");
        expect(third).toHaveTextContent("편집 가능");
        expect(days().every((card) => !card.disabled)).toBe(true);
        expect(document.body).not.toHaveTextContent("초안 변경");
    });

    it("labels an edited submitted session 수정됨: an edit wins over 제출완료, as in the shared wizard", () => {
        render(<OverviewStep {...makeProps({ changedSessionIndexes: new Set([1]) })} />);
        expect(days()[0]).toHaveTextContent("수정됨");
    });

    it("read-only: 조회 가능 for a session without a submission, 제출완료 for a submitted one, never disabled", () => {
        render(<OverviewStep {...makeProps({ readOnly: true, changedSessionIndexes: new Set([2]) })} />);

        expect(byComponent("body_overview-help")).toHaveTextContent("조회 전용 기록입니다. 회차를 선택해 내용을 확인하세요.");
        const [first, second, third] = days();
        expect(first).toHaveTextContent("제출완료");
        expect(first).toHaveAttribute("data-state", "done");
        // A pending edit is not shown while read-only (SRW:846 gates it on adminEditing).
        expect(second).toHaveTextContent("조회 가능");
        expect(second).toHaveAttribute("data-state", "readonly");
        expect(third).toHaveTextContent("조회 가능");
        expect(days().every((card) => !card.disabled)).toBe(true);
    });

    it("opens a day with the session index and whether it was submitted", () => {
        const props = makeProps();
        render(<OverviewStep {...props} />);

        fireEvent.click(days()[0]);
        expect(props.onOpenDay).toHaveBeenLastCalledWith(1, true);
        fireEvent.click(days()[1]);
        expect(props.onOpenDay).toHaveBeenLastCalledWith(2, false);
    });

    it("shows the short date by default and the serviceDateDisplay slot when given", () => {
        const { rerender } = render(<OverviewStep {...makeProps()} />);
        expect(byComponent("body_day-grid_day_date")).toHaveTextContent("2026.09.21");

        const serviceDateDisplay = jest.fn(({ "data-component": component, sessionIndex, serviceDate }) => (
            <span data-component={component} data-slot="date-display">{`${sessionIndex}:${serviceDate}`}</span>
        ));
        rerender(<OverviewStep {...makeProps({ serviceDateDisplay })} />);
        expect(serviceDateDisplay).toHaveBeenCalledWith({
            "data-component": `${ROOT}_body_day-grid_day_date-display`,
            sessionIndex: 1,
            serviceDate: "2026-09-21",
        });
        expect(days()[1]).toHaveTextContent("2:2026-09-22");
    });

    it("renders the supplemental node under the grid, inside the body", () => {
        render(<OverviewStep {...makeProps({ overviewSupplemental: <p data-testid="supplemental">같은 회차의 추가 기록</p> })} />);

        const body = byComponent("body")!;
        const supplemental = screen.getByTestId("supplemental");
        expect(body).toContainElement(supplemental);
        expect(byComponent("body_day-grid")!.compareDocumentPosition(supplemental) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    describe("sticky action bar", () => {
        it("leads with the confirm action and ends with the commit actions, both in one bar below the body", () => {
            render(<OverviewStep {...makeProps({
                adminConfirmAction: <button type="button">기본정보 수정</button>,
                adminCommitActions: <><button type="button">수정 취소</button><button type="button">수정 확정</button></>,
            })} />);

            const bar = byComponent("body_overview-bar")!;
            expect(bar).toHaveAttribute("data-source-component", "StickyActionBar");
            expect(byComponent("body")).not.toContainElement(bar);
            expect(byComponent("body")!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

            const leading = byComponent("body_overview-bar_leading")!;
            const actions = document.querySelector<HTMLElement>('[data-slot="overview-actions"]')!;
            const commit = document.querySelector<HTMLElement>('[data-slot="overview-commit"]')!;
            expect(actions).toHaveAttribute("data-component", `${ROOT}_body_overview-actions`);
            expect(commit).toHaveAttribute("data-component", `${ROOT}_body_overview-commit`);
            expect(leading).toContainElement(actions);
            expect(within(actions).getByRole("button", { name: "기본정보 수정" })).toBeInTheDocument();
            expect(within(commit).getAllByRole("button").map((button) => button.textContent)).toEqual(["수정 취소", "수정 확정"]);
            expect(leading.compareDocumentPosition(commit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            // The hook wrappers add no box, so the bar lays the buttons out.
            expect(actions).toHaveClass("contents");
            expect(commit).toHaveClass("contents");
        });

        it("omits the commit wrapper when there is nothing to commit, and the whole bar when there are no actions", () => {
            const { rerender } = render(<OverviewStep {...makeProps({
                adminConfirmAction: <button type="button">기본정보 수정</button>,
                adminCommitActions: null,
            })} />);
            expect(document.querySelector('[data-slot="overview-commit"]')).toBeNull();
            expect(document.querySelector('[data-slot="overview-actions"]')).not.toBeNull();

            rerender(<OverviewStep {...makeProps()} />);
            expect(byComponent("body_overview-bar")).toBeNull();
        });

        it("never renders the public start or schedule-change buttons", () => {
            render(<OverviewStep {...makeProps({ adminConfirmAction: <button type="button">기본정보 수정</button> })} />);
            for (const name of ["기록 시작", "다음 회차 입력", "서비스 일정 변경"]) {
                expect(screen.queryByRole("button", { name })).toBeNull();
            }
        });
    });
});
