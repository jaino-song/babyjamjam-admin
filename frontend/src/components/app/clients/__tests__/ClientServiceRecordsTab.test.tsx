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

        expect(screen.getByText("예정일 2026.09.23(수)")).toBeInTheDocument();
        expect(screen.getByText("예정일 2026.09.29(화)")).toBeInTheDocument();
        expect(screen.queryByText("예정일 2026.09.24(목)")).not.toBeInTheDocument();
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
                header: null,
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

        render(
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
    });
});
