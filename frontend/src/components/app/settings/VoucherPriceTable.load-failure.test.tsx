import { fireEvent, render, screen } from "@testing-library/react";

import { VoucherPriceTable } from "./VoucherPriceTable";

const mockUseVoucherYears = jest.fn();
const mockUseAllVoucherPriceInfos = jest.fn();

jest.mock("@/hooks", () => ({
  useVoucherYears: () => mockUseVoucherYears(),
  useAllVoucherPriceInfos: () => mockUseAllVoucherPriceInfos(),
}));

jest.mock("./VoucherPriceUploadForm", () => ({
  VoucherPriceUploadForm: () => null,
}));

const YEAR = new Date().getFullYear();
const ROW = { id: 1, type: "A가1", duration: "5", fullPrice: "100000", grant: "70000", actualPrice: "30000" };
const SKELETON = '[data-component="desktop_settings_voucher-price-table_skeleton"]';
const PRICES_TITLE = "요금 정보를 불러오지 못했습니다";
const YEARS_TITLE = "연도 목록을 불러오지 못했습니다";
const STALE_TITLE = "최신 정보를 불러오지 못했습니다";

type Result = Record<string, unknown>;

function query(overrides: Result = {}): Result {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    isPaused: false,
    status: "success",
    fetchStatus: "idle",
    refetch: jest.fn(),
    ...overrides,
  };
}

const loaded = (data: unknown, extra: Result = {}) => query({ data, ...extra });
const loading = () => query({ isLoading: true, isPending: true, isFetching: true, status: "pending", fetchStatus: "fetching" });
const paused = () => query({ isPending: true, isPaused: true, status: "pending", fetchStatus: "paused" });
const failed = (extra: Result = {}) => query({ isError: true, status: "error", ...extra });
const failedWithData = (data: unknown, extra: Result = {}) => query({ data, isError: true, status: "error", ...extra });

function setup(years: Result, prices: Result) {
  mockUseVoucherYears.mockReturnValue(years);
  mockUseAllVoucherPriceInfos.mockReturnValue(prices);
  return render(<VoucherPriceTable />);
}

const yearSelect = () => document.getElementById("price-table-year") as HTMLElement;

describe("VoucherPriceTable load states", () => {
  beforeEach(() => {
    mockUseVoucherYears.mockReset();
    mockUseAllVoucherPriceInfos.mockReset();
  });

  describe("prices", () => {
    it("shows the skeleton while loading and while paused, never the empty text or a failure", () => {
      for (const pricesState of [loading(), paused()]) {
        const { container, unmount } = setup(loaded([YEAR]), pricesState);

        expect(container.querySelector(SKELETON)).not.toBeNull();
        expect(screen.queryByText(/요금 데이터가 없습니다/)).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        unmount();
      }
    });

    it("shows a failure with retry instead of the empty text when the prices failed with no data", () => {
      const refetchPrices = jest.fn();
      const { container } = setup(loaded([YEAR]), failed({ refetch: refetchPrices }));

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(PRICES_TITLE);
      expect(screen.queryByText(/요금 데이터가 없습니다/)).not.toBeInTheDocument();
      expect(screen.queryByText("선택한 필터에 해당하는 데이터가 없습니다.")).not.toBeInTheDocument();
      expect(container.querySelector(SKELETON)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchPrices).toHaveBeenCalledTimes(1);
    });

    it("shows the empty text and no alert after a successful load that returned nothing", () => {
      setup(loaded([YEAR]), loaded([]));

      expect(screen.getByText(`${YEAR}년 요금 데이터가 없습니다.`)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the rows and no alert after a successful load", () => {
      setup(loaded([YEAR]), loaded([ROW]));

      expect(screen.getByText("100,000원")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps cached rows and shows exactly one inline notice when a refetch failed", () => {
      const refetchPrices = jest.fn();
      setup(loaded([YEAR]), failedWithData([ROW], { refetch: refetchPrices }));

      expect(screen.getByText("100,000원")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(STALE_TITLE);

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchPrices).toHaveBeenCalledTimes(1);
    });

    it("keeps a successfully loaded empty list as empty text plus the inline notice when a refetch failed", () => {
      setup(loaded([YEAR]), failedWithData([]));

      expect(screen.getByText(`${YEAR}년 요금 데이터가 없습니다.`)).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(STALE_TITLE);
    });

    it("disables the retry button of the notice while the refetch is in flight", () => {
      setup(loaded([YEAR]), failedWithData([ROW], { isFetching: true }));

      expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    });

    it("keeps the rows untouched when a refetch is merely paused", () => {
      setup(loaded([YEAR]), loaded([ROW], { isPaused: true, fetchStatus: "paused" }));

      expect(screen.getByText("100,000원")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("years", () => {
    it("shows one inline years alert above loaded rows whose retry refetches the years", () => {
      const refetchYears = jest.fn();
      const refetchPrices = jest.fn();
      setup(failed({ refetch: refetchYears }), loaded([ROW], { refetch: refetchPrices }));

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(YEARS_TITLE);
      expect(screen.getByText("100,000원")).toBeInTheDocument();
      // The fallback year choices stay reachable.
      expect(yearSelect()).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchYears).toHaveBeenCalledTimes(1);
      expect(refetchPrices).not.toHaveBeenCalled();
    });

    it("shows only the prices failure when both failed, and its retry refetches both", () => {
      const refetchYears = jest.fn();
      const refetchPrices = jest.fn();
      setup(failed({ refetch: refetchYears }), failed({ refetch: refetchPrices }));

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(PRICES_TITLE);
      expect(screen.queryByText(YEARS_TITLE)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchYears).toHaveBeenCalledTimes(1);
      expect(refetchPrices).toHaveBeenCalledTimes(1);
    });

    it("shows one stale notice, not also the years alert, when the years failed and cached prices failed to refresh", () => {
      const refetchYears = jest.fn();
      const refetchPrices = jest.fn();
      setup(failed({ refetch: refetchYears }), failedWithData([ROW], { refetch: refetchPrices }));

      expect(screen.getByText("100,000원")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(STALE_TITLE);
      expect(screen.queryByText(YEARS_TITLE)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchYears).toHaveBeenCalledTimes(1);
      expect(refetchPrices).toHaveBeenCalledTimes(1);
    });

    it("disables the year selector while the years are paused, with no alert", () => {
      setup(paused(), loaded([ROW]));

      expect(yearSelect()).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("disables the year selector while the years are loading", () => {
      setup(loading(), loaded([ROW]));

      expect(yearSelect()).toBeDisabled();
    });

    it("leaves the selector enabled and shows no alert once the years loaded", () => {
      setup(loaded([YEAR]), loaded([ROW]));

      expect(yearSelect()).not.toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps cached years and shows one inline notice when only the years refetch failed", () => {
      const refetchYears = jest.fn();
      setup(failedWithData([YEAR], { refetch: refetchYears }), loaded([ROW]));

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(STALE_TITLE);
      expect(yearSelect()).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetchYears).toHaveBeenCalledTimes(1);
    });
  });
});
