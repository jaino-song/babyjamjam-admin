import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { clientKeys } from "@/features/clients/hooks/keys";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import { serviceRecordsApi } from "../api/service-records.api";
import { serviceRecordKeys } from "./keys";
import { useFitPeriodMismatch, useKeepPeriodMismatch } from "./use-service-records";

jest.mock("../api/service-records.api", () => ({
    serviceRecordsApi: { keepPeriodMismatch: jest.fn(), fitPeriodMismatch: jest.fn() },
}));

it("refetches the overview on keep and the overview, clients and dashboard on fit", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    const overview = jest.fn().mockResolvedValue("refreshed overview");
    const detail = jest.fn().mockResolvedValue("refreshed detail");
    const directory = jest.fn().mockResolvedValue("refreshed directory");
    const summary = jest.fn().mockResolvedValue("refreshed summary");
    const dashboard = jest.fn().mockResolvedValue("refreshed dashboard");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    jest.mocked(serviceRecordsApi.keepPeriodMismatch).mockResolvedValue({ data: { keptSessionIndexes: [1] } } as Awaited<ReturnType<typeof serviceRecordsApi.keepPeriodMismatch>>);
    jest.mocked(serviceRecordsApi.fitPeriodMismatch).mockResolvedValue({ data: { startDate: "2026-08-07", endDate: "2026-08-20" } } as Awaited<ReturnType<typeof serviceRecordsApi.fitPeriodMismatch>>);
    const { result, unmount } = renderHook(() => {
        const currentOverview = useQuery({ queryKey: serviceRecordKeys.clientOverview(100), queryFn: overview, initialData: "old overview" });
        const currentDetail = useQuery({ queryKey: clientKeys.detail(100, "branch-1"), queryFn: detail, initialData: "old detail" });
        const currentDirectory = useQuery({ queryKey: clientKeys.directory({ branchId: "branch-1" }), queryFn: directory, initialData: "old directory" });
        const currentSummary = useQuery({ queryKey: clientKeys.summary({ branchId: "branch-1" }), queryFn: summary, initialData: "old summary" });
        const currentDashboard = useQuery({ queryKey: dashboardQueryKeys.overview(50), queryFn: dashboard, initialData: "old dashboard" });
        return { keep: useKeepPeriodMismatch(), fit: useFitPeriodMismatch(), currentOverview, currentDetail, currentDirectory, currentSummary, currentDashboard };
    }, { wrapper });
    await act(async () => { await result.current.keep.mutateAsync({ clientId: 100, sessionIndexes: [1] }); });
    expect(serviceRecordsApi.keepPeriodMismatch).toHaveBeenCalledWith(100, [1]);
    await waitFor(() => expect(result.current.currentOverview.data).toBe("refreshed overview"));
    expect(detail).not.toHaveBeenCalled();
    expect(directory).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    expect(dashboard).not.toHaveBeenCalled();
    await act(async () => { await result.current.fit.mutateAsync({ clientId: 100 }); });
    expect(serviceRecordsApi.fitPeriodMismatch).toHaveBeenCalledWith(100);
    expect(overview).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.currentDetail.data).toBe("refreshed detail"));
    await waitFor(() => expect(result.current.currentDirectory.data).toBe("refreshed directory"));
    await waitFor(() => expect(result.current.currentSummary.data).toBe("refreshed summary"));
    await waitFor(() => expect(result.current.currentDashboard.data).toBe("refreshed dashboard"));
    expect(directory).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledTimes(1);
    expect(dashboard).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
});

it("does not invalidate cached data when the backend rejects the mutation", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const directory = jest.fn().mockResolvedValue("refreshed directory");
    const dashboard = jest.fn().mockResolvedValue("refreshed dashboard");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    jest.mocked(serviceRecordsApi.fitPeriodMismatch).mockRejectedValue(new Error("conflict"));
    const { result, unmount } = renderHook(() => {
        const currentDirectory = useQuery({ queryKey: clientKeys.directory({ branchId: "branch-1" }), queryFn: directory, initialData: "old directory" });
        const currentDashboard = useQuery({ queryKey: dashboardQueryKeys.overview(50), queryFn: dashboard, initialData: "old dashboard" });
        return { fit: useFitPeriodMismatch(), currentDirectory, currentDashboard };
    }, { wrapper });
    await act(async () => { await expect(result.current.fit.mutateAsync({ clientId: 100 })).rejects.toThrow("conflict"); });
    await waitFor(() => expect(result.current.fit.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
    expect(directory).not.toHaveBeenCalled();
    expect(dashboard).not.toHaveBeenCalled();
    expect(result.current.currentDirectory.data).toBe("old directory");
    expect(result.current.currentDashboard.data).toBe("old dashboard");
    unmount();
    client.clear();
});
