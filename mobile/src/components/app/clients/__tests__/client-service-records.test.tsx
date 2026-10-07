import type { ReactElement } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildCalendarFromHolidayYears } from "@babyjamjam/shared/utils/holiday-calendar";

import { ClientServiceRecords } from "../client-service-records";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { toast } from "@/hooks/use-toast";
import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import type { Client } from "@/lib/client/types";
import type {
    ServiceRecordAssignment,
    ServiceRecordCase,
    ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

const mockMutateAsync = jest.fn();
const mockUseGetAuthUser = jest.fn();
const TEST_COMPONENT =
    "mobile_clients_detail-sheet_stack_detail-page_content_tab-panel_service-records_content";
const TEST_START_DATE = "2026-07-16T00:00:00+09:00";
const TEST_END_DATE = "2026-07-30T00:00:00+09:00";
const TEST_SCHEDULED_FOR = "2026-07-16T15:00:00+09:00";
const TEST_LAST_SENT_AT = "2026-07-16T15:02:00+09:00";
const TEST_VERIFIED_AT = "2026-07-16T15:10:00+09:00";
const TEST_EXPIRY = "2026-07-30T20:00:00+09:00";

jest.mock("@/hooks/useServiceRecords", () => ({
    useSendServiceRecordLink: () => ({
        isPending: false,
        mutateAsync: mockMutateAsync,
    }),
}));

// Records every render's modal props so a test can call a handler captured from an
// older render, the way a click handler that outlived a refresh would.
const mockResendModalRenders: Array<{ onApprove: () => void | Promise<void> }> = [];
jest.mock("@/components/app/ui/ApprovalTwoButtonModal", () => {
    const actual = jest.requireActual("@/components/app/ui/ApprovalTwoButtonModal");
    const React = jest.requireActual("react");
    return {
        ...actual,
        ApprovalTwoButtonModal: (props: { onApprove: () => void | Promise<void> }) => {
            mockResendModalRenders.push(props);
            return React.createElement(actual.ApprovalTwoButtonModal, props);
        },
    };
});

jest.mock("@/hooks/use-toast", () => ({
    toast: jest.fn(),
}));

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => mockUseGetAuthUser(),
}));

const mockUseBusinessDayCalendar = useBusinessDayCalendar as jest.Mock;
const builtinCalendarResult = {
    calendar: KR_BUILTIN_CALENDAR,
    ready: true,
    error: null,
    retry: jest.fn(),
    refreshForSave: async () => ({ ok: true, calendar: KR_BUILTIN_CALENDAR, changed: false }),
    version: KR_BUILTIN_CALENDAR.version,
};

const client = {
    id: 100,
    name: "고명순",
} as Client;

function createAssignment(
    scheduleId: number,
    status: ServiceRecordAssignment["link"]["status"],
    sessions: ServiceRecordAssignment["sessions"] = [],
): ServiceRecordAssignment {
    return {
        scheduleId,
        startDate: TEST_START_DATE,
        endDate: TEST_END_DATE,
        replaced: false,
        employee: {
            id: scheduleId,
            name: `제공${scheduleId}`,
            phone: "01012345678",
        },
        link: {
            status,
            scheduledFor: status === "scheduled" ? TEST_SCHEDULED_FOR : null,
            sentCount: status === "none" ? 0 : 1,
            lastSentAt: status === "sent" ? TEST_LAST_SENT_AT : null,
            token: status === "none" ? null : {
                issuedAt: TEST_SCHEDULED_FOR,
                verifiedAt: status === "sent" ? TEST_VERIFIED_AT : null,
                expiresAt: TEST_EXPIRY,
                state: "active",
            },
        },
        header: null,
        totalSessions: Math.max(1, sessions.length),
        sessions,
        signatureDoc: null,
    };
}

function createRecord(status: string): ServiceRecordCase {
    return {
        id: "record-1",
        status,
        startDate: TEST_START_DATE,
        endDate: TEST_END_DATE,
        totalSessions: 1,
        completedAt: "2026-07-30T18:00:00+09:00",
        finalizationDueAt: null,
        finalizedAt: "2026-07-30T18:30:00+09:00",
        documentsCompletedAt: "2026-07-30T19:00:00+09:00",
        lastError: null,
        header: null,
        sessions: [],
        signatureDocs: [],
    };
}

