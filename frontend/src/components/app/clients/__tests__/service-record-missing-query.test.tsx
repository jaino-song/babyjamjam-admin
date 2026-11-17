import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clientKeys } from "@/features/clients/hooks/keys";
import { useServiceRecordMissingClients } from "@/features/clients/hooks/use-clients";
import { api } from "@/lib/api/client";
import { clientsApi } from "@/features/clients/api/clients.api";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
jest.mock("@/features/clients/api/clients.api", () => ({ clientsApi: { listServiceRecordMissing: jest.fn() } }));
const mockList = jest.mocked(clientsApi.listServiceRecordMissing);
const data = { count: 1, items: [{ clientId: 1, clientName: "QA-A", primaryEmployeeName: "QA-P", unwrittenThroughSessionIndex: 2 }] };

beforeEach(() => {
  mockList.mockReset();
  document.cookie = "selected_branch_id=; max-age=0; path=/";
});
afterEach(() => { document.cookie = "selected_branch_id=; max-age=0; path=/"; });

it("includes branch scope under the mutation invalidation prefix", () => {
  expect(clientKeys.serviceRecordMissing("a")).toEqual(["clients", "service-record-missing", { branchId: "a" }]);
  expect(clientKeys.serviceRecordMissing("a")).not.toEqual(clientKeys.serviceRecordMissing("b"));
  expect(clientKeys.serviceRecordMissing(null)).toEqual(["clients", "service-record-missing", { branchId: "unavailable" }]);
});

it("waits for branch readiness, keeps data after refresh errors, and hides previous branch data", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  mockList.mockResolvedValue({ data } as Awaited<ReturnType<typeof clientsApi.listServiceRecordMissing>>);
  const { result } = renderHook(() => useServiceRecordMissingClients(), { wrapper });
  expect(result.current.data).toBeUndefined();
  expect(mockList).not.toHaveBeenCalled();
  act(() => { document.cookie = "selected_branch_id=a; path=/"; window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.data).toEqual(data));
  mockList.mockRejectedValue(new Error("offline"));
  await act(async () => { await result.current.refetch(); });
  expect(result.current.data).toEqual(data);
  await waitFor(() => expect(result.current.isRefetchError).toBe(true));
  act(() => { document.cookie = "selected_branch_id=b; path=/"; window.dispatchEvent(new Event("focus")); });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
  queryClient.clear();
});

it("enters the error state when the API body is list-shaped", async () => {
  document.cookie = "selected_branch_id=a; path=/";
  const actualApi = jest.requireActual<typeof import("@/features/clients/api/clients.api")>("@/features/clients/api/clients.api");
  mockList.mockImplementation(actualApi.clientsApi.listServiceRecordMissing);
  jest.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0 } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useServiceRecordMissingClients(), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBeInstanceOf(Error);
  expect(result.current.data).toBeUndefined();
  queryClient.clear();
});
