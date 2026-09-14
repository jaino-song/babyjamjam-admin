import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useAllClients, useClient } from "../useClients";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useClient", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not fetch client details for invalid id %s",
    async (id) => {
      renderHook(() => useClient(id), {
        wrapper: createWrapper(),
      });

      await Promise.resolve();

      expect(mockedApiGet).not.toHaveBeenCalled();
    }
  );

  it("fetches client details for positive finite ids", async () => {
    mockedApiGet.mockResolvedValue({ data: { id: 7, name: "Client 7" } });

    const { result } = renderHook(() => useClient(7), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.id).toBe(7));

    expect(mockedApiGet).toHaveBeenCalledWith("/clients/7");
  });
});

describe("useAllClients", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it.each([
    [{ id: 1, name: "Array client" }],
    { data: [{ id: 2, name: "Data client" }] },
    { items: [{ id: 3, name: "Items client" }] },
  ])("accepts the supported client list response shape", async (payload) => {
    mockedApiGet.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useAllClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
  });

  it("keeps a valid empty client list as a successful read", async () => {
    mockedApiGet.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useAllClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("surfaces malformed client list responses as query errors", async () => {
    mockedApiGet.mockResolvedValue({ data: { clients: [] } });

    const { result } = renderHook(() => useAllClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("surfaces failed client list requests as query errors", async () => {
    mockedApiGet.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useAllClients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });
});
