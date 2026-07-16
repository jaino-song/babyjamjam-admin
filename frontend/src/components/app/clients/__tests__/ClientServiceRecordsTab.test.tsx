import { render, screen } from "@testing-library/react";

import { ClientServiceRecordsTab } from "../ClientServiceRecordsTab";
import type { ServiceRecordAssignment, ServiceRecordOverview } from "@/features/service-records/types";

const mutateAsync = jest.fn();
const toast = jest.fn();

jest.mock("@/features/service-records/hooks/use-service-records", () => ({
    useSendServiceRecordLink: () => ({
        isPending: false,
        mutateAsync,
    }),
}));

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast }),
}));

function createAssignment(
    scheduleId: number,
    status: ServiceRecordAssignment["link"]["status"],
): ServiceRecordAssignment {
    return {
        scheduleId,
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-07-05T00:00:00.000Z",
        replaced: false,
        employee: {
            id: scheduleId,
            name: `제공${scheduleId}`,
            phone: "01012345678",
        },
        link: {
            status,
            scheduledFor: status === "scheduled" ? "2026-07-01T15:00:00+09:00" : null,
            sentCount: status === "sent" ? 1 : 0,
            lastSentAt: status === "sent" ? "2026-07-01T15:02:00+09:00" : null,
            token: {
                issuedAt: "2026-07-01T14:00:00+09:00",
                verifiedAt: status === "sent" ? "2026-07-01T15:10:00+09:00" : null,
                expiresAt: "2026-07-05T20:00:00+09:00",
                state: "active",
            },
        },
        header: null,
        totalSessions: 1,
        sessions: [],
        signatureDoc: null,
    };
}

