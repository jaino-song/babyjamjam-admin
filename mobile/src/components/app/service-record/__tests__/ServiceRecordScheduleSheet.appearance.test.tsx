import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AdminServiceRecordScheduleApi } from "@/features/service-records/api/admin-service-record-schedule.api";

import { ServiceRecordScheduleSheet } from "../ServiceRecordScheduleSheet";
import { FIXTURE_CALENDAR, fixtureOverview } from "../service-record-schedule.fixture";

const mockCalendarHook = {
  calendar: FIXTURE_CALENDAR,
  ready: true,
  error: null as null | "load-failed",
  retry: jest.fn(),
  refreshForSave: jest.fn(),
  version: "fixture",
};
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => mockCalendarHook,
}));

function renderSheet({ loadError = false } = {}) {
  const api: jest.Mocked<AdminServiceRecordScheduleApi> = {
    getEditor: jest.fn().mockResolvedValue(fixtureOverview()),
    getDraft: jest.fn().mockResolvedValue({
      draft: null,
      sourceChanged: false,
      sourceCaseVersion: 7,
      sourceFingerprint: "fixture",
    }),
    startDraft: jest.fn(),
    updateDraft: jest.fn(),
    previewDraft: jest.fn(),
    confirmDraft: jest.fn(),
    discardDraft: jest.fn(),
  };
  if (loadError) api.getEditor.mockRejectedValue(new Error("fixture load failure"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceRecordScheduleSheet
        data-component="mobile_clients_detail_service-record-schedule-sheet"
        clientId={12}
        clientName="QA-테스트 고객"
        api={api}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("ServiceRecordScheduleSheet appearance", () => {
  beforeEach(() => {
    mockCalendarHook.ready = true;
    mockCalendarHook.error = null;
  });

  it.each(["되돌리기", "취소", "저장"])("keeps %s rounded-2xl instead of the shared pill radius", async (name) => {
    renderSheet();
    await screen.findByText("서비스 제공일");

    const button = screen.getByRole("button", { name });
    expect(button).toHaveClass("rounded-2xl");
    expect(button).not.toHaveClass("rounded-full");
  });

  it("keeps the load-error retry button rounded-2xl", async () => {
    renderSheet({ loadError: true });

    const button = await screen.findByRole("button", { name: "다시 시도" });
    expect(button).toHaveClass("rounded-2xl");
    expect(button).not.toHaveClass("rounded-full");
  });

  it("keeps the calendar-error retry button rounded-2xl", async () => {
    mockCalendarHook.ready = false;
    mockCalendarHook.error = "load-failed";
    renderSheet();

    const button = await screen.findByRole("button", { name: "다시 시도" });
    expect(button).toHaveClass("rounded-2xl");
    expect(button).not.toHaveClass("rounded-full");
  });
});
