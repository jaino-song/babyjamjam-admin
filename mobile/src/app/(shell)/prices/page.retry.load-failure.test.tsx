import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { VOUCHER_TYPES } from "@/hooks/useVoucherData";

import PricesPage from "./page";

// Real hooks and a real QueryClient: this file proves that the retry button of the prices page
// reaches the failed voucher-type queries (the hook's refetch), which the mocked-hook tests cannot.

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "staff" }, isLoading: false }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ beforeFilters, children }: { beforeFilters?: React.ReactNode; children: React.ReactNode }) => (
    <div data-component="test-prices-list-card">{beforeFilters}{children}</div>
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

const mockedGet = jest.mocked(api.get);

const [FIRST_TYPE, SECOND_TYPE] = VOUCHER_TYPES;

function priceCalls(type: string) {
  return mockedGet.mock.calls.filter(
    ([url, config]) =>
      url === "/voucher-price-infos/type" && (config as { params: { type: string } }).params.type === type,
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PricesPage />
    </QueryClientProvider>,
  );
}

describe("mobile prices page retry with the real hooks", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("retries only the failed voucher types and clears the notice once they load", async () => {
    let secondTypeFails = true;
    mockedGet.mockImplementation(async (url, config) => {
      if (url === "/voucher-price-infos/years") return { data: [2026] };
      const type = (config as { params: { type: string } }).params.type;
      if (type === SECOND_TYPE && secondTypeFails) throw new Error("price load failed");
      if (type === FIRST_TYPE || type === SECOND_TYPE) {
        return { data: [{ id: type === FIRST_TYPE ? 1 : 2, type, duration: "10", fullPrice: "1,000", grant: "500", actualPrice: "500" }] };
      }
      return { data: [] };
    });

    renderPage();

    // One type failed, another loaded: the rows are kept and the failure is a notice above them.
    expect(await screen.findByText(FIRST_TYPE)).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(priceCalls(FIRST_TYPE)).toHaveLength(1);
    expect(priceCalls(SECOND_TYPE)).toHaveLength(1);

    secondTypeFails = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(SECOND_TYPE)).toBeInTheDocument();
    expect(priceCalls(SECOND_TYPE)).toHaveLength(2);
    expect(priceCalls(FIRST_TYPE)).toHaveLength(1);
  });

  it("shows the failure panel, not the empty text, when every price request failed, and retry reloads", async () => {
    let fail = true;
    mockedGet.mockImplementation(async (url, config) => {
      if (url === "/voucher-price-infos/years") return { data: [2026] };
      if (fail) throw new Error("price load failed");
      const type = (config as { params: { type: string } }).params.type;
      return { data: type === FIRST_TYPE ? [{ id: 1, type, duration: "10", fullPrice: "1,000", grant: "500", actualPrice: "500" }] : [] };
    });

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("가격 정보를 불러오지 못했습니다");
    expect(screen.queryByText("조건에 맞는 가격표가 없습니다.")).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText(FIRST_TYPE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
