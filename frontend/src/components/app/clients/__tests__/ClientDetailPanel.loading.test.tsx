import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("ClientDetailPanel load-more spinners", () => {
  it.each([
    { name: "발송 기록", hook: mockHistory, idleLabel: "이전 발송 기록 더 불러오기" },
    { name: "예정 알림", hook: mockUpcoming, idleLabel: "더 불러오기" },
  ])("$name preserves the idle action and announces a spinner while fetching", ({ hook, idleLabel }) => {
    const fetchNextPage = jest.fn();
    const query = {
      items: [], data: { pages: [] }, isLoading: false, isError: false,
      hasNextPage: false, isFetchingNextPage: false, fetchNextPage,
    };
    mockHistory.mockReturnValue(query);
    mockUpcoming.mockReturnValue(query);
    hook.mockReturnValue({ ...query, hasNextPage: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = <QueryClientProvider client={queryClient}><ClientDetailPanel client={client} trailing={null} /></QueryClientProvider>;
    const { rerender } = render(panel);
    fireEvent.click(screen.getByRole("tab", { name: "알림 발송" }));
    const idle = screen.getByRole("button", { name: idleLabel });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute("aria-busy");
    fireEvent.click(idle);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    hook.mockReturnValue({ ...query, hasNextPage: true, isFetchingNextPage: true });
    rerender(<QueryClientProvider client={queryClient}><ClientDetailPanel client={client} trailing={null} /></QueryClientProvider>);
    const busy = screen.getByRole("button", { name: "불러오는 중" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("data-loading", "");
    const label = busy.querySelector('[data-slot="button-idle"]');
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(label).toHaveClass("contents", "invisible");
    expect(label).toHaveTextContent(idleLabel);
    expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(within(busy).getByText("불러오는 중")).toHaveClass("sr-only");
    fireEvent.click(busy);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    hook.mockReturnValue({ ...query, hasNextPage: true });
    rerender(<QueryClientProvider client={queryClient}><ClientDetailPanel client={client} trailing={null} /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: idleLabel })).toBeEnabled();
    expect(screen.getByRole("button", { name: idleLabel })).not.toHaveAttribute("data-loading");
    expect(screen.getByRole("button", { name: idleLabel }).querySelector('[data-slot="button-spinner"]')).toBeNull();
    queryClient.clear();
  });
});
