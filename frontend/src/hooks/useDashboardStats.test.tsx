import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardQueryKeys, useDashboardStats } from "./useDashboardStats";

const data = (count: number) => ({ activeClients: 1, contractsNotSent: count, contractsPendingSignature: 0, upcomingThisMonth: 0, upcomingNextMonth: 0 });
const branch = (id: string) => { document.cookie = `selected_branch_id=${id}; path=/`; };
function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(() => { document.cookie = "selected_branch_id=; Max-Age=0; path=/"; jest.restoreAllMocks(); });
describe("useDashboardStats optional branch isolation", () => {
    it("preserves default callers and the stats invalidation prefix", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data(0) });
        const { wrapper, client } = setup();
        const { result } = renderHook(() => useDashboardStats(), { wrapper });
        await waitFor(() => expect(result.current.data?.contractsNotSent).toBe(0));
        expect(dashboardQueryKeys.stats()).toEqual(["dashboard", "stats"]);
        expect(client.getQueryData(dashboardQueryKeys.stats())).toEqual(data(0));
        expect(global.fetch).toHaveBeenCalledWith("/api/clients/stats");
    });
    it("waits for enabled auth and branch alignment and rechecks inside manual refetch", async () => {
        branch("a");
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data(3) });
        const { wrapper } = setup();
        const { result, rerender } = renderHook(({ enabled, branchId }) => useDashboardStats({ enabled, branchId }), { wrapper, initialProps: { enabled: false, branchId: "a" } });
        expect(global.fetch).not.toHaveBeenCalled();
        await act(async () => { await result.current.refetch(); });
        expect(global.fetch).not.toHaveBeenCalled();
        rerender({ enabled: true, branchId: "b" });
        expect(result.current.data).toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
        rerender({ enabled: true, branchId: "a" });
        await waitFor(() => expect(result.current.data?.contractsNotSent).toBe(3));
        branch("b");
        await act(async () => { await result.current.refetch(); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        rerender({ enabled: true, branchId: "a" });
        expect(result.current.data).toBeUndefined();
    });
    it("separates branch caches and cannot display an old branch's delayed result", async () => {
        branch("a");
        let releaseA!: (response: unknown) => void;
        let releaseB!: (response: unknown) => void;
        global.fetch = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { releaseA = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { releaseB = resolve; }));
        const { wrapper, client } = setup();
        const { result, rerender } = renderHook(({ branchId }) => useDashboardStats({ branchId }), { wrapper, initialProps: { branchId: "a" } });
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        branch("b");
        rerender({ branchId: "b" });
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        await act(async () => { releaseA({ ok: true, json: async () => data(9) }); });
        expect(result.current.data).toBeUndefined();
        await act(async () => { releaseB({ ok: true, json: async () => data(0) }); });
        await waitFor(() => expect(result.current.data?.contractsNotSent).toBe(0));
        expect(client.getQueryData(dashboardQueryKeys.stats("a"))).toEqual(data(9));
        expect(client.getQueryData(dashboardQueryKeys.stats("b"))).toEqual(data(0));
        await act(async () => { await client.invalidateQueries({ queryKey: dashboardQueryKeys.stats(), refetchType: "none" }); });
        expect(client.getQueryState(dashboardQueryKeys.stats("a"))?.isInvalidated).toBe(true);
        expect(client.getQueryState(dashboardQueryKeys.stats("b"))?.isInvalidated).toBe(true);
    });
    it("exposes errors without inventing a zero", async () => {
        branch("a");
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
        const { wrapper } = setup();
        const { result } = renderHook(() => useDashboardStats({ branchId: "a" }), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.data).toBeUndefined();
    });
});
