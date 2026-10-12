import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EformsignDocument } from "@/lib/eformsign/types";

import ContractsPage from "./page";

// Rule S5: a failed load is never shown as 0건 / 없음 / empty. These tests mount the REAL contracts
// page with module mocks for its data hooks and assert what the user sees.

const mockUseInfiniteContracts = jest.fn();
const mockServiceRecordTemplateId = jest.fn();
const mockStatusCounts = jest.fn();
const mockGetDocument = jest.fn();

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
      getDocument: (...args: unknown[]) => mockGetDocument(...args),
    },
  };
});

const DC = "mobile_contracts_detail-sheet_stack_list-page_content_list-card";
const COUNTS_KEY = ["eformsign-documents", "status-counts", "branch-1", "maternal-contracts", ""];
const TEMPLATE_KEY = ["eformsign-docs", "service-record-template-id"];

function makeDoc(id: string, name: string): EformsignDocument {
  return {
    id,
    document_number: `NO-${id}`,
    template: { id: "tpl", name: "산모 계약서" },
    document_name: name,
    creator: { id: "c", name: "작성자" },
    created_date: 1_700_000_000_000,
    last_editor: { id: "c", name: "작성자" },
    updated_date: 1_700_000_000_000,
    current_status: { status_type: "060", doc_status: "doc_status" },
    display_status: "signed",
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  } as unknown as EformsignDocument;
}

const ROWS = [makeDoc("d1", "김가나 계약서"), makeDoc("d2", "이다라 계약서")];
const SIGNALS = ROWS.concat(makeDoc("d3", "x")).map(() => ({
  status_type: "060",
  step_type: null,
  step_name: null,
  step_recipient_types: [],
  display_status: "signed",
}));

interface ListMock {
  refetch: jest.Mock;
  fetchNextPage: jest.Mock;
}

function listState(overrides: Record<string, unknown> = {}): ListMock & Record<string, unknown> {
  return {
    data: undefined,
    documents: [],
    totalRows: 0,
    branchId: "branch-1",
    isLoading: false,
    isSuccess: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    isLoadMoreError: false,
    refetch: jest.fn().mockResolvedValue(undefined),
    fetchNextPage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ListMock & Record<string, unknown>;
}

const SUCCESS_ROWS = (): Record<string, unknown> => ({
  data: { pages: [{ documents: ROWS }] },
  documents: ROWS,
  totalRows: 2,
  isSuccess: true,
});
const SUCCESS_EMPTY = (): Record<string, unknown> => ({
  data: { pages: [{ documents: [], total_rows: 0 }] },
  documents: [],
  totalRows: 0,
  isSuccess: true,
});

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
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The header count placeholder is on screen for as long as the page is in its loading state.
  await waitFor(() => expect(screen.queryByLabelText("계약서 불러오는 중")).toBeNull());
}

async function mountWithCounts(
  list: Record<string, unknown>,
  counts: "ok" | "fail" | "cached-then-fail",
) {
  mockUseInfiniteContracts.mockReturnValue(list);
  if (counts === "ok") {
    mockStatusCounts.mockResolvedValue({ documents: SIGNALS });
  } else if (counts === "fail") {
    mockStatusCounts.mockRejectedValue(new Error("network down"));
  } else {
    queryClient.setQueryData(COUNTS_KEY, { documents: SIGNALS });
    mockStatusCounts.mockRejectedValue(new Error("network down"));
  }
  mountPage();
  await settle();
  if (counts === "cached-then-fail") {
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: COUNTS_KEY }).catch(() => undefined);
    });
    await settle();
  }
}

function listCardPanel(): HTMLElement | null {
  return document.querySelector(`[data-component="${DC}_body_load-error"]`);
}
function staleNotice(): HTMLElement | null {
  return document.querySelector(`[data-component="${DC}_stale-error"]`);
}
function countsNotice(): HTMLElement | null {
  return document.querySelector(`[data-component="${DC}_counts-error"]`);
}
function headerCount(): string {
  return document.querySelector(`[data-component="${DC}_header"] .list-count`)?.textContent ?? "";
}
function pills(): HTMLElement[] {
  return Array.from(document.querySelectorAll(`[data-component="${DC}_filters_pill"]`));
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  mockServiceRecordTemplateId.mockResolvedValue({ templateId: "svc-template", templateIds: ["svc-template"] });
  mockStatusCounts.mockResolvedValue({ documents: SIGNALS });
  mockGetDocument.mockImplementation((id: string) => Promise.resolve(makeDoc(id, `상세 ${id}`)));
});

