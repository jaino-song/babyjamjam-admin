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
});
