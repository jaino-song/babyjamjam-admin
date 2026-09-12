import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useNotifications, useUnreadCount } from "../usePushNotification";

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

describe("notification read queries", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it.each([
    [{ id: 1 }],
    { data: [{ id: 2 }] },
    { items: [{ id: 3 }] },
  ])("accepts the supported notification list response shape", async (payload) => {
    mockedApiGet.mockResolvedValue({ data: payload });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
  });

  it("keeps a valid empty notification list as a successful read", async () => {
    mockedApiGet.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("surfaces a failed notification list request instead of returning an empty list", async () => {
    mockedApiGet.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("surfaces malformed notification list responses as query errors", async () => {
    mockedApiGet.mockResolvedValue({ data: { notifications: [] } });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("keeps a valid unread count of zero as a successful read", async () => {
    mockedApiGet.mockResolvedValue({ data: { count: 0 } });

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(0);
  });

  it.each([
    { data: {} },
    { data: { count: "0" } },
    { data: { count: -1 } },
  ])("surfaces malformed unread count responses as query errors", async (response) => {
    mockedApiGet.mockResolvedValue(response);

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("surfaces a failed unread count request instead of confirming zero", async () => {
    mockedApiGet.mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });
});
