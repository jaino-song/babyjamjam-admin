import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import ClientsPage from "./page";

let mockMissingCount = 0;
const mockSearchParams = new URLSearchParams("id=1");
const mockClient = { id: 1, name: "QA-고객", serviceStatus: "active", bookingConfirmedAt: null, eDocId: null, hasSigned: false };
const mockOtherClient = { ...mockClient, id: 2, name: "QA-다른 고객", copaymentReceivedDate: "2026-11-03" };
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));
jest.mock("use-debounce", () => ({ useDebounce: <T,>(value: T) => [value] }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "owner", branchRole: null }, isLoading: false, isError: false }),
}));
jest.mock("@/features/system-templates/branch-context", () => ({
  ...jest.requireActual("@/features/system-templates/branch-context"),
  useActiveBranchId: () => "qa-branch",
}));
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useClientDirectory: () => ({
    clients: [mockClient], data: {}, matchedTotal: 1, isBranchContextReady: true,
    isInitialLoading: false, isInitialError: false, isSuccessfulEmpty: false,
    hasNextPage: false, isFetchingNextPage: false,
  }),
  useClientListSummary: () => ({ isBranchContextReady: true, isInitialLoading: false, isInitialError: false }),
  useServiceRecordMissingClients: () => ({ data: { count: mockMissingCount, items: [] }, error: null, refetch: jest.fn() }),
  useClient: (id: number) => ({
    data: [mockClient, mockOtherClient].find((client) => client.id === id),
    isBranchContextReady: true, isLoading: false, isError: false,
  }),
  useDeleteClient: () => ({ isPending: false }),
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

it.each(["취소", "Escape"])("opens the receipt date modal for an unsigned customer and dismisses with %s without a request", async (dismiss) => {
  const originalFetch = globalThis.fetch;
  const fetch = jest.fn();
  globalThis.fetch = fetch;
  document.cookie = "selected_branch_id=qa-branch; path=/";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    fireEvent.keyDown(screen.getByRole("button", { name: "고객 작업 메뉴 열기" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "본인부담금 영수증 발송" }));
    const dialog = screen.getByRole("dialog", { name: "본인부담금 영수증 발송" });
    expect(within(dialog).getByRole("textbox", { name: "본인부담금 납부일" })).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "전송" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();

    if (dismiss === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
    else fireEvent.click(within(dialog).getByRole("button", { name: dismiss }));
    expect(dialog).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    document.cookie = "selected_branch_id=; max-age=0; path=/";
    queryClient.clear();
  }
});

it("opens the receipt modal for a cached deep-linked customer immediately after the URL id changes", async () => {
  const originalFetch = globalThis.fetch;
  const fetch = jest.fn();
  globalThis.fetch = fetch;
  document.cookie = "selected_branch_id=qa-branch; path=/";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => <QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>;
  const openReceipt = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "고객 작업 메뉴 열기" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "본인부담금 영수증 발송" }));
    return screen.getByRole("dialog", { name: "본인부담금 영수증 발송" });
  };
  try {
    const { rerender } = render(page());
    mockSearchParams.set("id", String(mockOtherClient.id));
    rerender(page());

    const dialog = await openReceipt();
    expect(within(dialog).getByRole("textbox", { name: "본인부담금 납부일" })).toHaveValue(mockOtherClient.copaymentReceivedDate);

    mockSearchParams.set("id", String(mockClient.id));
    rerender(page());
    expect(dialog).not.toBeInTheDocument();
    expect(within(await openReceipt()).getByRole("textbox", { name: "본인부담금 납부일" })).toHaveValue("");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mockSearchParams.set("id", String(mockClient.id));
    globalThis.fetch = originalFetch;
    document.cookie = "selected_branch_id=; max-age=0; path=/";
    queryClient.clear();
  }
});

it("scopes the stats and trailing missing-record trigger to their page owner", () => {
  mockMissingCount = 1;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const { container } = render(<QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider>);
    const bar = container.querySelector('[data-component="desktop_clients_page_stats"]');
    expect(bar).toBeInTheDocument();
    expect(bar?.parentElement).toHaveAttribute("data-component", "desktop_clients_page");
    const root = container.querySelector('[data-component="desktop_clients_page"]');
    expect(root?.getAttribute("data-component")).toMatch(/^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/);
    const stats = root?.querySelector('[data-component="desktop_clients_page_stats"]');
    expect(stats).toHaveAttribute("data-component", `${root?.getAttribute("data-component")}_stats`);
    for (const child of (stats?.querySelectorAll("[data-component]") ?? [])) {
      expect(child.getAttribute("data-component")).toMatch(/^desktop_clients_page_stats_/);
    }
    expect(bar?.nextElementSibling).toHaveAttribute("data-component", "desktop_clients_page_sections");
    const trigger = screen.getByRole("button", { name: "제공기록지 미작성 고객 보기" });
    expect(trigger).toHaveAttribute("data-component", "desktop_clients_page_stats_service-record-missing_trigger");
    expect(bar).toContainElement(trigger);
  } finally {
    mockMissingCount = 0;
    queryClient.clear();
  }
});
