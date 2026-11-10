import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

import { voucherQueryKeys } from "@/hooks/useVoucherData";
import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientDetailPanel } from "../ClientDetailPanel";

jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: null }) }));
jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useConfirmBooking: () => ({ isPending: false }),
}));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => {
  const query = { items: [], data: undefined, isLoading: false, isError: false };
  return {
    useClientMessageHistory: () => query,
    useClientUpcomingMessageTriggerJobs: () => query,
    useRetryMessageHistory: () => ({ isPending: false }),
    useResendMessageTriggerJob: () => ({ isPending: false }),
  };
});
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  ...jest.requireActual("@/features/service-records/hooks/use-service-records"),
  useClientServiceRecords: () => ({ data: undefined, isLoading: false }),
  useClientServiceRecordRevisionHistory: () => ({ data: undefined, isLoading: false }),
  useRetryServiceRecordDocument: () => ({ isPending: false }),
}));
jest.mock("@/services/api", () => ({
  eformsignApi: { getDocumentsByClientId: jest.fn(async () => []), getLinkConfirmations: jest.fn(async () => []) },
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

const mockApiGet = jest.mocked(api.get);
const prefix = "desktop_clients-detail_panel";
const baseClient: Client = {
  id: 1, name: "테스트 고객", createdAt: "2025-01-01", birthday: "900101", dueDate: null, birthDate: null,
  address: "테스트 주소", phone: "010-0000-0000", primaryEmployee: null, secondaryEmployee: null,
  type: "A가1형", duration: 10, fullPrice: "1000", grant: "600", actualPrice: "400", startDate: null,
  endDate: "2025-12-15", careCenter: false, voucherClient: true, breastPump: false,
  serviceStatus: "waiting", bookingConfirmedAt: null, eDocId: null, hasSigned: false, documentStatus: null,
};
let queryClient: QueryClient;
let priceState: "loaded" | "loading" | "error" | "empty";
let availableYears: number[];

function panel(client: Client) {
  return <QueryClientProvider client={queryClient}>
    <ClientDetailPanel client={client} trailing={null} dataComponentPrefix={prefix} />
  </QueryClientProvider>;
}

function durationValue() {
  const card = document.querySelector(`[data-component="${prefix}_content_basic_grid_service-card"]`);
  if (!(card instanceof HTMLElement)) throw new Error("Missing actual service InfoCard");
  const row = within(card).getByText("서비스 기간").closest('[data-source-component="InfoRow"]');
  if (!(row instanceof HTMLElement)) throw new Error("Missing actual duration InfoRow");
  return row.querySelector(`[data-component="${prefix}_content_basic_grid_service-card_row_value"]`);
}

async function expectDuration(label: string) {
  await waitFor(() => expect(durationValue()).toHaveTextContent(label));
  expect(durationValue()?.textContent).toBe(label);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  priceState = "loaded";
  availableYears = [2025, 2026];
  mockApiGet.mockReset();
  mockApiGet.mockImplementation(async (url, config) => {
    if (url === "/voucher-price-infos/years") return { data: availableYears };
    if (url === "/voucher-price-infos/type") {
      if (priceState === "loading") return new Promise<never>(() => {});
      if (priceState === "error") throw new Error("fake metadata failure");
      const { type, year } = (config?.params ?? {}) as { type?: string; year?: number };
      const durations = priceState === "empty" ? [] : type === "A통합1형" || year === 2026 ? [10, 15, 20] : [5, 10, 15];
      return { data: durations.map((duration) => ({ id: duration, type, duration: String(duration), fullPrice: "1000", grant: "600", actualPrice: "400" })) };
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe("ClientDetailPanel actual service-card voucher duration", () => {
  it.each(["2025-12-15", "2025-12-15T00:00:00.000Z"])("uses the historical year for stored endDate %s", async (endDate) => {
    render(panel({ ...baseClient, endDate }));
    await expectDuration("10일 (표준형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2025 } });
    expect(mockApiGet).not.toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2026 } });
  });

  it.each([
    [2025, 5, "5일 (단축형)"], [2025, 10, "10일 (표준형)"], [2025, 15, "15일 (연장형)"],
    [2026, 10, "10일 (단축형)"], [2026, 15, "15일 (표준형)"], [2026, 20, "20일 (연장형)"],
  ])("renders year %s duration %s as %s", async (year, duration, expected) => {
    render(panel({ ...baseClient, endDate: `${year}-12-15`, duration }));
    await expectDuration(expected);
  });

  it("refreshes metadata on type, year and selected-client changes", async () => {
    const { rerender } = render(panel(baseClient));
    await expectDuration("10일 (표준형)");
    rerender(panel({ ...baseClient, type: "A통합1형" }));
    await expectDuration("10일 (단축형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A통합1형", year: 2025 } });
    rerender(panel(baseClient));
    await expectDuration("10일 (표준형)");
    rerender(panel({ ...baseClient, endDate: "2026-12-15T00:00:00.000Z" }));
    await expectDuration("10일 (단축형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2026 } });
    rerender(panel({ ...baseClient, id: 2, duration: 15 }));
    await expectDuration("15일 (연장형)");
  });

  it.each([
    "2025-12-15T12:30:45Z",
    "2025-12-15T12:30:45",
    "2025-12-15T12:30:45.123+09:00",
    "2026-01-01T00:30:00+09:00",
  ])("normalizes a valid ISO timestamp to its UTC date: %s", async (endDate) => {
    render(panel({ ...baseClient, endDate }));
    await expectDuration("10일 (표준형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2025 } });
  });

  it("uses the following UTC year when an ISO offset crosses New Year", async () => {
    render(panel({ ...baseClient, endDate: "2025-12-31T23:30:00-09:00" }));
    await expectDuration("10일 (단축형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2026 } });
  });

  it.each([
    "2025-02-30", "2025-02-30T00:00:00.000Z", "2025-13-15T00:00:00Z",
    "2025-12-15T25:00:00Z", "2025-12-15T24:00:00Z", "2025-12-15T00:60:00Z",
    "2025-12-15T00:00:00+99:00", "2025-12-15Tgarbage", "2025-12-15 trailing",
    "December 15, 2025", "2025/12/15", "2025-12-15 00:00:00Z", "2024-12-15", "", null,
  ])("retains the current/latest available-year fallback for %s", async (endDate) => {
    const currentYear = new Date().getFullYear();
    const fallbackYear = availableYears.includes(currentYear) ? currentYear : Math.max(...availableYears);
    render(panel({ ...baseClient, endDate }));
    await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherPriceInfos("A가1형", fallbackYear))?.status).toBe("success"));
    await expectDuration(fallbackYear === 2026 ? "10일 (단축형)" : "10일 (표준형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: fallbackYear } });
    expect(mockApiGet).not.toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2025 } });
  });

  it("uses the latest available year when the current and stored years are unavailable", async () => {
    availableYears = [2023, 2024].filter((year) => year !== new Date().getFullYear());
    const latestYear = Math.max(...availableYears);
    render(panel({ ...baseClient, endDate: "2025-12-15T00:00:00.000Z" }));
    await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherPriceInfos("A가1형", latestYear))?.status).toBe("success"));
    await expectDuration("10일 (표준형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: latestYear } });
  });

  it("falls back to the current year when it is available", async () => {
    const currentYear = new Date().getFullYear();
    availableYears = [currentYear, currentYear + 1];
    render(panel({ ...baseClient, endDate: null }));
    await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherPriceInfos("A가1형", currentYear))?.status).toBe("success"));
    await expectDuration(currentYear === 2026 ? "10일 (단축형)" : "10일 (표준형)");
  });

  it("uses a valid stored year even when the available-years metadata is empty", async () => {
    availableYears = [];
    render(panel({ ...baseClient, endDate: "2025-12-15T00:00:00.000Z" }));
    await expectDuration("10일 (표준형)");
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2025 } });
  });

  it.each(["loading", "error", "empty"] as const)("uses a plain label while metadata is %s", async (state) => {
    priceState = state;
    render(panel(baseClient));
    const queryKey = voucherQueryKeys.voucherPriceInfos("A가1형", 2025);
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe(state === "loading" ? "pending" : state === "error" ? "error" : "success"));
    await expectDuration("10일");
  });

  it.each([
    { type: null, voucherClient: true, duration: 10, expected: "10일" },
    { type: "A가1형", voucherClient: false, duration: 10, expected: "10일" },
    { type: "A가1형", voucherClient: true, duration: null, expected: "-" },
    { type: "A가1형", voucherClient: true, duration: 25, expected: "25일" },
  ])("keeps the fallback for $expected with type=$type voucher=$voucherClient", async ({ expected, ...overrides }) => {
    render(panel({ ...baseClient, ...overrides }));
    await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherYears)?.status).toBe("success"));
    if (overrides.type && overrides.voucherClient) {
      await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherPriceInfos(overrides.type, 2025))?.status).toBe("success"));
    } else {
      expect(mockApiGet.mock.calls.filter(([url]) => url === "/voucher-price-infos/type")).toHaveLength(0);
    }
    await expectDuration(expected);
    expect(screen.getByText("서비스 정보")).toBeInTheDocument();
  });
});
