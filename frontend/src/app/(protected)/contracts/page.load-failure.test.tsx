import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import type { EformsignDocument } from "@/lib/eformsign/types";

import ContractsPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => ({ calendar: undefined }),
}));
jest.mock("@/hooks/useEformsignAuth", () => ({ useEformsignAuth: jest.fn() }));
jest.mock("@/hooks/useEformsignDocsLiveStream", () => ({
  useEformsignDocsLiveStream: () => undefined,
}));
jest.mock("@/hooks/useInfiniteContracts", () => ({ useInfiniteContracts: jest.fn() }));
jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
  useEformsignDocumentJobs: () => ({ data: undefined }),
  useEnqueueEformsignDocumentFinalization: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useEformsignDocuments", () => ({
  useContractClientCandidate: () => ({ data: undefined, isSuccess: false, isError: false }),
  useDeleteEformsignDocument: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useVoucherData", () => ({ useAllVoucherPriceInfos: () => ({ data: [] }) }));
jest.mock("@/features/system-templates/branch-context", () => ({
  isBranchContextAligned: () => true,
  useActiveBranchId: () => "branch-1",
}));
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useClientServiceRecords: () => ({ data: undefined }),
}));
jest.mock("@/services/api", () => ({
  eformsignApi: {
    getLinkConfirmations: jest.fn().mockResolvedValue([]),
    getDocumentClientNames: jest.fn().mockResolvedValue([]),
    getDocumentStatusCounts: jest.fn().mockResolvedValue({ documents: [] }),
    getDocument: jest.fn().mockRejectedValue(new Error("detail unavailable")),
  },
  withEformsignReauth: jest.fn(),
}));
jest.mock("@/components/app/contracts/ContractCreationForm", () => ({
  CONTRACT_CREATION_STEPPER_STEPS: [{ label: "이용자 정보" }],
  ContractCreationForm: ({ onSessionStateChange }: {
    onSessionStateChange: (hasSession: boolean) => void;
  }) => (
    <button type="button" onClick={() => onSessionStateChange(true)}>
      stub-begin-session
    </button>
  ),
}));

const document: EformsignDocument = {
  id: "contract-1", document_name: "회귀 테스트 문서", document_number: "1",
  created_date: 100, updated_date: 100,
  template: { id: "template", name: "Contract" },
  creator: { recipient_type: "01", name: "Test" },
  last_editor: { recipient_type: "01", name: "Test" },
  current_status: {
    status_type: "060", status_doc_type: "", status_doc_detail: "",
    step_type: "", step_index: "", step_name: "", step_recipients: [],
    step_group: 0, expired_date: 0, _expired: false,
  },
  fields: [], next_status: [], previous_status: [], histories: [],
  recipients: [], detail_template_info: [],
};

const mockList = jest.mocked(useInfiniteContracts);
const refetch = jest.fn();
const fetchNextPage = jest.fn();
const originalIntersectionObserver = global.IntersectionObserver;
beforeAll(() => {
  // Only the browser API is stubbed; AnimatedSlotList and its sentinel render for real.
  global.IntersectionObserver = jest.fn(() => ({
    observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn(),
    takeRecords: () => [], root: null, rootMargin: "", thresholds: [],
  }));
});
afterAll(() => { global.IntersectionObserver = originalIntersectionObserver; });
// ReturnType keeps the mock aligned with the hook's public surface as fields are exposed.
function listState(overrides: Partial<ReturnType<typeof useInfiniteContracts>> = {}) {
  mockList.mockReturnValue({
    documents: [], allDocuments: [], totalCount: 0,
    isLoading: false, isFetching: false, isFetchingNextPage: false,
    isError: false, isRefetching: false, isFetchNextPageError: false,
    hasNextPage: false, error: null, refetch, fetchNextPage,
    ...overrides,
  });
}

function renderPage(section: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = () => <QueryClientProvider client={client}><ContractsPage /></QueryClientProvider>;
  const view = render(element());
  if (section === "service-records") {
    fireEvent.click(screen.getAllByRole("button", { name: "제공기록지" })[0]);
  }
  return { ...view, rerenderPage: () => view.rerender(element()) };
}

