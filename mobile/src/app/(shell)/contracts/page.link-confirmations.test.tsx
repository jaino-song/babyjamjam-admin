import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ContractsPage from "./page";

// Rule 계약-05: the contracts list carries an entry point for contracts that need a link confirmation,
// shown only while the maternity (산모 계약서) section is active. These tests mount the REAL page with
// module mocks for its data hooks; the notice itself is stubbed (it has its own tests).

const mockUseInfiniteContracts = jest.fn();
const mockServiceRecordTemplateId = jest.fn();
const mockStatusCounts = jest.fn();
const mockNotice = jest.fn();

jest.mock("@/components/app/contracts/contract-link-confirmations-notice", () => ({
  ContractLinkConfirmationsNotice: (props: { "data-component": string; branchId: string | null }) => {
    mockNotice(props);
    return <div data-testid="link-confirmations-notice" data-component={props["data-component"]} />;
  },
}));
jest.mock("@/hooks/useInfiniteContracts", () => ({
  CONTRACTS_NEXT_PAGE_SIZE: 6,
  useInfiniteContracts: (...args: unknown[]) => mockUseInfiniteContracts(...args),
}));

jest.mock("@/hooks/useEformsignAuth", () => ({
  useEformsignAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
jest.mock("@/hooks/useEformsignDocumentEvents", () => ({ useEformsignDocumentEvents: () => undefined }));
jest.mock("@/hooks/useEformsignDocuments", () => ({
  eformsignQueryKeys: { documents: () => ["eformsign-documents"] },
  useDeleteEformsignDocument: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("@/hooks/useEformsign", () => ({
  useEformsign: () => ({ isLoaded: false, openDocument: jest.fn() }),
}));
jest.mock("@/hooks/useEmployees", () => ({ useEmployees: () => ({ data: [] }) }));
jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 9,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => ({ calendar: jest.requireActual("@/lib/date/business-days").KR_BUILTIN_CALENDAR }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useVoucherData", () => ({ useAllVoucherPriceInfos: () => ({ data: [] }) }));
jest.mock("@/hooks/useContractClientRegistration", () => ({
  useContractClientRegistration: () => ({
    handleOpenClientFromContract: jest.fn(),
    isClientRegistrationPending: false,
  }),
}));
jest.mock("@/lib/messages/logs", () => ({ fetchAllMessageLogs: () => Promise.resolve([]) }));
jest.mock("@/lib/api/authenticated-fetch", () => ({ openAuthenticatedEventSource: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/stores/client-dialog-store", () => ({
  useClientDialogStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ clearPrefillClient: jest.fn() }),
}));
jest.mock("@/stores/form-store", () => ({
  useFormStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ prefillFromContract: jest.fn() }),
}));
jest.mock("@/services/api", () => {
  const actual = jest.requireActual("@/services/api");
  return {
    ...actual,
    eformsignApi: {
      ...actual.eformsignApi,
      getServiceRecordTemplateId: (...args: unknown[]) => mockServiceRecordTemplateId(...args),
      getStatusCounts: (...args: unknown[]) => mockStatusCounts(...args),
      getDocumentClientNames: () => Promise.resolve([]),
    },
  };
});

const NOTICE_DC = "mobile_contracts_detail-sheet_stack_list-page_content_link-confirmations";

function listState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: { pages: [{ documents: [], total_rows: 0 }] },
    documents: [],
    totalRows: 0,
    branchId: "branch-1",
    isLoading: false,
    isSuccess: true,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    isLoadMoreError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
    fetchNextPage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let queryClient: QueryClient;

function mountPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractsPage />
    </QueryClientProvider>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  mockServiceRecordTemplateId.mockResolvedValue({ templateId: "svc-template", templateIds: ["svc-template"] });
  mockStatusCounts.mockResolvedValue({ documents: [] });
  mockUseInfiniteContracts.mockReturnValue(listState());
});

describe("ContractsPage link-confirmation entry point (계약-05)", () => {
  it("renders the notice between the section nav and the list card while the maternity section is active", async () => {
    mountPage();
    await settle();

    const notice = screen.getByTestId("link-confirmations-notice");
    expect(notice).toHaveAttribute("data-component", NOTICE_DC);
    expect(mockNotice).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: "branch-1" }));
    const nav = document.querySelector('[data-component$="_list-page_content_section-nav"]') as HTMLElement;
    const card = document.querySelector('[data-component$="_list-page_content_list-card"]') as HTMLElement;
    expect(nav.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not render the notice in the service-records section, and renders it again on return", async () => {
    mountPage();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "제공기록지" }));
    await settle();
    expect(screen.queryByTestId("link-confirmations-notice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "산모 계약서" }));
    await settle();
    expect(screen.getByTestId("link-confirmations-notice")).toBeInTheDocument();
  });

  it("does not render the notice in the automations section", async () => {
    mountPage();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "자동화" }));
    await settle();
    expect(screen.queryByTestId("link-confirmations-notice")).toBeNull();
  });
});
