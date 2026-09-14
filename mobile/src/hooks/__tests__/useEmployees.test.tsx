import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useEmployees } from "../useEmployees";

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

describe("useEmployees", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it("keeps a valid array payload succeeding", async () => {
    mockedApiGet.mockResolvedValue({
      data: [{ id: 7, name: "Kim" }],
    });

    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([{ id: 7, name: "Kim" }]);
  });

  it("unwraps a valid data envelope", async () => {
    mockedApiGet.mockResolvedValue({
      data: { data: [{ id: 7, name: "Kim" }] },
    });

    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([{ id: 7, name: "Kim" }]);
  });

  it("unwraps a valid items envelope", async () => {
    mockedApiGet.mockResolvedValue({
      data: { items: [{ id: 7, name: "Kim" }] },
    });

    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([{ id: 7, name: "Kim" }]);
  });

  // 읽기 실패를 빈 목록 성공으로 위장하지 않는다: 예상 밖 응답은
  // 쿼리를 실패시켜 UI의 에러 분기가 안전한 메시지를 노출한다.
  it("rejects a malformed payload with the safe Korean message", async () => {
    mockedApiGet.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("직원 목록 응답을 확인할 수 없습니다.");
  });

  it("rejects a non-object payload with the safe Korean message", async () => {
    mockedApiGet.mockResolvedValue({ data: "unexpected" });

    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("직원 목록 응답을 확인할 수 없습니다.");
  });
});
