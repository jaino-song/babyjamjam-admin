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
      queries: {
        retry: false,
      },
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
    name: "Kim",
    workArea: ["Seoul"],
    phone: "010-1234-5678",
    grade: "A",
    openToNextWork,
    registeredDate: null,
    status: openToNextWork ? "available" : "unavailable",
  };
}

function seedEmployeeCaches(queryClient: QueryClient, openToNextWork: boolean) {
  queryClient.setQueryData(employeeQueryKeys.lists(), [employee(openToNextWork)]);
  queryClient.setQueryData(employeeQueryKeys.list({ status: "all" }), [employee(openToNextWork)]);
  queryClient.setQueryData(employeeQueryKeys.detail(7), employee(openToNextWork));
}

describe("useEmployees", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiPatch.mockReset();
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

  it("writes the confirmed status to list and detail caches before a slow refresh settles", async () => {
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

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalled());

    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.list({ status: "all" }))?.[0]?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);
    expect(result.current.mutation.isPending).toBe(true);

    resolveRefresh?.({ data: [employee(true)] });
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
  });

  it("keeps the confirmed cache value when the refresh fails", async () => {
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
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.list({ status: "all" }))?.[0]?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);
  });

  it("cancels an earlier list refresh so its late response cannot overwrite the mutation", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);

    let resolveStaleRefresh: ((response: { data: Employee[] }) => void) | undefined;
    let refreshCount = 0;
    mockedApiGet.mockImplementation(() => {
      refreshCount += 1;
      if (refreshCount === 1) {
        return new Promise((resolve) => {
          resolveStaleRefresh = resolve as (response: { data: Employee[] }) => void;
        });
      }
      return Promise.resolve({ data: [employee(true)] });
    });
    mockedApiPatch.mockResolvedValue({ data: { id: 7, openToNextWork: true } });

    const { result } = renderHook(
      () => ({
        employees: useEmployees({ refetchOnMount: false }),
        mutation: useToggleEmployeeOpenStatus(),
      }),
      { wrapper },
    );

    act(() => {
      void queryClient.refetchQueries({ queryKey: employeeQueryKeys.lists() });
    });
    await waitFor(() => expect(refreshCount).toBe(1));

    act(() => {
      result.current.mutation.mutate({ id: 7, openToNextWork: true });
    });
    await waitFor(() => expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(true));

    resolveStaleRefresh?.({ data: [employee(false)] });
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(true);
  });

  it("does not write an old-branch response into a replacement cache", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);

    let resolveMutation: ((response: { data: Employee }) => void) | undefined;
    mockedApiPatch.mockImplementation(() => new Promise((resolve) => {
      resolveMutation = resolve as (response: { data: Employee }) => void;
    }));

    const { result } = renderHook(() => useToggleEmployeeOpenStatus(), { wrapper });

    act(() => {
      result.current.mutate({ id: 7, openToNextWork: true });
    });
    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalled());

    queryClient.clear();
    seedEmployeeCaches(queryClient, false);
    resolveMutation?.({ data: employee(true) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(false);
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.list({ status: "all" }))?.[0]?.openToNextWork).toBe(false);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(false);
  });

  it("leaves caches unchanged when the mutation fails", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);
    mockedApiPatch.mockRejectedValue(new Error("toggle failed"));

    const { result } = renderHook(() => useToggleEmployeeOpenStatus(), { wrapper });

    act(() => {
      result.current.mutate({ id: 7, openToNextWork: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.openToNextWork).toBe(false);
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.list({ status: "all" }))?.[0]?.openToNextWork).toBe(false);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(false);
  });
});
