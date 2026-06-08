import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useClient } from "../useClients";

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
