import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useAllVoucherPriceInfos, type ContractVoucherPriceInfo } from "../useVoucherData";

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
});
