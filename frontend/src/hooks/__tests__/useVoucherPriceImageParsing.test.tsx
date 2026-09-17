import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { voucherQueryKeys } from "../useVoucherData";
import { useBulkUpdateVoucherPrices } from "../useVoucherPriceImageParsing";

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedPost = jest.mocked(api.post);

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const bulkUpdateRequest = {
  items: [
    {
      type: "A가1",
      duration: 5,
      fullPrice: "100000",
      grant: "80000",
      actualPrice: "20000",
    },
  ],
  year: 2027,
};

describe("useBulkUpdateVoucherPrices", () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it("invalidates selected-year prices, type prices, and the voucher year list after success", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const selectedYearPricesKey = voucherQueryKeys.allVoucherPriceInfos(bulkUpdateRequest.year);
    const selectedTypePricesKey = voucherQueryKeys.voucherPriceInfos("A가1", bulkUpdateRequest.year);
    const voucherYearsKey = voucherQueryKeys.voucherYears;
    queryClient.setQueryData(selectedYearPricesKey, [{ id: 1 }]);
    queryClient.setQueryData(selectedTypePricesKey, [{ id: 1 }]);
    queryClient.setQueryData(voucherYearsKey, [2026]);
    mockedPost.mockResolvedValueOnce({
      data: { updated: [1], created: [], errors: [] },
    } as never);

    const { result } = renderHook(() => useBulkUpdateVoucherPrices(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(bulkUpdateRequest);
    });

    expect(queryClient.getQueryState(selectedYearPricesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(selectedTypePricesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(voucherYearsKey)?.isInvalidated).toBe(true);
  });

  it("does not invalidate voucher queries when the bulk update fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const selectedYearPricesKey = voucherQueryKeys.allVoucherPriceInfos(bulkUpdateRequest.year);
    const selectedTypePricesKey = voucherQueryKeys.voucherPriceInfos("A가1", bulkUpdateRequest.year);
    const voucherYearsKey = voucherQueryKeys.voucherYears;
    queryClient.setQueryData(selectedYearPricesKey, [{ id: 1 }]);
    queryClient.setQueryData(selectedTypePricesKey, [{ id: 1 }]);
    queryClient.setQueryData(voucherYearsKey, [2026]);
    mockedPost.mockRejectedValueOnce(new Error("bulk update failed"));

    const { result } = renderHook(() => useBulkUpdateVoucherPrices(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(bulkUpdateRequest)).rejects.toThrow(
        "bulk update failed",
      );
    });

    expect(queryClient.getQueryState(selectedYearPricesKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(selectedTypePricesKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(voucherYearsKey)?.isInvalidated).toBe(false);
  });
});
