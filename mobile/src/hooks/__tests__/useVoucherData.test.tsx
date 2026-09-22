import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import {
  useAllVoucherPriceInfos,
  useAllVoucherPrices,
  type ContractVoucherPriceInfo,
} from "../useVoucherData";

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
    const { result } = renderHook(() => useAllVoucherPrices(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockedApiGet).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it("uses one year-scoped request and preserves nullable contract fields", async () => {
    const contractPrices: ContractVoucherPriceInfo[] = [
      {
        type: "D-통합1형",
        duration: "15",
        fullPrice: null,
        grant: "100000",
        actualPrice: null,
        year: 2026,
      },
      {
        type: "D-통합1형",
        duration: null,
        fullPrice: "200000",
        grant: null,
        actualPrice: "200000",
        year: 2026,
      },
    ];
    mockedApiGet.mockResolvedValue({ data: contractPrices });

    const { result } = renderHook(() => useAllVoucherPrices(2026), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(contractPrices));

    expect(mockedApiGet).toHaveBeenCalledTimes(1);
    expect(mockedApiGet).toHaveBeenCalledWith("/voucher-price-infos/contract-view", {
      params: { year: 2026 },
    });
  });

  it("shares the contract-view cache with useAllVoucherPriceInfos", async () => {
    const contractPrice: ContractVoucherPriceInfo = {
      type: "A통합1형",
      duration: "15",
      fullPrice: "100000",
      grant: "50000",
      actualPrice: "50000",
      year: 2026,
    };
    mockedApiGet.mockResolvedValue({ data: [contractPrice] });

    const { result } = renderHook(
      () => ({
        infos: useAllVoucherPriceInfos(2026),
        prices: useAllVoucherPrices(2026),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.prices.data).toEqual([contractPrice]));
    expect(result.current.infos.data).toEqual([contractPrice]);
    expect(mockedApiGet).toHaveBeenCalledTimes(1);
  });

  it("returns an empty data array while exposing contract-view errors", async () => {
    mockedApiGet.mockRejectedValue(new Error("contract-view failed"));

    const { result } = renderHook(() => useAllVoucherPrices(2026), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