function renderComponent(
    overview: ServiceRecordOverview,
    options: { isRefreshing?: boolean; onRefresh?: () => void } = {},
) {
    return render(
        <ClientServiceRecords
            data-component={TEST_COMPONENT}
            client={client}
            activeTab="serviceRecords"
            overview={overview}
            isLoading={false}
            isError={false}
            isRefreshing={options.isRefreshing}
            onRefresh={options.onRefresh}
        />,
    );
}

describe("ClientServiceRecords", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockResendModalRenders.length = 0;
        mockUseBusinessDayCalendar.mockImplementation(() => builtinCalendarResult);
        mockMutateAsync.mockResolvedValue(undefined);
        mockUseGetAuthUser.mockReturnValue({
            data: { role: "user", branchRole: "manager" },
            isPending: false,
            isLoading: false,
            isFetching: false,
            isError: false,
        });
    });

    it("renders the main link states", () => {
        renderComponent({
            assignments: [
                createAssignment(1, "none"),
                createAssignment(2, "sent"),
                createAssignment(3, "failed"),
            ],
        });

        expect(screen.getByText("발송 전")).toBeInTheDocument();
        expect(screen.getByText("발송됨")).toBeInTheDocument();
        expect(screen.getByText("발송 실패")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "제공기록지 링크 발송" })).toHaveLength(3);
        expect(screen.queryAllByText(/메시지 재전송 시/)).toHaveLength(0);
    });

    it("places the authenticated service-record edit link below the send action", () => {
        renderComponent({ assignments: [createAssignment(1, "none")] });

        const sendButton = screen.getByRole("button", { name: "제공기록지 링크 발송" });
        const editLink = screen.getByRole("link", { name: "제공기록지 수정" });

        expect(sendButton.compareDocumentPosition(editLink) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(editLink).toHaveAttribute(
            "href",
            "https://admin.babyjamjam.com/service-record-admin/100",
        );
        expect(editLink).toHaveAttribute("target", "_blank");
        expect(editLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("hides the service-record edit link for a branch user while keeping send available", () => {
        mockUseGetAuthUser.mockReturnValue({
            data: { role: "admin", branchRole: "user" },
            isPending: false,
            isLoading: false,
            isFetching: false,
            isError: false,
        });

        renderComponent({ assignments: [createAssignment(1, "none")] });

        expect(screen.queryByRole("link", { name: "제공기록지 수정" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "제공기록지 링크 발송" })).toBeEnabled();
    });

    it("adds the 7-day grace period to the fallback link-expiry shown before a link is issued", () => {
        // Assignment 1 has status "none" (link.token is null), so the
        // displayed expiry falls back to endDateExpiry(assignment.endDate).
        // endDate is TEST_END_DATE = 2026-07-30; endDateExpiry must add the
        // SERVICE_RECORD_LINK_GRACE_DAYS grace period (7 calendar days,
        // mirroring the backend constant) -> 2026-08-06 20:00 KST, not the
        // pre-grace 2026-07-30 20:00 KST.
        renderComponent({
            assignments: [createAssignment(1, "none")],
        });

        expect(screen.getByText("링크 만료").closest("div")).toHaveTextContent("2026.08.06 20:00");
    });

    it("formats the newborn birth date instead of exposing raw YYMMDD", () => {
        const assignment = createAssignment(1, "sent");
        assignment.header = {
            momName: "고명순",
            momBirth: "900101",
            babyName: "아가",
            babyBirth: "260703",
            deliveryType: "자연분만",
            babyWeight: "3.2",
            createdAt: "2026-07-03T00:00:00.000Z",
            updatedAt: "2026-07-03T00:00:00.000Z",
        };

        renderComponent({ assignments: [assignment] });

        expect(screen.getByText("신생아 출생일자").closest("div"))
            .toHaveTextContent("2026.07.03");
        expect(screen.queryByText("260703")).not.toBeInTheDocument();
    });

    it("uses the document lifecycle as the visible status once a record exists", () => {
        const { container } = renderComponent({
            record: createRecord("COMPLETED"),
            assignments: [createAssignment(1, "sent")],
        });

        const statusCard = container.querySelector(
            `[data-component="${TEST_COMPONENT}_status-card"]`,
        );

        expect(statusCard).toHaveTextContent("제공기록지 진행 상태");
        expect(statusCard).toHaveTextContent("완료");
        expect(statusCard).toHaveTextContent("전자문서 생성");
        expect(screen.queryByText("발송됨")).not.toBeInTheDocument();
    });

    it("maps completed signature status text to desktop-equivalent label", () => {
        const record = createRecord("COMPLETED");
        record.signatureDocs = [{
            documentId: "service-record-document-1",
            statusType: "050",
            statusDetail: "완료",
            stepName: "완료",
            createdDate: "2026-07-30T18:30:00+09:00",
            updatedDate: "2026-07-30T19:00:00+09:00",
            snapshotChunkIndex: 1,
        }];

        const { container } = renderComponent({
            record,
            assignments: [createAssignment(1, "sent")],
        });

        const documentCard = container.querySelector(
            `[data-component="${TEST_COMPONENT}_signature-card"]`,
        );

        expect(documentCard).toHaveTextContent("제공기록지 전자문서 1");
        expect(documentCard).toHaveTextContent("서명 완료");
        expect(documentCard).toHaveTextContent("service-record-document-1");
    });

    it("tones a rejected document from its status code, not from English keywords in the Korean detail", () => {
        const record = createRecord("DOCUMENTS_CREATED");
        record.signatureDocs = [{
            documentId: "service-record-document-rejected",
            statusType: "071",
            statusDetail: "검토 반려",
            stepName: "제공기관 검토",
            createdDate: "2026-07-30T18:30:00+09:00",
            updatedDate: "2026-07-30T19:00:00+09:00",
            snapshotChunkIndex: 1,
        }];

        renderComponent({ record, assignments: [createAssignment(1, "sent")] });

        const label = screen.getByText("검토 반려");
        expect(label).toHaveClass("info-row-value-burgundy");
        expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    });

    it("shows an in-progress document with its Korean detail and a primary tone", () => {
        const record = createRecord("DOCUMENTS_CREATED");
        record.signatureDocs = [{
            documentId: "service-record-document-review",
            statusType: "070",
            statusDetail: "검토 요청",
            stepName: "제공기관 검토",
            createdDate: "2026-07-30T18:30:00+09:00",
            updatedDate: "2026-07-30T19:00:00+09:00",
            snapshotChunkIndex: 1,
        }];

        renderComponent({ record, assignments: [createAssignment(1, "sent")] });

        expect(screen.getByText("검토 요청")).toHaveClass("info-row-value-primary");
    });

    it("shows the document lifecycle even when no assignment remains", () => {
        renderComponent({
            record: createRecord("DOCUMENTS_CREATED"),
            assignments: [],
        });

        expect(screen.getByText("기관 검토 중")).toBeInTheDocument();
        expect(screen.queryByText("제공기록지 배정 정보가 없습니다.")).not.toBeInTheDocument();
    });

    it("places the refresh action before the submission progress and refreshes the data", async () => {
        const user = userEvent.setup();
        const onRefresh = jest.fn();
        renderComponent({
            assignments: [createAssignment(1, "sent")],
        }, { onRefresh });

        const refreshButton = screen.getByRole("button", { name: "제공기록 새로고침" });
        const progress = screen.getByText("0/1 제출완료");

        expect(
            refreshButton.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        await user.click(refreshButton);

        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("opens a confirmation modal before resending a link", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(2, "sent"),
            ],
        });

        await user.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));

        expect(screen.getByRole("dialog", { name: "제공기록지 메시지를 재전송하시겠습니까?" })).toBeInTheDocument();
        expect(screen.getByText("기존 링크가 그대로 포함된 메시지를 다시 전송합니다.")).toBeInTheDocument();
        expect(mockMutateAsync).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "메시지 재전송" }));

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith({
                scheduleId: 2,
                clientId: 100,
            });
        });
    });

    describe("resend confirmation while the link starts sending", () => {
        const RESEND_DIALOG = "제공기록지 메시지를 재전송하시겠습니까?";
        const rerenderWith = (
            rerender: (ui: ReactElement) => void,
            status: ServiceRecordAssignment["link"]["status"],
        ) => rerender(
            <ClientServiceRecords
                data-component={TEST_COMPONENT}
                client={client}
                activeTab="serviceRecords"
                overview={{ assignments: [createAssignment(1, status)] }}
                isLoading={false}
                isError={false}
            />,
        );

        it("disables the approve button with the sending reason and never sends", async () => {
            const user = userEvent.setup();
            mockMutateAsync.mockResolvedValue({ status: "sent", ok: true });
            const { rerender } = renderComponent({ assignments: [createAssignment(1, "sent")] });
            await user.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));
            expect(screen.getByRole("dialog", { name: RESEND_DIALOG })).toBeInTheDocument();

            rerenderWith(rerender, "sending");

            const dialog = screen.getByRole("dialog", { name: RESEND_DIALOG });
            const approve = within(dialog).getByRole("button", { name: "메시지 재전송" });
            expect(approve).toBeDisabled();
            expect(within(dialog).getByText(/발송 처리 중이에요/)).toBeInTheDocument();
            await user.click(approve);
            expect(mockMutateAsync).not.toHaveBeenCalled();
        });

        it("does not send from an approve handler captured before the refresh", async () => {
            const user = userEvent.setup();
            mockMutateAsync.mockResolvedValue({ status: "sent", ok: true });
            const { rerender } = renderComponent({ assignments: [createAssignment(1, "failed")] });
            await user.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));
            const staleApprove = mockResendModalRenders[mockResendModalRenders.length - 1].onApprove;

            rerenderWith(rerender, "sending");
            await act(async () => {
                await staleApprove();
            });

            expect(mockMutateAsync).not.toHaveBeenCalled();
        });
    });

    describe("send-now result", () => {
        const sendFirstLink = async (result: { ok: boolean; status: string }) => {
            const user = userEvent.setup();
            mockMutateAsync.mockResolvedValue({
                jobId: "job-manual",
                scheduledFor: TEST_SCHEDULED_FOR,
                ...result,
            });
            renderComponent({ assignments: [createAssignment(1, "none")] });

            await user.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));
            await waitFor(() => expect(toast).toHaveBeenCalled());
        };

        it.each(["failed", "canceled"])("shows the failure toast, not the success one, when the job ended %s", async (status) => {
            await sendFirstLink({ ok: false, status });

            expect(toast).toHaveBeenCalledTimes(1);
            expect(toast).toHaveBeenCalledWith({
                variant: "destructive",
                description: "제공기록지 링크 발송에 실패했어요",
            });
            expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ description: "제공기록지 링크를 보냈어요" }));
        });

        it.each(["processing", "dispatching"])("shows a neutral in-progress toast while the job is %s", async (status) => {
            await sendFirstLink({ ok: false, status });

            expect(toast).toHaveBeenCalledTimes(1);
            expect(toast).toHaveBeenCalledWith({ description: "발송 처리 중이에요" });
        });

        it("shows a neutral deferred toast when the job went back to pending", async () => {
            await sendFirstLink({ ok: false, status: "pending" });

            expect(toast).toHaveBeenCalledTimes(1);
            expect(toast).toHaveBeenCalledWith({ description: "잠시 후 다시 발송돼요" });
        });

        it("shows the success toast only when the job was sent", async () => {
            await sendFirstLink({ ok: true, status: "sent" });

            expect(toast).toHaveBeenCalledTimes(1);
            expect(toast).toHaveBeenCalledWith({
                variant: "success",
                description: "제공기록지 링크를 보냈어요",
            });
        });
    });

    it("labels an in-flight link as sending without switching to the resend flow", async () => {
        const user = userEvent.setup();
        renderComponent({ assignments: [createAssignment(1, "sending")] });

        expect(screen.getByText("발송 중")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "제공기록지 링크 발송" }));

        expect(screen.queryByRole("dialog", { name: "제공기록지 메시지를 재전송하시겠습니까?" })).not.toBeInTheDocument();
    });

    it("disables the send button with a reason while a link is sending, so staff cannot double-send", async () => {
        const user = userEvent.setup();
        renderComponent({ assignments: [createAssignment(1, "sending")] });

        const sendButton = screen.getByRole("button", { name: "제공기록지 링크 발송" });
        expect(sendButton).toBeDisabled();
        expect(screen.getByText(/발송 처리 중이에요/)).toBeInTheDocument();

        await user.click(sendButton);
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it("keeps send-now available for a scheduled link", () => {
        renderComponent({ assignments: [createAssignment(1, "scheduled")] });

        expect(screen.getByRole("button", { name: "제공기록지 링크 발송" })).toBeEnabled();
        expect(screen.queryByText(/발송 처리 중이에요/)).not.toBeInTheDocument();
    });

    it("opens a submitted session detail from the session list", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(1, "sent", [
                    {
                        sessionIndex: 1,
                        serviceDate: TEST_START_DATE,
                        locked: true,
                        submittedAt: "2026-07-16T18:42:00+09:00",
                        updatedAt: "2026-07-16T18:42:00+09:00",
                        answers: {
                            perineum: ["열상"],
                            breast: ["이상없음"],
                            meals_meal: 3,
                            meals_snack: 1,
                        },
                        etcService: "피부 트러블 없음",
                        notes: "산모 회복 양호",
                        paymentConfirmed: true,
                        hasMomApproval: true,
                    },
                ]),
            ],
        });

        await user.click(screen.getByText(/1회차 ·/));

        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        const backButton = screen.getByRole("button", { name: "목록으로" });
        expect(backButton).toBeInTheDocument();
        expect(backButton.querySelector("span")).toHaveTextContent("‹");
        expect(screen.getByText("완료")).toBeInTheDocument();
        expect(screen.queryByText("✓ 완료")).not.toBeInTheDocument();
    });

    it("opens an empty detail for an unsubmitted session", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(1, "sent"),
            ],
        });

        await user.click(screen.getByRole("button", { name: /1회차/ }));

        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        expect(screen.getAllByText("-").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", { name: "목록으로" })).toBeInTheDocument();
    });

    it("resets the mobile detail scroll before opening a session", async () => {
        const user = userEvent.setup();
        const animationFrame = jest.spyOn(window, "requestAnimationFrame")
            .mockImplementation((callback) => {
                callback(0);
                return 1;
            });

        const { container } = render(
            <div className="detail-body">
                <ClientServiceRecords
                    data-component={TEST_COMPONENT}
                    client={client}
                    activeTab="serviceRecords"
                    overview={{ assignments: [createAssignment(1, "sent")] }}
                    isLoading={false}
                    isError={false}
                />
            </div>,
        );
        const scrollContainer = container.querySelector(".detail-body") as HTMLDivElement;
        scrollContainer.scrollTop = 480;

        await user.click(screen.getByRole("button", { name: /1회차/ }));

        expect(scrollContainer.scrollTop).toBe(0);
        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        animationFrame.mockRestore();
    });

    it("shows expected session dates from the branch calendar", () => {
        const assignment = { ...createAssignment(1, "none"), totalSessions: 3 };
        // 2026-07-17 is already a public holiday; 2026-07-21 (Tue) is a branch-added day off, so session 3 moves to 07-22.
        const branchCalendar = buildCalendarFromHolidayYears([
            { year: 2026, revision: 2, supported: true, holidays: [
                { date: "2026-07-17", name: "제헌절" },
                { date: "2026-07-21", name: "지점 휴무" },
            ] },
        ]);

        const { unmount } = renderComponent({ assignments: [assignment] });
        expect(screen.getAllByText(/예정일/).map((node) => node.textContent)).toEqual([
            "예정일 2026.07.16", "예정일 2026.07.20", "예정일 2026.07.21",
        ]);
        unmount();

        mockUseBusinessDayCalendar.mockImplementation(() => ({
            ...builtinCalendarResult,
            calendar: branchCalendar,
            version: branchCalendar.version,
        }));
        renderComponent({ assignments: [assignment] });
        expect(screen.getAllByText(/예정일/).map((node) => node.textContent)).toEqual([
            "예정일 2026.07.16", "예정일 2026.07.20", "예정일 2026.07.22",
        ]);
        // The hook is asked for the years of the assignment's own dates.
        expect(mockUseBusinessDayCalendar).toHaveBeenCalledWith({ extraYears: expect.arrayContaining([2026, 2027]) });
    });
});
