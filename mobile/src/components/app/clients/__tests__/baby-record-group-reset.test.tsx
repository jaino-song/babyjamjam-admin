import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
    AdminServiceRecordCaseSummary, ServiceRecordAssignment, ServiceRecordCase, ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";
import { ClientDetailContent } from "../client-detail";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("next/navigation", () => ({
    usePathname: () => "/clients",
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => ({
        data: { role: "admin", branchRole: "admin" },
        isPending: false, isLoading: false, isFetching: false, isError: false,
    }),
}));
jest.mock("@/hooks/use-send-client-receipt", () => ({ useSendClientReceipt: () => ({ dialog: null }) }));
jest.mock("@/features/clients", () => ({ useConfirmBooking: () => ({ isPending: false, mutateAsync: jest.fn() }) }));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
    useResendMessageTriggerJob: () => ({ isPending: false }),
    useRetryMessageHistory: () => ({ isPending: false }),
}));

const caseIds = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
];
const employee = { id: 31, name: "테스트 관리사", phone: "01011112222" };
const cases: AdminServiceRecordCaseSummary[] = caseIds.map((caseId, index) => ({
    caseId, babyId: `20000000-0000-4000-8000-00000000000${index + 1}`, rank: index + 1, babyCount: 2,
    legacyName: null, retired: false, status: "IN_PROGRESS", assignees: [employee],
    totalSessions: 5, submittedSessions: 0,
    linkAssignments: [{ scheduleId: 11, employeeId: 31, assignmentVersion: index === 0 ? 3 : 7 }],
}));
const dates = { startDate: "2026-12-01", endDate: "2026-12-07" };
const assignment = {
    scheduleId: 11, ...dates, replaced: false, employee, link: { status: "sent", sentCount: 1, scheduledFor: null, lastSentAt: null, token: null },
    header: null, totalSessions: 5, sessions: [], signatureDoc: null,
} as ServiceRecordAssignment;
const secondRecord = {
    id: caseIds[1], status: "IN_PROGRESS", ...dates, totalSessions: 5, sessions: [], header: null, signatureDocs: [],
} as unknown as ServiceRecordCase;
const summary: ServiceRecordOverview = { record: null, assignments: [], legacyLinkAssignment: null, cases };
const second: ServiceRecordOverview = { ...summary, record: secondRecord, assignments: [assignment] };
const client = { id: 20, name: "테스트 산모", serviceStatus: "active" } as Client;

it("resetting the selected second case does not reset the first", async () => {
    const url = "https://example.test/service-record/reset-second";
    jest.mocked(api.get).mockImplementation(async (path) => ({
        data: path.endsWith(`?caseId=${caseIds[1]}`) ? second : summary,
    }));
    jest.mocked(api.post).mockResolvedValue({
        data: { kind: "group", employeeId: 31, members: [{
            caseId: caseIds[1], assignmentVersion: 7, serviceRecordUrl: url,
        }] },
    });
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={query}>
            <ClientDetailContent data-component="mobile_clients_detail-sheet_content"
                client={client} activeTab="serviceRecords" onTabChange={jest.fn()} onMessage={jest.fn()}
                onIssueContract={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()}
            />
        </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /둘째 · 테스트 관리사/ }));
    const reset = await screen.findByRole("button", { name: "제공기록지 링크 재설정" });
    fireEvent.click(reset);
    const modal = await screen.findByRole("dialog", { name: /재설정하시겠습니까/ });
    fireEvent.click(within(modal).getByRole("button", { name: "링크 재설정" }));
    await waitFor(() => expect(jest.mocked(api.post).mock.calls).toEqual([[
        "/admin/service-records/schedules/11/reset-link",
        { employeeId: 31, members: [{ caseId: caseIds[1], assignmentVersion: 7 }] },
    ]]));
    expect(await screen.findByRole("textbox", { name: "제공기록지 링크" })).toHaveValue(url);
    expect(api.get).toHaveBeenCalledWith(`/admin/service-records/client/20?caseId=${caseIds[1]}`);
});
