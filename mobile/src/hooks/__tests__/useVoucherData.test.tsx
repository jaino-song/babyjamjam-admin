import { act, renderHook, waitFor } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useAllVoucherPriceInfos, useAllVoucherPrices, voucherQueryKeys, VOUCHER_TYPES, type ContractVoucherPriceInfo } from "../useVoucherData";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;

function createWrapper(queryClient: QueryClient) {
  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useVoucherData contract price reads", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockedApiGet.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("uses the year-scoped contract-view read endpoint", async () => {
    const contractPrice: ContractVoucherPriceInfo = {
      type: "A통합1형",
      duration: null,
      fullPrice: "2196000",
      grant: null,
      actualPrice: "2196000",
      year: 2026,
    };

    mockedApiGet.mockResolvedValue({
      data: [contractPrice],
    });

    const { result } = renderHook(() => useAllVoucherPriceInfos(2026), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual([contractPrice]));

    expect(mockedApiGet).toHaveBeenCalledWith("/voucher-price-infos/contract-view", {
      params: { year: 2026 },
    });
    expect(result.current.data?.[0]).not.toHaveProperty("id");
  });

  it("does not request a contract price table without a resolved year", () => {
    renderHook(() => useAllVoucherPriceInfos(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("reports paused when offline with no price data", () => {
    mockedApiGet.mockResolvedValue({ data: [] });
    onlineManager.setOnline(false);
    try {
      const { result } = renderHook(() => useAllVoucherPrices(2026), { wrapper: createWrapper(queryClient) });
      expect(result.current.isPaused).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(mockedApiGet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("does not report paused for online prices", async () => {
    mockedApiGet.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useAllVoucherPrices(2026), { wrapper: createWrapper(queryClient) });
    expect(result.current.isPaused).toBe(false);
    await waitFor(() => expect(result.current.isDataComplete).toBe(true));
    expect(result.current.isPaused).toBe(false);
  });

  it("does not report paused for a disabled year even offline", () => {
    onlineManager.setOnline(false);
    try {
      const { result } = renderHook(() => useAllVoucherPrices(), { wrapper: createWrapper(queryClient) });
      expect(result.current.isPaused).toBe(false);
      expect(mockedApiGet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("does not report paused during an offline refetch with cached empty data", async () => {
    mockedApiGet.mockResolvedValue({ data: [] });
    VOUCHER_TYPES.forEach((type) => queryClient.setQueryData(voucherQueryKeys.voucherPriceInfos(type, 2026), []));
    onlineManager.setOnline(false);
    try {
      const { result } = renderHook(() => useAllVoucherPrices(2026), { wrapper: createWrapper(queryClient) });
      act(() => { void queryClient.refetchQueries({ queryKey: ["voucher-price-infos"] }); });
      await waitFor(() => expect(queryClient.getQueryState(voucherQueryKeys.voucherPriceInfos(VOUCHER_TYPES[0], 2026))?.fetchStatus).toBe("paused"));
      expect(result.current.isPaused).toBe(false);
      expect(result.current.isDataComplete).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