function row() {
  return screen.getByRole("button", { name: /이름 없음.*발송/ });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Match the creation-session harness: the page can render without vendor auth.
  jest.mocked(useEformsignAuth).mockReturnValue({
    isAuthenticated: false, isLoading: false, error: null,
  } as ReturnType<typeof useEformsignAuth>);
  listState();
});

describe.each([
  ["maternity", "계약 문서가 없습니다"],
  ["service-records", "아직 제공기록지가 없습니다"],
])("ContractsPage %s list failure", (section, emptyText) => {
  it("shows a retry panel for a failed first load, then rows or a genuine empty state on success", () => {
    listState({ isError: true, error: new Error("unavailable") });
    const view = renderPage(section);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.getByRole("alert")).toHaveClass("pointer-events-auto");
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(fetchNextPage).not.toHaveBeenCalled();

    listState({ documents: [document] });
    view.rerenderPage();
    expect(row()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    listState();
    view.rerenderPage();
    expect(screen.getByText(emptyText)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached rows and statistics with an inline failed-refetch notice", () => {
    listState({ documents: [document] });
    const view = renderPage(section);
    const stats = view.container.querySelector('[data-slot="contract-stats-bar"]');
    expect(stats).not.toBeNull();
    listState({ documents: [document], isError: true, error: new Error("refresh failed") });
    view.rerenderPage();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(row()).toBeInTheDocument();
    expect(view.container.querySelector('[data-slot="contract-stats-bar"]')).toBe(stats);
    expect(alert.parentElement?.firstElementChild).toBe(alert);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(fetchNextPage).not.toHaveBeenCalled();

    listState({ documents: [document], isError: true, isRefetching: true, isFetching: true });
    view.rerenderPage();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(row()).toBeInTheDocument();
  });

  it("stops the next-page sentinel on error and retries only the failed next page", () => {
    listState({ documents: [document], hasNextPage: true });
    const view = renderPage(section);
    expect(view.container.querySelector('[data-slot="fetch-more"]')).toBeInTheDocument();
    listState({ documents: [document], hasNextPage: true, isError: true,
      isFetchNextPageError: true, error: new Error("page failed") });
    view.rerenderPage();
    expect(row()).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(view.container.querySelector('[data-slot="fetch-more"]')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();

    listState({ documents: [document], hasNextPage: true, isError: true,
      isFetchNextPageError: true, isFetchingNextPage: true, isFetching: true });
    view.rerenderPage();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    listState({ documents: [document], hasNextPage: true });
    view.rerenderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-slot="fetch-more"]')).toBeInTheDocument();
  });

  it("keeps the existing loading state rather than showing empty or failed content", () => {
    listState({ isLoading: true, isFetching: true });
    const view = renderPage(section);
    expect(view.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it("keeps an in-progress creation form mounted when a cached list refetch fails", () => {
  listState({ documents: [document] });
  const view = renderPage("maternity");
  fireEvent.click(screen.getByRole("button", { name: /전자문서 발송/ }));
  const form = screen.getByRole("button", { name: "stub-begin-session" });
  fireEvent.click(form);
  listState({ documents: [document], isError: true, error: new Error("refresh failed") });
  view.rerenderPage();
  expect(screen.getByRole("button", { name: "stub-begin-session" })).toBe(form);
  expect(row()).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
});

it("keeps an open detail mounted when a cached list refetch fails", async () => {
  listState({ documents: [document] });
  const view = renderPage("maternity");
  await act(async () => { fireEvent.click(row()); });
  const detail = view.container.querySelector(
    '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]',
  );
  expect(detail).not.toBeNull();
  listState({ documents: [document], isError: true, error: new Error("refresh failed") });
  view.rerenderPage();
  expect(view.container.querySelector(
    '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]',
  )).toBe(detail);
  expect(row()).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.getAllByRole("alert")[0]).toHaveAttribute("data-size", "inline");
});

it("keeps the auth failure full-page banner", () => {
  jest.mocked(useEformsignAuth).mockReturnValue({
    isAuthenticated: false, isLoading: false, error: new Error("auth failed"),
  } as ReturnType<typeof useEformsignAuth>);
  const view = renderPage("maternity");
  expect(view.container.querySelector('[data-component="desktop_contracts_error_banner"]'))
    .toHaveTextContent("인증에 실패했어요. 페이지를 새로고침 해 주세요.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
