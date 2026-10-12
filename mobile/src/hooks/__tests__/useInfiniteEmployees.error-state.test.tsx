import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useInfiniteEmployees } from "../useInfiniteEmployees";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

describe("useInfiniteEmployees query state exposure", () => {
  it("exposes failure, fetching and refetch recovery from the real query", async () => {
    const failure = new Error("network unavailable");
    const get = jest.mocked(api.get);
    get.mockRejectedValueOnce(failure);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useInfiniteEmployees(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.allEmployees).toEqual([]);
    expect(result.current.isFetching).toBe(false);
    expect(typeof result.current.refetch).toBe("function");

    let resolveFetch!: (value: { data: never[] }) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    act(() => { void result.current.refetch(); });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    await act(async () => { resolveFetch({ data: [] }); });
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.isFetching).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });
});
