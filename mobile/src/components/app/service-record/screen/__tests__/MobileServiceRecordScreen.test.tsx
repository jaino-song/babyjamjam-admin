import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_DAILY_ANSWERS } from "@babyjamjam/service-record-ui";

import { MobileServiceRecordScreen, type MobileServiceRecordScreenProps } from "../MobileServiceRecordScreen";

// jsdom has no canvas: a stand-in for the signature pad.
jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: () => <div>서명 입력</div>,
}));

const ROOT = "mobile_service-record_wizard";
const q = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`);

const makeProps = (overrides: Partial<MobileServiceRecordScreenProps> = {}): MobileServiceRecordScreenProps => ({
    "data-component": ROOT, screen: "overview", phone: "", phoneError: null,
    context: { totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [], org: { name: "테스트 기관" } },
    header: {}, day: 1, pageIdx: 0, draft: { ...DEFAULT_DAILY_ANSWERS }, editing: false, clientSignature: null,
    busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
    scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: (day) => `2026-09-${20 + day}`,
    onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
});

describe("MobileServiceRecordScreen", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-21T00:00:00Z")); });
    afterEach(() => jest.useRealTimers());

    describe("status screens and the header", () => {
        it("shows the loading copy", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "loading", context: null })} />);
            expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
        });

        it("shows the invalid-link state", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "invalid", context: null })} />);
            expect(q("body_invalid-center_title")).toHaveTextContent("링크를 사용할 수 없습니다");
            expect(screen.getByText("만료되었거나 더 이상 유효하지 않은 링크입니다. 지점에 문의해 주세요.")).toBeInTheDocument();
        });

        it("shows the completion state with the final crumb and a full progress bar", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "done" })} />);
            expect(screen.getByRole("heading", { name: "제공기록지 제출이 완료되었습니다." })).toBeInTheDocument();
            expect(screen.getByText("✅")).toBeInTheDocument();
            expect(within(q("top-bar") as HTMLElement).getByText("최종 제출 완료")).toBeInTheDocument();
            expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        });

        it("renders the title, the provider and the crumb of each step", () => {
            const { rerender } = render(<MobileServiceRecordScreen {...makeProps({ screen: "phone", context: null })} />);
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("산모·신생아 건강관리 서비스 제공기록지");
            expect(q("top-bar_meta_provider-name")).toHaveTextContent("인천 아이미래로");
            expect(q("top-bar")).toHaveTextContent("1단계 · 본인 확인");
            rerender(<MobileServiceRecordScreen {...makeProps({ screen: "service" })} />);
            expect(q("top-bar_meta_provider-name")).toHaveTextContent("테스트 기관");
            expect(q("top-bar")).toHaveTextContent("2단계 · 서비스 기본정보");
            rerender(<MobileServiceRecordScreen {...makeProps({ screen: "overview" })} />);
            expect(q("top-bar")).toHaveTextContent("3단계 · 일자별 기록");
            expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
            rerender(<MobileServiceRecordScreen {...makeProps({ screen: "day", day: 2, pageIdx: 1 })} />);
            expect(q("top-bar")).toHaveTextContent("2회차 · 신생아 기록 (2/4)");
        });

        it("alerts about an unreadable planned-date vector above the step", () => {
            render(<MobileServiceRecordScreen {...makeProps({
                context: { totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [], plannedSessionDates: [] },
            })} />);
            expect(screen.getByRole("alert")).toHaveTextContent("서버 일정 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.");
            expect(q("body_planned-date-error")).not.toBeNull();
        });

        it("renders the four modal slots after the step", () => {
            render(<MobileServiceRecordScreen {...makeProps({
                slots: {
                    submitModal: <i>submit-slot</i>, scheduleChangeModal: <i>schedule-slot</i>,
                    serviceDateChangeModal: <i>date-slot</i>, errorNotification: <i>error-slot</i>,
                },
            })} />);
            for (const text of ["submit-slot", "schedule-slot", "date-slot", "error-slot"]) {
                expect(screen.getByText(text)).toBeInTheDocument();
            }
        });
    });

    describe("phone step", () => {
        it("shows 확인 중… while busy and disables the submit", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "phone", context: null, busy: true })} />);
            expect(screen.getByRole("button", { name: "확인 중…" })).toBeDisabled();
        });

        it("forwards typing to onPhoneChange", () => {
            const props = makeProps({ screen: "phone", context: null });
            render(<MobileServiceRecordScreen {...props} />);
            fireEvent.change(screen.getByLabelText("휴대폰 번호"), { target: { value: "010" } });
            expect(props.onPhoneChange).toHaveBeenCalledWith("010");
        });
    });

    describe("service step", () => {
        const header = { momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15", deliveryType: "", babyWeight: "3.2" };

        it("shows the read-only provider rows and 저장 중… while busy", () => {
            render(<MobileServiceRecordScreen {...makeProps({
                screen: "service", header, busy: true,
                context: { totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [], employee: { id: 1, name: "김제공" } },
            })} />);
            expect(q("body_readonly-row")).toHaveTextContent("김제공");
            expect(q("body_readonly-row-2")).toHaveTextContent("인천 아이미래로");
            expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
        });

        it("selects the delivery type through onDeliveryTypeChange and goes back", async () => {
            jest.useRealTimers();
            const user = userEvent.setup();
            const props = makeProps({ screen: "service", header });
            render(<MobileServiceRecordScreen {...props} />);
            await user.click(within(screen.getByRole("radiogroup", { name: "분만형태" })).getByRole("button", { name: "제왕절개" }));
            expect(props.onDeliveryTypeChange).toHaveBeenCalledWith("제왕절개");
            await user.click(screen.getByRole("button", { name: "이전" }));
            expect(props.onBack).toHaveBeenCalledTimes(1);
        });

        it("saves a complete header", () => {
            const props = makeProps({ screen: "service", header: { ...header, deliveryType: "자연분만" } });
            render(<MobileServiceRecordScreen {...props} />);
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            expect(props.onSaveHeader).toHaveBeenCalledTimes(1);
        });

        it("renders nothing for the service step without a context", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "service", context: null })} />);
            expect(q("body")).toBeNull();
        });
    });

    describe("overview step", () => {
        it("marks the open day as enterable, later days as waiting and shows no back button", () => {
            render(<MobileServiceRecordScreen {...makeProps()} />);
            const grid = q("body_day-grid") as HTMLElement;
            const cards = Array.from(grid.children) as HTMLButtonElement[];
            expect(cards).toHaveLength(3);
            expect(cards[0]).toBeEnabled();
            expect(cards[0]).toHaveTextContent("입력 가능");
            expect(cards[1]).toBeDisabled();
            expect(cards[1]).toHaveTextContent("대기");
            expect(q("body_day-grid_day_number")).toHaveTextContent("1");
            expect(q("body_overview-back")).toBeNull();
            expect(screen.getByRole("button", { name: "기록 시작" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "서비스 일정 변경" })).toBeEnabled();
        });

        it("opens a submitted day for editing and the next open day from the action bar", async () => {
            jest.useRealTimers();
            const user = userEvent.setup();
            const props = makeProps({ lockedDays: new Set([1]), nextOpenDay: () => 2 });
            render(<MobileServiceRecordScreen {...props} />);
            const cards = Array.from((q("body_day-grid") as HTMLElement).children) as HTMLButtonElement[];
            expect(cards[0]).toHaveTextContent("제출완료");
            await user.click(cards[0]);
            expect(props.onOpenDay).toHaveBeenCalledWith(1, true);
            await user.click(screen.getByRole("button", { name: "다음 회차 입력" }));
            expect(props.onOpenDay).toHaveBeenLastCalledWith(2);
        });

        it("disables every card and action once the record is finalized", () => {
            render(<MobileServiceRecordScreen {...makeProps({ isRecordFinalized: true, lockedDays: new Set([1]), nextOpenDay: () => 2 })} />);
            for (const card of Array.from((q("body_day-grid") as HTMLElement).children)) expect(card).toBeDisabled();
            expect(screen.getByRole("button", { name: "다음 회차 입력" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "서비스 일정 변경" })).toBeDisabled();
        });

        it("shows the pending label and disables the schedule change while a request waits", () => {
            render(<MobileServiceRecordScreen {...makeProps({
                context: {
                    totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [],
                    pendingScheduleChange: { id: "p", sessionIndex: 1, fromDate: "2026-09-21", toDate: "2026-09-22" },
                },
            })} />);
            expect(screen.getByRole("button", { name: "일정 변경 요청 대기 중" })).toBeDisabled();
        });

        it("has no action bar once every session is submitted", () => {
            render(<MobileServiceRecordScreen {...makeProps({ lockedDays: new Set([1, 2, 3]) })} />);
            expect(q("body_overview-actions")).toBeNull();
            expect(screen.queryByRole("button", { name: "기록 시작" })).toBeNull();
        });

        it("names each day card by its date", () => {
            render(<MobileServiceRecordScreen {...makeProps()} />);
            const first = (q("body_day-grid") as HTMLElement).children[0];
            expect(first).toHaveAccessibleName(expect.stringContaining("9.21"));
        });
    });

    describe("day pages", () => {
        it("keeps what was typed in the service date across the review page and back", () => {
            const props = makeProps({ screen: "day", day: 1, pageIdx: 0 });
            const { rerender } = render(<MobileServiceRecordScreen {...props} />);
            const date = screen.getByLabelText("제공일자");
            fireEvent.change(date, { target: { value: "2026092" } });
            fireEvent.blur(date);
            expect(date).toHaveValue("2026-09-2");
            expect(document.getElementById("service-record-date-helper")).toHaveTextContent("8자리로 입력해 주세요");

            rerender(<MobileServiceRecordScreen {...props} pageIdx={3} />);
            expect(screen.queryByLabelText("제공일자")).toBeNull();
            expect(q("body_handover-banner")).not.toBeNull();

            rerender(<MobileServiceRecordScreen {...props} pageIdx={0} />);
            expect(screen.getByLabelText("제공일자")).toHaveValue("2026-09-2");
            expect(document.getElementById("service-record-date-helper")).toHaveTextContent("8자리로 입력해 주세요");
        });

        it("renders one body per screen: no hidden day page next to the review", () => {
            render(<MobileServiceRecordScreen {...makeProps({ screen: "day", pageIdx: 3 })} />);
            expect(document.querySelectorAll(`[data-component="${ROOT}_body"]`)).toHaveLength(1);
            expect(screen.queryByLabelText("제공일자")).toBeNull();
        });
    });
});
