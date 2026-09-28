import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useToggleEmployeeOpenStatus } from "../useEmployees";

jest.mock("@/lib/api/client", () => ({
  api: {
    patch: jest.fn(),
  },
}));

const mockedApiPatch = api.patch as jest.MockedFunction<typeof api.patch>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useToggleEmployeeOpenStatus", () => {
  beforeEach(() => mockedApiPatch.mockReset());

  it("uses the dedicated open-status endpoint with only the availability field", async () => {
    mockedApiPatch.mockResolvedValue({ data: { id: 7, openToNextWork: false } });

    const { result } = renderHook(() => useToggleEmployeeOpenStatus(), { wrapper: createWrapper() });

    result.current.mutate({ id: 7, openToNextWork: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApiPatch).toHaveBeenCalledWith(
      "/employees/open-status",
      { openToNextWork: false },
      { params: { id: 7 } },
    );
  });
});
