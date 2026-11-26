import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Client } from "@/lib/client/types";

import { ClientDetailPanel } from "../ClientDetailPanel";

const mockHistory = jest.fn();
const mockUpcoming = jest.fn();
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { role: "owner" } }) }));
jest.mock("@/hooks/useVoucherData", () => ({
  useVoucherYears: () => ({ data: [] }),
  useVoucherPriceInfos: () => ({ data: [] }),
}));
jest.mock("@/features/clients/hooks/use-clients", () => ({
    useClient: () => ({}),
  useConfirmBooking: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useClientMessageHistory: () => mockHistory(),
  useClientUpcomingMessageTriggerJobs: () => mockUpcoming(),
  useRetryMessageHistory: () => ({ isPending: false }),
  useResendMessageTriggerJob: () => ({ isPending: false }),
}));
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useClientServiceRecords: () => ({}),
  useClientServiceRecordRevisionHistory: () => ({}),
  useRetryServiceRecordDocument: () => ({ isPending: false }),
}));
jest.mock("@/services/api", () => ({
  eformsignApi: {
    getDocumentsByClientId: jest.fn().mockResolvedValue([]),
    getLinkConfirmations: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("@/components/app/clients/ClientServiceRecordsTab", () => ({ ClientServiceRecordsTab: () => null }));

const client: Client = {
  id: 1, name: "QA-고객", birthday: null, dueDate: null, birthDate: null,
  address: null, phone: null, primaryEmployee: null, secondaryEmployee: null,
  type: null, duration: null, fullPrice: null, grant: null, actualPrice: null,
  startDate: null, endDate: null, careCenter: false, voucherClient: false,
  breastPump: false, serviceStatus: null, bookingConfirmedAt: null,
  eDocId: null, hasSigned: false, documentStatus: null,
};

describe("ClientDetailPanel info-card inset", () => {
  it.each(["desktop", "mobile"] as const)("insets every panel and preserves card borders in %s layout", (layout) => {
    const query = { items: [], data: { pages: [] }, isLoading: false, isError: false };
    mockHistory.mockReturnValue(query);
    mockUpcoming.mockReturnValue(query);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ClientDetailPanel client={client} trailing={null} layout={layout} />
      </QueryClientProvider>,
    );
    const panels = container.querySelectorAll("section[data-panel]");
    expect(panels.length).toBeGreaterThan(1);
    for (const panel of panels) {
      expect(panel).toHaveClass("w-full", "shrink-0", "px-px");
    }
    const cards = container.querySelectorAll('[data-source-component="InfoCard"]');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card).toHaveClass("border", "rounded-[16px]");
      expect(card.closest("section[data-panel]")).toHaveClass("px-px");
    }
    fireEvent.click(screen.getByRole("tab", { name: "알림 발송" }));
    expect(container.querySelector('section[data-panel][aria-hidden="false"]')).toHaveClass("px-px");
    queryClient.clear();
  });
});
