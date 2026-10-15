import { fireEvent, render, screen, within } from "@testing-library/react";
import { DAY_PAGES, DEFAULT_DAILY_ANSWERS, type ServiceRecordWizardProps } from "@babyjamjam/service-record-ui";

import { AdminServiceRecordScreen } from "../AdminServiceRecordScreen";

const ROOT = "desktop_service-record-admin_wizard";
const CONFIRMATION_PAGE = DAY_PAGES.length - 1;

const makeProps = (overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps => ({
    "data-component": ROOT,
    screen: "overview",
    phone: "",
    phoneError: null,
    context: {
        totalSessions: 3,
        startDate: "2026-09-21",
        header: null,
        org: { name: "인천 한마음" },
        employee: { id: 1, name: "박제공" },
        sessions: [{ sessionIndex: 1, serviceDate: "2026-09-21", locked: true, submittedAt: "2026-09-21T10:00:00.000Z" }],
    },
    header: {
        momName: "김산모", momBirth: "1990-01-01", babyName: "김아기",
        babyBirth: "2026-07-14", deliveryType: "자연분만", babyWeight: "3.2",
    },
    day: 1,
    pageIdx: 0,
    draft: { ...DEFAULT_DAILY_ANSWERS },
    editing: true,
    readOnly: false,
    adminMode: true,
    clientSignature: null,
    busy: false,
    isRecordFinalized: false,
    lockedDays: new Set([1]),
    nextOpenDay: () => 1,
    scheduleChangeBusy: false,
    hasServiceDateMismatch: false,
    defaultDate: (index) => `2026-09-${20 + index}`,
    onPhoneChange: jest.fn(),
    onSubmitPhone: jest.fn(),
    onBack: jest.fn(),
    onHeaderChange: jest.fn(),
    onDeliveryTypeChange: jest.fn(),
    onSaveHeader: jest.fn(),
    onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(),
    onOpenServiceDateEditor: jest.fn(),
    onServiceDateChange: jest.fn(),
    onFieldChange: jest.fn(),
    onToggleMulti: jest.fn(),
    onSignatureChange: jest.fn(),
    onNextPage: jest.fn(),
    onOpenSubmitModal: jest.fn(),
    onEditSection: jest.fn(),
    ...overrides,
});

const byComponent = (suffix: string) => document.querySelector(`[data-component="${ROOT}_${suffix}"]`) as HTMLElement | null;

describe("AdminServiceRecordScreen", () => {
    describe("frame", () => {
        it("is a full-width, viewport-tall white column and keeps the caller's data-component", () => {
            const { container } = render(<AdminServiceRecordScreen {...makeProps()} />);
            const root = container.firstElementChild as HTMLElement;
            expect(root).toHaveAttribute("data-component", ROOT);
            expect(root).toHaveClass("flex", "min-h-dvh", "flex-col", "bg-white");
            expect(root.className).not.toMatch(/max-w-\[480px\]|max-w-md/);
        });

        it("titles the screen with the shared wizard's copy and puts the provider slot in the header's meta", () => {
            const provider = jest.fn(({ "data-component": component }) => <span data-component={component} data-slot="provider">관리자 편집</span>);
            render(<AdminServiceRecordScreen {...makeProps({ slots: { provider } })} />);

            expect(screen.getByRole("heading", { level: 1, name: "산모·신생아 건강관리 서비스 제공기록지" })).toBeInTheDocument();
            expect(provider).toHaveBeenCalledWith({ "data-component": `${ROOT}_top-bar_meta_provider-name`, providerName: "인천 한마음" });
            const header = byComponent("top-bar")!;
            expect(header).toHaveAttribute("data-source-component", "ServiceRecordStepHeader");
            expect(within(header).getByText("관리자 편집")).toHaveAttribute("data-slot", "provider");
        });

        it.each([
            ["service", 0, "2단계 · 서비스 기본정보", 12],
            ["overview", 0, "3단계 · 일자별 기록", 20],
            ["day", 0, "1회차 · 산모 기록 (1/4)", 20 + Math.round((1 / DAY_PAGES.length) * 70)],
            ["day", CONFIRMATION_PAGE, `1회차 · ${DAY_PAGES[CONFIRMATION_PAGE].title} (${DAY_PAGES.length}/${DAY_PAGES.length})`, 20 + 70],
        ] as const)("shows the crumbs and the progress of the %s screen (page %i)", (screenName, pageIdx, crumbs, progress) => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: screenName, pageIdx })} />);

            expect(byComponent("top-bar_meta-row_crumbs")).toHaveTextContent(crumbs);
            // The package returns 0-100, the header takes 0..1.
            expect(screen.getByRole("progressbar", { name: "진행률" })).toHaveAttribute("aria-valuenow", String(progress));
        });

        it("renders the admin toolbar, the modals and the error notification where the shared wizard does", () => {
            render(<AdminServiceRecordScreen {...makeProps({
                slots: {
                    adminToolbar: <span>툴바</span>,
                    submitModal: <div role="dialog" aria-label="제출 확인" />,
                    scheduleChangeModal: <div role="dialog" aria-label="일정 변경" />,
                    serviceDateChangeModal: <div role="dialog" aria-label="제공일 변경" />,
                    errorNotification: <div role="status">오류 알림</div>,
                },
            })} />);

            expect(byComponent("top-bar_admin-toolbar")).toHaveAttribute("data-slot", "admin-toolbar");
            expect(byComponent("top-bar_admin-toolbar")).toHaveTextContent("툴바");
            for (const name of ["제출 확인", "일정 변경", "제공일 변경"]) expect(screen.getByRole("dialog", { name })).toBeInTheDocument();
            expect(screen.getByRole("status")).toHaveTextContent("오류 알림");
        });

        it("shows the planned-date error on any screen once the server vector is provided but invalid", () => {
            const base = makeProps().context!;
            const { rerender } = render(<AdminServiceRecordScreen {...makeProps({ context: { ...base, plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-21" }] } })} />);
            // Vector length differs from totalSessions: invalid.
            expect(screen.getByRole("alert")).toHaveTextContent("서버 일정 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.");
            expect(byComponent("body_planned-date-error")).toBe(screen.getByRole("alert"));

            rerender(<AdminServiceRecordScreen {...makeProps({ screen: "service", context: { ...base, plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-21" }] } })} />);
            expect(screen.getByRole("alert")).toBeInTheDocument();

            rerender(<AdminServiceRecordScreen {...makeProps({ context: base })} />);
            expect(screen.queryByRole("alert")).toBeNull();
        });
    });

    describe("service (기본정보)", () => {
        it("renders the step with its fields, passing headerErrors and readOnly through", () => {
            const onHeaderChange = jest.fn();
            render(<AdminServiceRecordScreen {...makeProps({
                screen: "service",
                header: { momName: "김산모", momBirth: "1990-01-01", babyName: "김아기", babyBirth: "2026-02-30", deliveryType: "자연분만", babyWeight: "3.2" },
                headerErrors: { babyBirth: "존재하지 않는 날짜예요" },
                onHeaderChange,
            })} />);

            expect(byComponent("body_service-title")).toHaveTextContent("서비스 기본정보");
            expect(byComponent("body")).toHaveAttribute("data-source-component", "ServiceInfoStep");
            const birth = screen.getByLabelText("신생아 출생일자");
            expect(birth).toHaveValue("2026-02-30");
            expect(document.getElementById(birth.getAttribute("aria-describedby")!)).toHaveTextContent("존재하지 않는 날짜예요");
            fireEvent.change(screen.getByLabelText("산모 성명"), { target: { value: "이예지" } });
            expect(onHeaderChange).toHaveBeenCalledWith("momName", "이예지");
        });

        it("is inert when read-only", () => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: "service", readOnly: true })} />);
            expect(screen.getByLabelText("산모 성명")).toBeDisabled();
            expect(screen.getByRole("button", { name: "자연분만" })).toBeDisabled();
        });

        it("hands the adminHeaderAction slot the resolved state and renders it in the bar", () => {
            const adminHeaderAction = jest.fn(({ isHeaderComplete }: { isHeaderComplete: boolean }) => <button type="button">{isHeaderComplete ? "완료" : "미완료"}</button>);
            render(<AdminServiceRecordScreen {...makeProps({ screen: "service", slots: { adminHeaderAction } })} />);
            expect(within(byComponent("body_service-actions")!).getByRole("button", { name: "완료" })).toBeInTheDocument();
        });

        it("goes back and keeps the field state across a visit to another screen", () => {
            const props = makeProps({ screen: "service" });
            const { rerender } = render(<AdminServiceRecordScreen {...props} />);
            fireEvent.click(screen.getByRole("button", { name: "이전" }));
            expect(props.onBack).toHaveBeenCalledTimes(1);

            rerender(<AdminServiceRecordScreen {...props} screen="overview" />);
            expect(byComponent("body_overview-title")).toBeInTheDocument();
            expect(screen.queryByLabelText("산모 성명")).toBeNull();
            rerender(<AdminServiceRecordScreen {...props} screen="service" />);
            expect(screen.getByLabelText("산모 성명")).toHaveValue("김산모");
        });

        it("renders no step without a loaded context", () => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: "service", context: null })} />);
            expect(byComponent("body")).toBeNull();
        });
    });

    describe("overview", () => {
        it("renders the day cards, labelling a pending edit 수정됨", () => {
            render(<AdminServiceRecordScreen {...makeProps({ changedSessionIndexes: new Set([2]) })} />);

            const days = document.querySelectorAll('[data-slot="day"]');
            expect(days).toHaveLength(3);
            expect(days[0]).toHaveTextContent("제출완료");
            expect(days[1]).toHaveTextContent("수정됨");
            expect(days[2]).toHaveTextContent("편집 가능");
        });

        it("opens a day", () => {
            const props = makeProps();
            render(<AdminServiceRecordScreen {...props} />);
            fireEvent.click(document.querySelectorAll('[data-slot="day"]')[1]);
            expect(props.onOpenDay).toHaveBeenCalledWith(2, false);
        });

        it("puts the 기본정보 수정 action at the bar's leading end and the commit actions after it, the supplemental node in the body", () => {
            render(<AdminServiceRecordScreen {...makeProps({
                slots: {
                    adminConfirmAction: <button type="button">기본정보 수정</button>,
                    adminCommitActions: <><button type="button">수정 취소</button><button type="button">수정 확정</button></>,
                    overviewSupplemental: <p>같은 회차의 추가 기록</p>,
                },
            })} />);

            const bar = byComponent("body_overview-bar")!;
            expect(within(byComponent("body_overview-bar_leading")!).getByRole("button", { name: "기본정보 수정" })).toBeInTheDocument();
            expect(within(bar).getAllByRole("button").map((button) => button.textContent)).toEqual(["기본정보 수정", "수정 취소", "수정 확정"]);
            expect(byComponent("body")).toHaveTextContent("같은 회차의 추가 기록");
            expect(bar).not.toHaveTextContent("같은 회차의 추가 기록");
        });
    });

    describe("day", () => {
        it("renders an input page with 다음, and 다음 calls onNextPage", () => {
            const props = makeProps({ screen: "day", pageIdx: 0 });
            render(<AdminServiceRecordScreen {...props} />);

            expect(byComponent("body")).toHaveAttribute("data-source-component", "DayPageStep");
            expect(byComponent("body_day-title")).toHaveTextContent("산모 기록");
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
            expect(props.onNextPage).toHaveBeenCalledTimes(1);
        });

        it("renders the date chip, the date editor slot and the display slot beside it", () => {
            const onOpenServiceDateEditor = jest.fn();
            render(<AdminServiceRecordScreen {...makeProps({
                screen: "day",
                onOpenServiceDateEditor,
                slots: {
                    serviceDateDisplay: ({ "data-component": component, serviceDate }) => <span data-component={component} data-slot="date-display">{serviceDate}</span>,
                    serviceDateEditor: ({ "data-component": component, disabled, onOpen }) => (
                        <button type="button" data-component={component} data-slot="sec-edit" disabled={disabled} onClick={onOpen}>수정</button>
                    ),
                },
            })} />);

            expect(byComponent("body_date-chip")).toHaveTextContent("1회차 · 2026-09-21");
            expect(byComponent("body_date-chip_date-display")).toBeInTheDocument();
            fireEvent.click(byComponent("body_date-edit")!);
            expect(onOpenServiceDateEditor).toHaveBeenCalledWith(1);
        });

        it("renders the confirmation page with the handover banner, the signature slot and the admin session action in the bar", () => {
            const props = makeProps({
                screen: "day",
                pageIdx: CONFIRMATION_PAGE,
                slots: {
                    signature: ({ "data-component": component, value }) => <div data-component={component}>{value ? "서명 있음" : "서명 없음"}</div>,
                    adminSessionAction: ({ hasInvalidNumericAnswers }) => <button type="button" disabled={hasInvalidNumericAnswers}>수정 확인</button>,
                },
            });
            render(<AdminServiceRecordScreen {...props} />);

            expect(byComponent("body")).toHaveAttribute("data-source-component", "ReviewStep");
            expect(byComponent("body_handover-banner")).toHaveTextContent("관리자 수정 내용을 확인해 주세요.");
            expect(byComponent("body_mom-sign")).toHaveTextContent("서명 없음");
            expect(within(byComponent("body_confirmation-action")!).getByRole("button", { name: "수정 확인" })).toBeEnabled();
            fireEvent.click(screen.getByRole("button", { name: "산모 수정" }));
            expect(props.onEditSection).toHaveBeenCalledWith(0);
        });

        it("disables the session action for an invalid number, as the shared wizard's slot argument says", () => {
            render(<AdminServiceRecordScreen {...makeProps({
                screen: "day",
                pageIdx: CONFIRMATION_PAGE,
                draft: { ...DEFAULT_DAILY_ANSWERS, meals_meal: "-1" },
                slots: { adminSessionAction: ({ hasInvalidNumericAnswers }) => <button type="button" disabled={hasInvalidNumericAnswers}>수정 확인</button> },
            })} />);
            expect(screen.getByRole("button", { name: "수정 확인" })).toBeDisabled();
        });

        it("renders no action in the bar when the caller passes none (the shared wizard's fallback button is not built)", () => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: "day", pageIdx: CONFIRMATION_PAGE })} />);
            expect(byComponent("body_confirmation-action")).toBeEmptyDOMElement();
        });

        it("hides the section edit buttons while read-only", () => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: "day", pageIdx: CONFIRMATION_PAGE, readOnly: true })} />);
            expect(document.querySelector('[data-slot="review"] [data-slot="sec-edit"]')).toBeNull();
        });
    });

    describe("screens the admin editor never reaches", () => {
        it.each(["loading", "invalid", "phone", "done"] as const)("renders only the header for %s", (screenName) => {
            render(<AdminServiceRecordScreen {...makeProps({ screen: screenName })} />);

            expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
            expect(byComponent("body")).toBeNull();
            expect(screen.queryByRole("textbox")).toBeNull();
            expect(screen.queryByRole("button")).toBeNull();
        });
    });
});
