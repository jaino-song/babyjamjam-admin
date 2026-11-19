import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import ClientsPage from "./page";

const mockSendReceipt = jest.fn();
let mockIsSending = false;
let mockMissingCount = 0;
const mockSearchParams = new URLSearchParams("id=1");
const mockClient = { id: 1, name: "QA-고객", serviceStatus: "active", bookingConfirmedAt: null };
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));
jest.mock("use-debounce", () => ({ useDebounce: <T,>(value: T) => [value] }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "owner", branchRole: null }, isLoading: false, isError: false }),
}));
jest.mock("@/features/system-templates/branch-context", () => ({ useActiveBranchId: () => "qa-branch" }));
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useClientDirectory: () => ({
    clients: [mockClient], data: {}, matchedTotal: 1, isBranchContextReady: true,
    isInitialLoading: false, isInitialError: false, isSuccessfulEmpty: false,
    hasNextPage: false, isFetchingNextPage: false,
  }),
  useClientListSummary: () => ({ isBranchContextReady: true, isInitialLoading: false, isInitialError: false }),
  useServiceRecordMissingClients: () => ({ data: { count: mockMissingCount, items: [] }, error: null, refetch: jest.fn() }),
  useClient: () => ({ data: mockClient, isBranchContextReady: true, isLoading: false, isError: false }),
  useDeleteClient: () => ({ isPending: false }),
}));
jest.mock("@/features/clients/hooks/use-send-client-receipt", () => ({
  useSendClientReceipt: () => ({ isSending: mockIsSending, sendReceipt: mockSendReceipt }),
}));
jest.mock("@/services/api", () => ({
  settingsApi: { getClientRegistrationPolicy: jest.fn().mockResolvedValue({}), updateClientRegistrationPolicy: jest.fn() },
}));
jest.mock("@/components/app/clients/ClientDetailPanel", () => ({
  ClientDetailPanel: ({ trailing }: { trailing: ReactNode }) => <>{trailing}</>,
}));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({
  CLIENT_FORM_STEPPER_STEPS: [], ClientFormDialog: () => null, ClientFormPanel: () => null,
}));
jest.mock("@/components/app/clients/MaternityContractDialog", () => ({ MaternityContractDialog: () => null }));
jest.mock("@/components/app/clients/ClientDetailModal", () => ({ ClientDetailModal: () => null }));
jest.mock("@/components/app/clients/ServiceRecordLinkResetResultModal", () => ({ ServiceRecordLinkResetResultModal: () => null }));
jest.mock("@/components/app/service-record/ServiceRecordScheduleDialog", () => ({ ServiceRecordScheduleDialog: () => null }));
jest.mock("@/components/app/contracts/ContractClientSelector", () => ({ canCreateNewContractDocument: () => false }));

it("keeps the receipt menu action spinner-only and disabled while sending, then restores it", async () => {
  mockIsSending = false;
  mockSendReceipt.mockReset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => <QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>;
  const { rerender } = render(page());
  fireEvent.keyDown(screen.getByRole("button", { name: "고객 작업 메뉴 열기" }), { key: "ArrowDown" });
  const idle = await screen.findByRole("menuitem", { name: "본인부담금 영수증 발송" });
  expect(idle).not.toHaveAttribute("aria-disabled", "true");
  expect(idle).not.toHaveAttribute("aria-busy");
  fireEvent.click(idle);
  expect(mockSendReceipt).toHaveBeenCalledWith(1);

  mockIsSending = true;
  rerender(page());
  // Radix closes the menu when selecting an idle item; open it during the request.
  fireEvent.keyDown(screen.getByRole("button", { name: "고객 작업 메뉴 열기" }), { key: "ArrowDown" });
  const busy = await screen.findByRole("menuitem", { name: "영수증 발송 중" });
  expect(busy).toHaveAttribute("aria-disabled", "true");
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  expect(busy).toHaveClass("relative");
  const label = busy.querySelector('[data-slot="button-idle"]');
  expect(label).toHaveTextContent("본인부담금 영수증 발송");
  expect(label).toHaveAttribute("aria-hidden", "true");
  expect(label).toHaveClass("contents", "invisible");
  expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(within(busy).getByText("영수증 발송 중")).toHaveClass("sr-only");
  fireEvent.click(busy);
  expect(mockSendReceipt).toHaveBeenCalledTimes(1);

  mockIsSending = false;
  rerender(page());
  fireEvent.keyDown(screen.getByRole("button", { name: "고객 작업 메뉴 열기" }), { key: "ArrowDown" });
  const restored = await screen.findByRole("menuitem", { name: "본인부담금 영수증 발송" });
  expect(restored).not.toHaveAttribute("aria-disabled", "true");
  expect(restored).not.toHaveAttribute("aria-busy");
  expect(restored).not.toHaveAttribute("data-loading");
  expect(restored.querySelector('[data-slot="button-spinner"]')).toBeNull();
  queryClient.clear();
});

it("scopes the stats and trailing missing-record trigger to their page owner", () => {
  mockMissingCount = 1;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const { container } = render(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    const bar = container.querySelector('[data-component="desktop_clients_stats"]');
    expect(bar).toBeInTheDocument();
    expect(bar?.parentElement).toHaveAttribute("data-component", "desktop_clients");
    expect(bar?.nextElementSibling).toHaveAttribute("data-component", "desktop_clients_sections");
    const trigger = screen.getByRole("button", { name: "제공기록지 미작성 고객 보기" });
    expect(trigger).toHaveAttribute("data-component", "desktop_clients_stats_service-record-missing_trigger");
    expect(bar).toContainElement(trigger);
  } finally {
    mockMissingCount = 0;
    queryClient.clear();
  }
});
