import { fireEvent, render, screen } from "@testing-library/react";

import PricesPage from "./page";

const mockRefetchYears = jest.fn();
const mockRefetchPrices = jest.fn();

interface YearsState {
  data: number[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
}
interface PricesState {
  data: Array<{ id: number; type: string | null; duration: string; fullPrice: string; grant: string; actualPrice: string }>;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
}

let mockYears: YearsState;
let mockPrices: PricesState;

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "staff" }, isLoading: false }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  VOUCHER_TYPES: [],
  useVoucherYears: () => ({ ...mockYears, refetch: mockRefetchYears }),
  useAllVoucherPrices: () => ({ ...mockPrices, refetch: mockRefetchPrices }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ count, filters, beforeFilters, children }: {
    count?: React.ReactNode;
    filters?: Array<{ label: string; count: string }>;
    beforeFilters?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-component="test-prices-list-card">
      <span data-testid="list-count">{count}</span>
      {beforeFilters}
      {(filters ?? []).map((filter) => (
        <span key={filter.label} data-testid={`filter-count-${filter.label}`}>{filter.count}</span>
      ))}
      {children}
    </div>
  ),
  ListCountSkeleton: () => <span data-testid="count-skeleton" />,
  ListItemRow: ({ name }: { name: string }) => <div data-component="test-prices-row">{name}</div>,
  ListRowsSkeleton: () => <div data-testid="rows-skeleton" />,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => (
    <div data-component="test-prices-detail-sheet">{list}{detail}</div>
  ),
  MobileDetailPage: ({ children }: { children: React.ReactNode }) => <div data-component="test-prices-detail-page">{children}</div>,
  MobileDetailHeader: () => null,
}));

jest.mock("@/components/app/settings/VoucherPriceUploadForm", () => ({
  VoucherPriceUploadForm: () => <div data-component="test-voucher-price-upload-form" />,
}));

const YEARS_EMPTY_TEXT = "등록된 가격표 연도가 없습니다.";
const NO_MATCH_TEXT = "조건에 맞는 가격표가 없습니다.";
const ROW = { id: 1, type: "A가1", duration: "10", fullPrice: "1,000,000", grant: "500,000", actualPrice: "500,000" };

describe("mobile prices page load failures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockYears = { data: [2026], isLoading: false, isError: false, isFetching: false };
    mockPrices = { data: [], isLoading: false, isError: false, isFetching: false };
  });

  describe("years query", () => {
    it("shows a failure state with retry, never the empty-years text, when the years load failed", () => {
      mockYears = { data: undefined, isLoading: false, isError: true, isFetching: false };

      render(<PricesPage />);

      expect(screen.getByRole("alert")).toHaveTextContent("가격표 연도를 불러오지 못했습니다");
      expect(screen.queryByText(YEARS_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
      expect(screen.getByTestId("list-count")).toHaveTextContent("—");
      expect(screen.getByTestId("filter-count-전체")).toHaveTextContent("—");

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(mockRefetchYears).toHaveBeenCalledTimes(1);
      expect(mockRefetchPrices).not.toHaveBeenCalled();
    });

    it("shows the empty-years text and no alert after a successful empty load", () => {
      mockYears = { data: [], isLoading: false, isError: false, isFetching: false };

      render(<PricesPage />);

      expect(screen.getByText(YEARS_EMPTY_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByTestId("list-count")).toHaveTextContent("0개");
    });

    it("keeps cached years and shows one inline notice when the years refetch failed", () => {
      mockYears = { data: [2025, 2026], isLoading: false, isError: true, isFetching: false };

      render(<PricesPage />);

      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent("최신 정보를 불러오지 못했습니다");
      expect(screen.getByRole("button", { name: "2026년" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "2025년" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(mockRefetchYears).toHaveBeenCalledTimes(1);
    });

    it("disables the inline notice retry while the years refetch is in flight", () => {
      mockYears = { data: [2026], isLoading: false, isError: true, isFetching: true };

      render(<PricesPage />);

      expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    });
  });

  describe("prices query", () => {
    it("shows a failure state with retry and a dash instead of zero when prices failed with no cache", () => {
      mockPrices = { data: [], isLoading: false, isError: true, isFetching: false };

      render(<PricesPage />);

      expect(screen.getByRole("alert")).toHaveTextContent("가격 정보를 불러오지 못했습니다");
      expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(YEARS_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.getByTestId("list-count")).toHaveTextContent("—");
      expect(screen.getByTestId("filter-count-A형")).toHaveTextContent("—");

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(mockRefetchPrices).toHaveBeenCalledTimes(1);
      expect(mockRefetchYears).not.toHaveBeenCalled();
    });

    it("shows the empty text and a real zero, with no alert, after a successful empty load", () => {
      render(<PricesPage />);

      expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByTestId("list-count")).toHaveTextContent("0개");
      expect(screen.getByTestId("filter-count-A형")).toHaveTextContent("0");
    });

    it("keeps the rows and shows one inline notice when a refetch failed with cached prices", () => {
      mockPrices = { data: [ROW], isLoading: false, isError: true, isFetching: false };

      render(<PricesPage />);

      expect(screen.getByText("A가1")).toBeInTheDocument();
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent("최신 정보를 불러오지 못했습니다");
      expect(screen.getByTestId("list-count")).toHaveTextContent("1개");

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(mockRefetchPrices).toHaveBeenCalledTimes(1);
      expect(mockRefetchYears).not.toHaveBeenCalled();
    });

    it("disables the inline notice retry while the prices refetch is in flight", () => {
      mockPrices = { data: [ROW], isLoading: false, isError: true, isFetching: true };

      render(<PricesPage />);

      expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    });

    it("shows rows with no alert after a successful load", () => {
      mockPrices = { data: [ROW], isLoading: false, isError: false, isFetching: false };

      render(<PricesPage />);

      expect(screen.getByText("A가1")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
