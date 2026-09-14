import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";

import { useInfiniteEmployees } from "../useInfiniteEmployees";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;

const employees = [
  {
    id: 1,
    name: "하나",
    workArea: ["인천 서구"],
    phone: "01011112222",
    grade: "관리사",
    openToNextWork: true,
    registeredDate: null,
    status: "available",
  },
  {
    id: 2,
    name: "둘",
    workArea: ["인천 남동구"],
    phone: "01022223333",
    grade: "관리사",
    openToNextWork: true,
    registeredDate: null,
    status: "available",
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useInfiniteEmployees shared search", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiGet.mockResolvedValue({ data: employees });
  });

  it.each([
    ["+82 10 1111", 1],
    ["010-1111", 1],
    ["ㅎㄴ", 1],
    ["남동", 2],
  ])("filters employee records by shared fields for %s", async (search, expectedId) => {
    const { result } = renderHook(() => useInfiniteEmployees({ search }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.employees.map((employee) => employee.id)).toEqual([expectedId]);
  });
});
