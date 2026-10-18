import { fireEvent, render, screen } from "@testing-library/react";

import ConsultationsPage from "./page";

const inquiry = {
  id: "inq-1",
  branchId: "branch-1",
  publicBranchSlug: "main",
  motherName: "김상담",
  phone: "010-1234-5678",
  address: "서울시 강남구",
  dueDate: "2026-08-10T00:00:00.000Z",
  birthExperience: "초산",
  voucherType: "A통합1형",
  preferredCaregiverName: null,
  referralSource: "검색",
  privacyAcceptedAt: "2026-07-20T10:00:00.000Z",
  selectedServices: null,
  additionalNotes: null,
  source: "website",
  status: "new",
  readAt: null,
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
  branchName: "강남점",
};

const mockUseConsultationInquiries = jest.fn();
jest.mock("@/hooks/use-consultation-inquiries", () => ({
  useConsultationInquiries: () => mockUseConsultationInquiries(),
  useMarkConsultationInquiryAsRead: () => ({ mutate: jest.fn() }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 100,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ beforeFilters, children, count, filters }: { beforeFilters?: React.ReactNode; children: React.ReactNode; count: React.ReactNode; filters: Array<{ label: string; count: string }> }) => (
    <div data-component="test-consultations-list-card"><span data-testid="title-count">{count}</span><div data-testid="pills">{filters.map((filter) => <span key={filter.label}>{filter.label}:{filter.count}</span>)}</div>{beforeFilters}{children}</div>
  ),
  ListItemRow: ({ name, onClick }: { name: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{name}</button>
  ),
  ListLoadMoreButton: () => null,
  ListLoadMoreSentinel: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => (
    <div data-component="test-consultations-detail-sheet">{list}{detail}</div>
  ),
  MobileDetailPage: ({ children }: { children: React.ReactNode }) => <div data-component="test-consultations-detail-page">{children}</div>,
  MobileDetailHeader: () => null,
  MobileDetailActions: ({ actions }: { actions: Array<{ label: string }> }) => (
    <div data-component="test-consultations-actions">{actions.map((action) => <button key={action.label}>{action.label}</button>)}</div>
  ),
  DetailTabPills: () => null,
  MobileDetailTabPanel: ({ children }: { children: React.ReactNode }) => <div data-component="test-consultations-tab-panel">{children}</div>,
  InfoCard: ({ title, children }: { title: string; children: React.ReactNode }) => <section data-component="test-consultations-info-card"><h2>{title}</h2>{children}</section>,
  InfoRow: ({ label, value }: { label: string; value: React.ReactNode }) => <div data-component="test-consultations-info-row"><span>{label}</span><span>{value}</span></div>,
  MobileSearchBar: ({ placeholder, value, onChange }: { placeholder: string; value?: string; onChange?: (value: string) => void }) => (
    <input aria-label={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

describe("mobile consultations page", () => {
  beforeEach(() => {
    mockUseConsultationInquiries.mockReturnValue({
      data: { data: [inquiry], total: 1, page: 1, limit: 100, totalPages: 1 },
      isLoading: false, isError: false, isFetching: false, refetch: jest.fn(),
    });
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-08-01T00:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows a retryable failure with unknown counts, never a successful empty state", () => {
    const refetch = jest.fn();
    mockUseConsultationInquiries.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const { container } = render(<ConsultationsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("상담 문의를 불러오지 못했습니다");
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.queryByText("상담 문의가 없습니다.")).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]')).map((el) => el.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(screen.getByTestId("title-count")).toHaveTextContent("—");
    expect(screen.getByTestId("title-count")).not.toHaveTextContent("0건");
    expect(screen.getByTestId("pills")).toHaveTextContent("전체:—미확인:—확인:—");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("retains cached numbers and data with one inline notice (empty: %s)", (empty) => {
    const refetch = jest.fn();
    const data = { data: empty ? [] : [inquiry], total: empty ? 0 : 1 };
    mockUseConsultationInquiries.mockReturnValue({ data, isError: true, isLoading: false, isFetching: false, refetch });
    const { container, rerender } = render(<ConsultationsPage />);
    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(alert).toHaveAttribute("data-size", "inline");
    const row = empty ? screen.getByText("상담 문의가 없습니다.") : screen.getByRole("button", { name: "김상담" });
    expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]')).map((el) => el.textContent)).toEqual(empty ? ["0", "0", "0", "0"] : ["1", "1", "1", "0"]);
    expect(screen.getByTestId("title-count")).toHaveTextContent(empty ? "0건" : "1건");
    expect(screen.getByTestId("pills")).toHaveTextContent(empty ? "전체:0미확인:0확인:0" : "전체:1미확인:1확인:0");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockUseConsultationInquiries.mockReturnValue({ data, isError: true, isLoading: false, isFetching: true, refetch });
    rerender(<ConsultationsPage />);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
  });

  it("shows real zero counts and existing empty text after a successful empty load", () => {
    mockUseConsultationInquiries.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false });
    const { container } = render(<ConsultationsPage />);
    expect(screen.getByText("상담 문의가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]')).map((el) => el.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(screen.getByTestId("title-count")).toHaveTextContent("0건");
    expect(screen.getByTestId("pills")).toHaveTextContent("전체:0미확인:0확인:0");
  });

  it("shows existing loading text, not an alert or empty text, during a no-data retry", () => {
    mockUseConsultationInquiries.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: true });
    render(<ConsultationsPage />);
    expect(screen.getByText("불러오는 중...")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("상담 문의가 없습니다.")).not.toBeInTheDocument();
  });

  it("shows the loading text, not the empty text, with unknown counts while the load is paused offline", () => {
    // react-query state for a query started offline: pending but paused, so isLoading is false.
    mockUseConsultationInquiries.mockReturnValue({
      data: undefined,
      isPending: true,
      isLoading: false,
      isError: false,
      isFetching: false,
      isPaused: true,
      status: "pending",
      fetchStatus: "paused",
    });
    const { container } = render(<ConsultationsPage />);
    expect(screen.getByText("불러오는 중...")).toBeInTheDocument();
    expect(screen.queryByText("상담 문의가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]')).map((el) => el.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(screen.getByTestId("title-count")).toHaveTextContent("—");
    expect(screen.getByTestId("pills")).toHaveTextContent("전체:—미확인:—확인:—");
  });

  it("keeps the cached list when a refetch is paused offline", () => {
    mockUseConsultationInquiries.mockReturnValue({
      data: { data: [inquiry], total: 1, page: 1, limit: 100, totalPages: 1 },
      isLoading: false, isError: false, isFetching: false, isPaused: true, fetchStatus: "paused",
    });
    render(<ConsultationsPage />);
    expect(screen.getByRole("button", { name: "김상담" })).toBeInTheDocument();
    expect(screen.queryByText("불러오는 중...")).not.toBeInTheDocument();
  });

  it("renders the consultation stats in the canonical order", () => {
    const { container } = render(<ConsultationsPage />);
    const labels = Array.from(container.querySelectorAll('[data-slot="stat-mini-label"]'))
      .map((element) => element.textContent);
    const values = Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'))
      .map((element) => element.textContent);

    expect(labels).toEqual(["전체", "지난 30일", "미확인", "확인"]);
    expect(values).toEqual(["1", "1", "1", "0"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the list content with the consultations spacing hook", () => {
    const { container } = render(<ConsultationsPage />);

    expect(container.querySelector('[data-slot="consultations-content"]')).toBeInTheDocument();
  });

  it("supports the desktop search behavior", () => {
    render(<ConsultationsPage />);

    const search = screen.getByRole("textbox", { name: "이름, 연락처, 주소 검색" });
    fireEvent.change(search, { target: { value: "없는 고객" } });

    expect(screen.queryByRole("button", { name: "김상담" })).not.toBeInTheDocument();
  });

  it("does not expose placeholder actions that do not perform real work", () => {
    render(<ConsultationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "김상담" }));

    expect(screen.queryByRole("button", { name: "답장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "고객 등록" })).not.toBeInTheDocument();
    expect(screen.getByText("담당 지점")).toBeInTheDocument();
    expect(screen.getByText("강남점")).toBeInTheDocument();
    expect(screen.getByText("개인정보 동의")).toBeInTheDocument();
    expect(screen.getByText("선택 서비스 없음")).toBeInTheDocument();
  });
});
