import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import {
  employeeQueryKeys,
  type Employee,
  useEmployees,
  useToggleEmployeeOpenStatus,
} from "../useEmployees";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockedApiPatch = api.patch as jest.MockedFunction<typeof api.patch>;

function createTestContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  return { queryClient, wrapper };
}

function createWrapper() {
  return createTestContext().wrapper;
}

function employee(openToNextWork: boolean): Employee {
  return {
    id: 7,
    name: "홍길동",
    workArea: ["gangnam"],
    phone: "01012345678",
    grade: "A",
    openToNextWork,
    registeredDate: "2026-08-27T00:00:00.000Z",
    status: openToNextWork ? "available" : "unavailable",
  };
}

function seedEmployeeCaches(queryClient: QueryClient, openToNextWork: boolean) {
  queryClient.setQueryData(employeeQueryKeys.lists(), [employee(openToNextWork)]);
  queryClient.setQueryData(employeeQueryKeys.list({ status: "all" }), [employee(openToNextWork)]);
  queryClient.setQueryData(employeeQueryKeys.detail(7), employee(openToNextWork));
}

describe("useToggleEmployeeOpenStatus", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiPatch.mockReset();
  });

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

  it("keeps the confirmed value visible while the invalidated list refetch is deferred", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);

    let resolveRefresh: ((response: { data: Employee[] }) => void) | undefined;
    mockedApiGet.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve as (response: { data: Employee[] }) => void;
    }));
    mockedApiPatch.mockResolvedValue({ data: { id: 7, openToNextWork: true } });

    const { result } = renderHook(
      () => ({
        employees: useEmployees({ refetchOnMount: false }),
        mutation: useToggleEmployeeOpenStatus(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.mutation.mutate({ id: 7, openToNextWork: true });
    });

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);

    resolveRefresh?.({ data: [employee(true)] });
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
  });

  it("keeps the confirmed value when the invalidated list refetch fails", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);
    mockedApiPatch.mockResolvedValue({ data: { id: 7, openToNextWork: true } });
    mockedApiGet.mockRejectedValue(new Error("refresh failed"));

    const { result } = renderHook(
      () => ({
        employees: useEmployees({ refetchOnMount: false }),
        mutation: useToggleEmployeeOpenStatus(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.mutation.mutate({ id: 7, openToNextWork: true });
    });

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(result.current.employees.isError).toBe(true);
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);
  });

  it("leaves list and detail caches unchanged when the mutation fails", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);
    mockedApiPatch.mockRejectedValue(new Error("toggle failed"));

    const { result } = renderHook(() => useToggleEmployeeOpenStatus(), { wrapper });

    act(() => {
      result.current.mutate({ id: 7, openToNextWork: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(false);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(false);
  });
});
