import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useMessageTemplates } from "../use-message-templates";

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

describe("useMessageTemplates", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it.each([
    [{ id: "array-template", name: "Array template" }],
    { data: [{ id: "data-template", name: "Data template" }] },
    { items: [{ id: "items-template", name: "Items template" }] },
  ])("accepts the supported template list response shape", async (payload) => {
    mockedApiGet.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useMessageTemplates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
  });

  it("keeps a valid empty template list as a successful read", async () => {
    mockedApiGet.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useMessageTemplates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("surfaces malformed template list responses as query errors", async () => {
    mockedApiGet.mockResolvedValue({ data: { templates: [] } });

    const { result } = renderHook(() => useMessageTemplates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("surfaces failed template list requests as query errors", async () => {
    mockedApiGet.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useMessageTemplates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });
});
