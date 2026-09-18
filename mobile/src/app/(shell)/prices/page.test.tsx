import { fireEvent, render, screen, within } from "@testing-library/react";

import PricesPage from "./page";

const mockUseGetAuthUser = jest.fn();
const mockUseAllVoucherPrices = jest.fn();

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => mockUseGetAuthUser(),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  VOUCHER_TYPES: ["A통합1형", "B통합1형", "C통합1형", "D-통합1형", "D-특수2형"],
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAllVoucherPrices: () => mockUseAllVoucherPrices(),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({
    actionLabel,
    actionLoading,
    onActionClick,
    beforeFilters,
    filters = [],
    onFilterChange,
    children,
  }: {
    actionLabel?: string;
    actionLoading?: boolean;
    onActionClick?: () => void;
    beforeFilters?: React.ReactNode;
    filters?: Array<{ label: string; count: string }>;
    onFilterChange?: (label: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-component="test-prices-list-card" data-testid="test-prices-list-card">
      {actionLoading ? <div data-testid="test-prices-action-skeleton" /> : null}
      {!actionLoading && actionLabel ? <button onClick={onActionClick}>{actionLabel}</button> : null}
      {beforeFilters}
      <div data-testid="test-prices-filters">
        {filters.map((filter) => (
          <button key={filter.label} type="button" onClick={() => onFilterChange?.(filter.label)}>
            {filter.label} {filter.count}
          </button>
        ))}
      </div>
      {children}
    </div>
  ),
  ListCountSkeleton: () => null,
  ListItemRow: ({ name, meta, onClick }: { name: string; meta?: string; onClick?: () => void }) => (
    <button type="button" data-testid={`price-row-${name}`} onClick={onClick}>
      {name} {meta}
    </button>
  ),
  ListRowsSkeleton: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => (
    <div data-component="test-prices-detail-sheet">{list}{detail}</div>
  ),
  MobileDetailPage: ({ children }: { children: React.ReactNode }) => <div data-component="test-prices-detail-page">{children}</div>,
  MobileDetailHeader: () => null,
}));

jest.mock("@/components/app/settings/VoucherPriceUploadForm", () => ({
  VoucherPriceUploadForm: () => <div data-component="test-voucher-price-upload-form" data-testid="voucher-price-upload-form">실제 요금표 업로드</div>,
}));

describe("mobile prices page", () => {
  beforeEach(() => {
    mockUseGetAuthUser.mockReturnValue({ data: { role: "owner" }, isLoading: false });
    mockUseAllVoucherPrices.mockReset().mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
    });
  });

  it("shows the owner action skeleton while the user role is loading", () => {
    mockUseGetAuthUser.mockReturnValue({ data: undefined, isLoading: true });

    const view = render(<PricesPage />);

    expect(screen.getByTestId("test-prices-action-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "업데이트" })).not.toBeInTheDocument();

    mockUseGetAuthUser.mockReturnValue({ data: { role: "owner" }, isLoading: false });
    view.rerender(<PricesPage />);

    expect(screen.queryByTestId("test-prices-action-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업데이트" })).toBeInTheDocument();
  });

  it("opens the functional voucher upload form for owners", () => {
    render(<PricesPage />);

    fireEvent.click(screen.getByRole("button", { name: "업데이트" }));

    expect(screen.getByTestId("voucher-price-upload-form")).toBeInTheDocument();
  });

  it("groups ID-free contract-view rows, preserves A/B/C/D order, and counts D types", () => {
    mockUseAllVoucherPrices.mockReturnValue({
      data: [
        { type: "B통합1형", duration: "15", fullPrice: "200000", grant: "100000", actualPrice: "100000", year: 2026 },
        { type: "A통합1형", duration: "30", fullPrice: "300000", grant: "150000", actualPrice: "150000", year: 2026 },
        { type: "D-통합1형", duration: "30", fullPrice: "600000", grant: "300000", actualPrice: "300000", year: 2026 },
        { type: "D-통합1형", duration: "15", fullPrice: "300000", grant: "150000", actualPrice: "150000", year: 2026 },
        { type: "D-특수2형", duration: "45", fullPrice: "900000", grant: "450000", actualPrice: "450000", year: 2026 },
        { type: "C통합1형", duration: "60", fullPrice: "400000", grant: "200000", actualPrice: "200000", year: 2026 },
      ],
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<PricesPage />);

    const rows = within(screen.getByTestId("test-prices-list-card"))
      .getAllByTestId(/price-row-/)
      .map((row) => row.textContent);
    expect(rows).toEqual([
      "A통합1형 30일",
      "B통합1형 15일",
      "C통합1형 60일",
      "D-통합1형 15일 · 30일",
      "D-특수2형 45일",
    ]);
    expect(screen.getByRole("button", { name: "D형 2" })).toBeInTheDocument();
  });

  it("renders the price error branch before the empty branch", () => {
    mockUseAllVoucherPrices.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: true,
    });

    render(<PricesPage />);

    expect(screen.getByText("가격 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.queryByText("조건에 맞는 가격표가 없습니다.")).not.toBeInTheDocument();
  });
});
