import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useBulkUpdateVoucherPrices, useParseVoucherImage } from "../useVoucherPriceImageParsing";

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedApiPost = api.post as jest.MockedFunction<typeof api.post>;

function createWrapper(queryClient: QueryClient) {
  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useVoucherPriceImageParsing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockedApiPost.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("lets the browser attach multipart boundaries for image parsing uploads", async () => {
    mockedApiPost.mockResolvedValue({
      data: { parsedData: [], hasValidationWarnings: false, warnings: [] },
    });
    const file = new File(["image"], "prices.png", { type: "image/png" });

    const { result } = renderHook(() => useParseVoucherImage(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(file);
    });

    expect(mockedApiPost).toHaveBeenCalledWith(
      "/voucher-price-infos/parse-image",
      expect.any(FormData),
      expect.objectContaining({
        timeout: 120000,
      }),
    );
    expect(mockedApiPost.mock.calls[0][2]?.headers).toBeUndefined();
  });

  it("invalidates every voucher price query variant after bulk updates", async () => {
    mockedApiPost.mockResolvedValue({ data: { updated: [1], created: [], errors: [] } });
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useBulkUpdateVoucherPrices(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        year: 2026,
        items: [
          {
            type: "A",
            duration: 10,
            fullPrice: "100",
            grant: "80",
            actualPrice: "20",
          },
        ],
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["voucher-price-infos"],
    });
  });
});
