import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import {
  employeeQueryKeys,
  type Employee,
  useCreateEmployee,
  useEmployees,
  useUpdateEmployee,
  useToggleEmployeeOpenStatus,
} from "../useEmployees";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockedApiPost = api.post as jest.MockedFunction<typeof api.post>;
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

function employee(openToNextWork: boolean, status: Employee["status"] = openToNextWork ? "available" : "unavailable"): Employee {
  return {
    id: 7,
    name: "홍길동",
    workArea: ["gangnam"],
    phone: "01012345678",
    grade: "A",
    openToNextWork,
    registeredDate: "2026-08-27T00:00:00.000Z",
    status,
  };
}

function seedEmployeeCaches(queryClient: QueryClient, openToNextWork: boolean, status?: Employee["status"]) {
  queryClient.setQueryData(employeeQueryKeys.lists(), [employee(openToNextWork, status)]);
  queryClient.setQueryData(employeeQueryKeys.list({ status: "all" }), [employee(openToNextWork, status)]);
  queryClient.setQueryData(employeeQueryKeys.detail(7), employee(openToNextWork, status));
}

describe("useToggleEmployeeOpenStatus", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiPost.mockReset();
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
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.status).toBe("available");
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.status).toBe("available");

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
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]?.status).toBe("available");
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.openToNextWork).toBe(true);
    expect(queryClient.getQueryData<Employee>(employeeQueryKeys.detail(7))?.status).toBe("available");
  });

  it("preserves a working status while patching availability", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, true, "working");
    mockedApiPatch.mockResolvedValue({ data: { id: 7, openToNextWork: false } });
    mockedApiGet.mockRejectedValue(new Error("refresh failed"));

    const { result } = renderHook(
      () => ({
        employees: useEmployees({ refetchOnMount: false }),
        mutation: useToggleEmployeeOpenStatus(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.mutation.mutate({ id: 7, openToNextWork: false });
    });

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())?.[0]).toEqual(
      expect.objectContaining({ openToNextWork: false, status: "working" }),
    );
  });

  it("recovers the owned list after a failed toggle cancels a background refresh", async () => {
    const { queryClient, wrapper } = createTestContext();
    seedEmployeeCaches(queryClient, false);

    let getCalls = 0;
    mockedApiGet.mockImplementation(() => {
      getCalls += 1;
      if (getCalls === 1) return new Promise(() => undefined);
      return Promise.resolve({ data: [employee(true)] });
    });
    mockedApiPatch.mockRejectedValue(new Error("toggle failed"));

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
    await waitFor(() => expect(getCalls).toBe(1));

    act(() => {
      result.current.mutation.mutate({ id: 7, openToNextWork: true });
    });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    await waitFor(() => expect(getCalls).toBe(2));
    expect(result.current.employees.data).toEqual([employee(true)]);
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

  it("recovers the owned list after a failed create cancels its initial request", async () => {
    const { wrapper } = createTestContext();
    let getCalls = 0;
    mockedApiGet.mockImplementation(() => {
      getCalls += 1;
      if (getCalls === 1) return new Promise(() => undefined);
      return Promise.resolve({ data: [employee(true)] });
    });
    mockedApiPost.mockRejectedValue(new Error("create failed"));

    const { result } = renderHook(
      () => ({
        employees: useEmployees(),
        mutation: useCreateEmployee(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(getCalls).toBe(1));

    act(() => {
      result.current.mutation.mutate({
        name: "실패 생성",
        workArea: ["gangnam"],
        phone: "01099998888",
        grade: "A",
        openToNextWork: true,
      });
    });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    await waitFor(() => expect(getCalls).toBe(2));
    expect(result.current.employees.data).toEqual([employee(true)]);
  });

  it("recovers the owned list after a failed update cancels its initial request", async () => {
    const { wrapper } = createTestContext();
    let getCalls = 0;
    mockedApiGet.mockImplementation(() => {
      getCalls += 1;
      if (getCalls === 1) return new Promise(() => undefined);
      return Promise.resolve({ data: [employee(true)] });
    });
    mockedApiPatch.mockRejectedValue(new Error("update failed"));

    const { result } = renderHook(
      () => ({
        employees: useEmployees(),
        mutation: useUpdateEmployee(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(getCalls).toBe(1));

    act(() => {
      result.current.mutation.mutate({ id: 7, dto: { name: "실패 수정" } });
    });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    await waitFor(() => expect(getCalls).toBe(2));
    expect(result.current.employees.data).toEqual([employee(true)]);
  });

  it("does not refetch a replacement list after a failed create", async () => {
    const { queryClient, wrapper } = createTestContext();
    const branchBEmployee = employee(false);
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);

    let rejectCreate: ((error: Error) => void) | undefined;
    mockedApiPost.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectCreate = reject;
    }));

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    act(() => {
      result.current.mutate({
        name: "지연 실패",
        workArea: ["gangnam"],
        phone: "01099997777",
        grade: "A",
        openToNextWork: true,
      });
    });
    await waitFor(() => expect(mockedApiPost).toHaveBeenCalled());

    queryClient.clear();
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);
    rejectCreate?.(new Error("create failed"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedApiGet).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())).toEqual([branchBEmployee]);
    expect(queryClient.getQueryState(employeeQueryKeys.lists())?.isInvalidated).not.toBe(true);
  });

  it("does not write a late create response into a replacement list cache", async () => {
    const { queryClient, wrapper } = createTestContext();
    const branchBEmployee = employee(false);
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);

    let resolveCreate: ((response: { data: Employee }) => void) | undefined;
    mockedApiPost.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve as (response: { data: Employee }) => void;
    }));

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    act(() => {
      result.current.mutate({
        name: "지연 생성",
        workArea: ["gangnam"],
        phone: "01099998888",
        grade: "A",
        openToNextWork: true,
      });
    });
    await waitFor(() => expect(mockedApiPost).toHaveBeenCalled());

    queryClient.clear();
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);
    resolveCreate?.({ data: { ...employee(true), id: 8, name: "지연 생성" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())).toEqual([branchBEmployee]);
    expect(queryClient.getQueryState(employeeQueryKeys.lists())?.isInvalidated).not.toBe(true);
  });

  it("does not refetch a replacement list after a failed toggle", async () => {
    const { queryClient, wrapper } = createTestContext();
    const branchBEmployee = employee(false);
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);

    let rejectToggle: ((error: Error) => void) | undefined;
    mockedApiPatch.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectToggle = reject;
    }));

    const { result } = renderHook(() => useToggleEmployeeOpenStatus(), { wrapper });
    act(() => {
      result.current.mutate({ id: 7, openToNextWork: true });
    });
    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalled());

    queryClient.clear();
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);
    rejectToggle?.(new Error("toggle failed"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedApiGet).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())).toEqual([branchBEmployee]);
    expect(queryClient.getQueryState(employeeQueryKeys.lists())?.isInvalidated).not.toBe(true);
  });

  it("does not write a late update response into a replacement list cache", async () => {
    const { queryClient, wrapper } = createTestContext();
    const branchBEmployee = employee(false);
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);

    let resolveUpdate: ((response: { data: Employee }) => void) | undefined;
    mockedApiPatch.mockImplementation(() => new Promise((resolve) => {
      resolveUpdate = resolve as (response: { data: Employee }) => void;
    }));

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    act(() => {
      result.current.mutate({
        id: 7,
        dto: { name: "지연 수정" },
      });
    });
    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalledWith(
      "/employees",
      { name: "지연 수정" },
      { params: { id: 7 } },
    ));

    queryClient.clear();
    queryClient.setQueryData(employeeQueryKeys.lists(), [branchBEmployee]);
    resolveUpdate?.({ data: { ...employee(true), name: "지연 수정" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData<Employee[]>(employeeQueryKeys.lists())).toEqual([branchBEmployee]);
    expect(queryClient.getQueryState(employeeQueryKeys.lists())?.isInvalidated).not.toBe(true);
  });
});