describe("ClientServiceRecordsTab", () => {
    beforeEach(() => {
        mutateAsync.mockReset();
        toast.mockReset();
    });

    it("renders the main link states", () => {
        const overview: ServiceRecordOverview = {
            assignments: [
                createAssignment(1, "none"),
                createAssignment(2, "scheduled"),
                createAssignment(3, "sent"),
            ],
        };

        render(
            <ClientServiceRecordsTab
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByText("발송 전")).toBeInTheDocument();
        expect(screen.getByText("발송 예약")).toBeInTheDocument();
        expect(screen.getByText("발송됨")).toBeInTheDocument();
        expect(screen.getAllByText("제공기록지 작성 링크")).toHaveLength(3);
    });

    it("uses the Korean business-day calendar for empty session placeholders", () => {
        const assignment = {
            ...createAssignment(1, "none"),
            startDate: "2026-09-23T00:00:00.000Z",
            endDate: "2026-09-29T00:00:00.000Z",
            totalSessions: 2,
        };

        render(
            <ClientServiceRecordsTab
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByText("예정일 2026.09.23")).toBeInTheDocument();
        expect(screen.getByText("예정일 2026.09.29")).toBeInTheDocument();
        expect(screen.queryByText("예정일 2026.09.24")).not.toBeInTheDocument();
    });

    it("renders one continuous client record across provider replacements", () => {
        const first = { ...createAssignment(1, "sent"), replaced: true };
        const second = createAssignment(2, "sent");
        const overview: ServiceRecordOverview = {
            record: {
                id: "case-1",
                status: "IN_PROGRESS",
                startDate: "2026-07-01T00:00:00.000Z",
                endDate: "2026-07-10T00:00:00.000Z",
                totalSessions: 2,
                completedAt: null,
                finalizationDueAt: "2026-07-10T20:00:00+09:00",
                finalizedAt: null,
                documentsCompletedAt: null,
                lastError: null,
                header: {
                    momName: "산모",
                    momBirth: "960414",
                    babyName: "신생아",
                    babyBirth: "260626",
                    deliveryType: "자연분만",
                    babyWeight: "2.6",
                    createdAt: "2026-07-01T09:00:00.000Z",
                    updatedAt: "2026-07-01T09:00:00.000Z",
                },
                sessions: [
                    {
                        sessionIndex: 1,
                        serviceDate: "2026-07-01T00:00:00.000Z",
                        locked: true,
                        submittedAt: "2026-07-01T10:00:00.000Z",
                        updatedAt: "2026-07-01T10:00:00.000Z",
                        answers: {},
                        etcService: null,
                        notes: null,
                        paymentConfirmed: true,
                        hasMomApproval: true,
                        employeeName: "제공1",
                        formVersion: 1,
                    },
                    {
                        sessionIndex: 2,
                        serviceDate: "2026-07-02T00:00:00.000Z",
                        locked: false,
                        submittedAt: null,
                        updatedAt: "2026-07-02T10:00:00.000Z",
                        answers: {},
                        etcService: null,
                        notes: null,
                        paymentConfirmed: false,
                        hasMomApproval: false,
                        employeeName: "제공2",
                        formVersion: 1,
                    },
                ],
                signatureDocs: [],
            },
            assignments: [first, second],
        };

        const { container } = render(
            <ClientServiceRecordsTab
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getAllByText("제공기록지 작성 링크")).toHaveLength(1);
        expect(screen.getAllByText("서비스 기본정보")).toHaveLength(1);
        expect(screen.getAllByText("회차별 제공기록")).toHaveLength(1);
        expect(screen.getByText("제공인력 배정 이력")).toBeInTheDocument();
        expect(screen.getByText(/1회차 ·/)).toBeInTheDocument();
        expect(screen.getByText(/2회차 ·/)).toBeInTheDocument();

        const overviewGrid = container.querySelector<HTMLElement>(
            '[data-component="clients-detail-service-records-overview-grid"]',
        );
        expect(overviewGrid).toHaveClass(
            "grid",
            "grid-cols-1",
            "items-stretch",
            "lg:grid-cols-3",
            "[&>*]:content-start",
        );

        const overviewCards = Array.from(overviewGrid!.children) as HTMLElement[];
        expect(overviewCards).toHaveLength(3);
        expect(overviewCards[0]).toHaveTextContent("제공기록지 진행 상태");
        expect(overviewCards[0]).toHaveTextContent("전자문서 생성-");
        expect(overviewCards[1]).toHaveTextContent("서비스 기본정보");
        expect(overviewCards[2]).toHaveTextContent("제공기록지 작성 링크");
        expect(container).not.toHaveTextContent("양식 v1");
        expect(container).not.toHaveTextContent("제출 시점의 양식 스냅샷");
        expect(
            overviewCards[2].querySelector(
                '[data-component="clients-detail-service-records-link-card-caption"]',
            ),
        ).not.toBeInTheDocument();
        expect(overviewCards[2].querySelectorAll('[data-component="info-row"]')).toHaveLength(4);
        expect(overviewCards[2]).toHaveTextContent("제공인력 이름");
        expect(overviewCards[2]).toHaveTextContent("제공인력 연락처");
        expect(overviewCards[2]).toHaveTextContent("메시지 최근 발송");
        expect(overviewCards[2]).toHaveTextContent("제공기록지 본인 인증");
        expect(overviewCards[2]).toHaveTextContent("완료");
        expect(overviewCards[2]).not.toHaveTextContent("링크 만료");
        const resendButton = screen.getByRole("button", { name: "메시지 재전송" });
        expect(resendButton).toHaveClass("w-full");
        expect(resendButton).toHaveAttribute("data-variant", "positive");
        expect(overviewCards[2]).not.toHaveTextContent("기존 링크가 그대로 전송됩니다.");
        expect(overviewCards[0].querySelector('[data-component="info-row"] > span')).toHaveClass(
            "text-[calc(12px*var(--glint-ui-scale,1))]",
        );
        expect(overviewCards[0].querySelector('[data-component="status-badge"]')).not.toBeInTheDocument();
        expect(
            overviewCards[1].querySelector(
                '[data-component="clients-detail-service-records-header-card-title-row"] [data-component="status-badge"]',
            ),
        ).not.toBeInTheDocument();
        expect(
            overviewCards[2].querySelector(
                '[data-component="clients-detail-service-records-link-card-title-row"] [data-component="status-badge"]',
            ),
        ).not.toBeInTheDocument();
        const headerCaption = overviewCards[1].querySelector<HTMLElement>(
            '[data-component="clients-detail-service-records-header-card-caption"]',
        );
        expect(headerCaption).toHaveClass("mt-auto", "text-right");
        expect(
            overviewCards[1].querySelector(
                '[data-component="clients-detail-service-records-header-card-head"] [data-component="clients-detail-service-records-header-card-caption"]',
            ),
        ).not.toBeInTheDocument();
    });
});