describe("ContractsPage list load failures (S5)", () => {
  it("failed first load with no rows: error panel with 다시 시도, no 없습니다, no 0건, retry refetches once", async () => {
    const list = listState({ isError: true });
    await mountWithCounts(list, "ok");

    const panel = listCardPanel();
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("role", "alert");
    expect(panel).toHaveTextContent("불러오지 못했습니다");
    expect(within(panel as HTMLElement).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("없습니다");
    expect(headerCount()).not.toBe("0건");
    expect(headerCount()).toBe("—");
    expect(staleNotice()).toBeNull();

    fireEvent.click(within(panel as HTMLElement).getByRole("button", { name: "다시 시도" }));
    expect(list.refetch).toHaveBeenCalledTimes(1);
    expect(list.fetchNextPage).not.toHaveBeenCalled();
  });

  it("successful load with rows: rows shown, no alert, real count", async () => {
    await mountWithCounts(listState(SUCCESS_ROWS()), "ok");

    expect(screen.getByText("김가나 계약서")).toBeInTheDocument();
    expect(screen.getByText("이다라 계약서")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(headerCount()).toBe("2건");
  });

  it("successful load with zero rows: the empty text, no alert", async () => {
    await mountWithCounts(listState(SUCCESS_EMPTY()), "ok");

    expect(screen.getByText("등록된 산모 계약서가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(headerCount()).toBe("0건");
  });

  it("failed refetch with cached rows: rows stay AND an inline notice sits above them, retry refetches", async () => {
    const list = listState({ ...SUCCESS_ROWS(), isSuccess: false, isError: true });
    await mountWithCounts(list, "ok");

    expect(screen.getByText("김가나 계약서")).toBeInTheDocument();
    expect(listCardPanel()).toBeNull();
    const notice = staleNotice();
    expect(notice).not.toBeNull();
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("최신 정보를 불러오지 못했습니다");

    fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: "다시 시도" }));
    expect(list.refetch).toHaveBeenCalledTimes(1);
    expect(list.fetchNextPage).not.toHaveBeenCalled();
  });

  it("failed next page: rows stay, notice shown, retry loads the next page once", async () => {
    const list = listState({
      ...SUCCESS_ROWS(),
      isSuccess: false,
      isError: true,
      isLoadMoreError: true,
      hasNextPage: true,
    });
    await mountWithCounts(list, "ok");

    expect(screen.getByText("김가나 계약서")).toBeInTheDocument();
    const notice = staleNotice();
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("최신 정보를 불러오지 못했습니다");

    fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: "다시 시도" }));
    expect(list.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(list.refetch).not.toHaveBeenCalled();
  });

  it("failed counts with no earlier counts: pills do not show 0, an inline notice retries the counts query", async () => {
    await mountWithCounts(listState(SUCCESS_ROWS()), "fail");

    const items = pills();
    expect(items).toHaveLength(8);
    for (const pill of items) {
      expect(pill.querySelector(".count")?.textContent).toBe("—");
      expect(pill).not.toHaveTextContent(/\b0\b/);
    }
    const notice = countsNotice();
    expect(notice).not.toBeNull();
    expect(notice).toHaveAttribute("role", "alert");

    mockStatusCounts.mockClear();
    mockStatusCounts.mockResolvedValue({ documents: SIGNALS });
    await act(async () => {
      fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: "다시 시도" }));
    });
    await settle();
    expect(mockStatusCounts).toHaveBeenCalledTimes(1);
    expect(countsNotice()).toBeNull();
    expect(pills()[0].querySelector(".count")?.textContent).toBe("3");
  });

  it("failed counts refetch with cached counts: counts stay AND the notice shows", async () => {
    await mountWithCounts(listState(SUCCESS_ROWS()), "cached-then-fail");

    expect(pills()[0].querySelector(".count")?.textContent).toBe("3");
    const notice = countsNotice();
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("최신 건수 정보를 불러오지 못했습니다");
  });

  it("healthy list and counts show no alert and real pill counts", async () => {
    await mountWithCounts(listState(SUCCESS_ROWS()), "ok");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(pills()[0].querySelector(".count")?.textContent).toBe("3");
  });
});

describe("ContractsPage service-record template lookup failure (S5)", () => {
  it("never shows the list as empty when the 제공기록지 template lookup failed; retry refetches it", async () => {
    // Like the real hook: a disabled query has not run, so it is neither success nor error.
    mockUseInfiniteContracts.mockImplementation((options: { enabled?: boolean }) =>
      options.enabled ? listState(SUCCESS_EMPTY()) : listState(),
    );
    mockServiceRecordTemplateId.mockRejectedValue(new Error("network down"));
    mountPage();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /제공기록지/ }));
    await settle();

    const panel = listCardPanel();
    expect(panel).not.toBeNull();
    expect(document.body.textContent).not.toContain("없습니다");
    expect(headerCount()).not.toBe("0건");

    mockServiceRecordTemplateId.mockClear();
    mockServiceRecordTemplateId.mockResolvedValue({ templateId: "svc-template", templateIds: ["svc-template"] });
    await act(async () => {
      fireEvent.click(within(panel as HTMLElement).getByRole("button", { name: "다시 시도" }));
    });
    await settle();
    expect(mockServiceRecordTemplateId).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(TEMPLATE_KEY)).toBeDefined();
  });
});
