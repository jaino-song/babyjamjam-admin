import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useAllVoucherPriceInfos } from "../useVoucherData";

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
    mockedApiGet.mockResolvedValue({
      data: [
        {
          type: "A통합1형",
          duration: "15",
          fullPrice: "2196000",
          grant: "1303000",
          actualPrice: "893000",
          year: 2026,
        },
      ],
    });

    const { result } = renderHook(() => useAllVoucherPriceInfos(2026), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(mockedApiGet).toHaveBeenCalledWith("/voucher-price-infos/contract-view", {
      params: { year: 2026 },
    });
  });

  it("does not request a contract price table without a resolved year", () => {
    renderHook(() => useAllVoucherPriceInfos(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockedApiGet).not.toHaveBeenCalled();
  });
});
