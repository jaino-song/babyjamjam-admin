import { act, fireEvent, render, screen } from "@testing-library/react";

import { ClientServiceRecordsTab } from "../ClientServiceRecordsTab";
import type { ServiceRecordAssignment, ServiceRecordRevisionHistoryResponse } from "@/features/service-records/types";

let mockSending = false;
const mockSendLink = jest.fn();
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useKeepPeriodMismatch: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useFitPeriodMismatch: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useSendServiceRecordLink: () => ({ isPending: mockSending, mutateAsync: mockSendLink }),
}));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "user", branchRole: "manager" } }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useBusinessDayCalendar");

const assignment: ServiceRecordAssignment = {
  scheduleId: 1,
  startDate: "2026-07-01",
  endDate: "2026-07-05",
  replaced: false,
  employee: { id: 1, name: "QA-제공", phone: "01000000000" },
  link: { status: "none", scheduledFor: null, sentCount: 0, lastSentAt: null, token: null },
  header: null,
  totalSessions: 1,
  sessions: [],
  signatureDoc: null,
};

const history: ServiceRecordRevisionHistoryResponse = {
  caseId: "case-1", caseVersion: 1, currentRevisionId: "revision-1", currentUsableRevisionId: null,
  caregiverEdits: [],
  revisions: [{
    id: "revision-1", revisionNumber: 1, confirmedAt: "2026-09-08T01:02:03.000Z", isCurrent: true,
    documents: [{ id: "document-1", operation: "record_snapshot", generation: "generation-1", status: "failed", documentVersion: 1, canRetry: true, reasonCode: "PROVIDER_TIMEOUT" }],
  }],
};

function expectBusy(name: string, idle: string) {
  const button = screen.getByRole("button", { name });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idleContent = button.querySelector('[data-slot="button-idle"]');
  expect(idleContent).toHaveAttribute("aria-hidden", "true");
  expect(idleContent).toHaveClass("contents", "invisible");
  expect(idleContent).toHaveTextContent(idle);
  expect(button.querySelector('[data-slot="button-spinner"] svg')).toHaveAttribute("aria-hidden", "true");
  return button;
}

it("hides refresh and retry text while preserving their accessible busy names", () => {
  mockSending = false;
  render(<ClientServiceRecordsTab
    data-component="desktop_clients-detail_panel_service-records"
    clientId={100} overview={{ assignments: [assignment] }} isLoading={false} isError={false}
    isRefreshing onRefresh={jest.fn()} revisionHistory={history}
    isRevisionHistoryRefreshing onRefreshRevisionHistory={jest.fn()}
    retryingDocumentKey="revision-1:document-1" onRetryRevisionDocument={jest.fn()}
  />);
  expectBusy("조회 중", "새로고침");
  expectBusy("재시도 중", "다시 시도");
  const refresh = expectBusy("제공기록 새로고침 중", "");
  expect(refresh).toHaveAttribute("data-size", "icon");
  expect(refresh).toHaveClass("h-[calc(32px*var(--glint-ui-scale,1))]", "after:h-[calc(44px*var(--glint-ui-scale,1))]");
});

it("centers a spinner and hides the idle send-link label while sending", async () => {
  let completeSend = () => {};
  mockSendLink.mockImplementation(() => new Promise<{ status: "sent" }>((resolve) => { completeSend = () => resolve({ status: "sent" }); }));
  mockSending = true;
  render(<ClientServiceRecordsTab data-component="desktop_clients-detail_panel_service-records"
    clientId={100} overview={{ assignments: [assignment] }} isLoading={false} isError={false} />);
  fireEvent.click(screen.getByRole("button", { name: "링크 수동 전송" }));
  expectBusy("링크 발송 중", "링크 수동 전송");
  await act(async () => completeSend());
  expect(screen.getByRole("button", { name: "링크 수동 전송" })).not.toHaveAttribute("data-loading");
});
