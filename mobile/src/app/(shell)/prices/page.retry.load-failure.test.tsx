import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

  const priceRow = (id: number, type: string) => ({
    id,
    type,
    duration: "10",
    fullPrice: "1,000",
    grant: "500",
    actualPrice: "500",
  });

  it("keeps the loaded row, the count and the notice on screen while a failed type is retried", async () => {
    let secondMode: "fail" | "hold" = "fail";
    let held: { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
    mockedGet.mockImplementation(async (url, config) => {
      if (url === "/voucher-price-infos/years") return { data: [2026] };
      const type = (config as { params: { type: string } }).params.type;
      if (type === SECOND_TYPE) {
        if (secondMode === "fail") throw new Error("price load failed");
        return new Promise((resolve, reject) => {
          held = { resolve, reject };
        });
      }
      return { data: type === FIRST_TYPE ? [priceRow(1, FIRST_TYPE)] : [] };
    });

    renderPage();

    expect(await screen.findByText(FIRST_TYPE)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getByTestId("list-count")).toHaveTextContent("1개");

    // First retry is pending: the loaded row, the count and the notice stay, the retry is disabled.
    secondMode = "hold";
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(held).toBeDefined());
    expect(screen.getByText(FIRST_TYPE)).toBeInTheDocument();
    expect(screen.getByTestId("list-count")).toHaveTextContent("1개");
    expect(screen.queryByTestId("rows-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("count-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /다시 시도/ })).toBeDisabled();

    // The retry fails again: the row is still there and the notice is back with an enabled retry.
    await act(async () => {
      held?.reject(new Error("price load failed again"));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled());
    expect(screen.getByText(FIRST_TYPE)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByTestId("list-count")).toHaveTextContent("1개");

    // The next retry succeeds: the notice goes away and both types' rows show.
    held = undefined;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(held).toBeDefined());
    expect(screen.getByText(FIRST_TYPE)).toBeInTheDocument();
    expect(screen.queryByTestId("rows-skeleton")).not.toBeInTheDocument();
    await act(async () => {
      held?.resolve({ data: [priceRow(2, SECOND_TYPE)] });
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(FIRST_TYPE)).toBeInTheDocument();
    expect(screen.getByText(SECOND_TYPE)).toBeInTheDocument();
    expect(screen.getByTestId("list-count")).toHaveTextContent("2개");
  });

  it("treats a cached empty price list as a real zero when a later refetch fails", async () => {
    let fail = false;
    mockedGet.mockImplementation(async (url) => {
      if (url === "/voucher-price-infos/years") return { data: [2026] };
      if (fail) throw new Error("price load failed");
      return { data: [] };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PricesPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("조건에 맞는 가격표가 없습니다.")).toBeInTheDocument();
    expect(screen.getByTestId("list-count")).toHaveTextContent("0개");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fail = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["voucher-price-infos"] });
    });

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.queryByText("가격 정보를 불러오지 못했습니다")).not.toBeInTheDocument();
    expect(screen.getByTestId("list-count")).toHaveTextContent("0개");
    expect(screen.getByTestId("filter-count-전체")).toHaveTextContent("0");
    expect(screen.getByText("조건에 맞는 가격표가 없습니다.")).toBeInTheDocument();
  });

  it("guards the first load: skeletons without an alert, then the panel failure with unknown counts when every type fails", async () => {
    const releases: Array<() => void> = [];
    mockedGet.mockImplementation(async (url) => {
      if (url === "/voucher-price-infos/years") return { data: [2026] };
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      throw new Error("price load failed");
    });

    renderPage();

    expect(await screen.findByTestId("rows-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await waitFor(() => expect(releases.length).toBe(VOUCHER_TYPES.length));
    await act(async () => {
      releases.forEach((release) => release());
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("가격 정보를 불러오지 못했습니다");
    expect(screen.getByTestId("filter-count-전체")).toHaveTextContent("—");
  });
});
