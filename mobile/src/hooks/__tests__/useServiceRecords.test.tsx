import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { clientQueryKeys } from "@/hooks/useClients";
import { resetServiceRecordLink, serviceRecordQueryKeys, useFitPeriodMismatch, useKeepPeriodMismatch, useSendServiceRecordLink } from "../useServiceRecords";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    function Wrapper({ children }: PropsWithChildren) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, invalidate, wrapper: Wrapper };
}

beforeEach(() => jest.clearAllMocks());

it("keeps the requested indexes and awaits the overview refresh", async () => {
    const { queryClient, invalidate, wrapper } = setup();
    const response = { keptSessionIndexes: [1, 3] };
    jest.mocked(api.post).mockResolvedValue({ data: response });
    let finishRefresh!: () => void;
    invalidate.mockReturnValue(new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const { result } = renderHook(() => useKeepPeriodMismatch(), { wrapper });
    let settled = false;
    let mutation!: Promise<unknown>;
    await act(async () => {
        mutation = result.current.mutateAsync({ clientId: 12, sessionIndexes: [1, 3] }).then((value) => { settled = true; return value; });
    });
    expect(api.post).toHaveBeenCalledWith("/admin/service-records/client/12/period-mismatch/keep", { sessionIndexes: [1, 3] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: serviceRecordQueryKeys.clientOverview(12) });
    expect(settled).toBe(false);
    await act(async () => { finishRefresh(); expect(await mutation).toEqual(response); });
    queryClient.clear();
});

it("fits with an empty body, returns the period, and refreshes overview and client details", async () => {
    const { queryClient, invalidate, wrapper } = setup();
    const response = { startDate: "2026-10-30", endDate: "2026-11-19" };
    jest.mocked(api.post).mockResolvedValue({ data: response });
    const { result } = renderHook(() => useFitPeriodMismatch(), { wrapper });
    await act(async () => { expect(await result.current.mutateAsync({ clientId: 12 })).toEqual(response); });
    expect(api.post).toHaveBeenCalledWith("/admin/service-records/client/12/period-mismatch/fit", {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: serviceRecordQueryKeys.clientOverview(12) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clientQueryKeys.detail(12) });
    queryClient.clear();
});

it.each([useKeepPeriodMismatch, useFitPeriodMismatch])("propagates errors without invalidation", async (hook) => {
    const { queryClient, invalidate, wrapper } = setup();
    const error = new Error("failed");
    jest.mocked(api.post).mockRejectedValue(error);
    const { result } = renderHook(() => hook(), { wrapper });
    await act(async () => {
        await expect(result.current.mutateAsync({ clientId: 12, sessionIndexes: [1] })).rejects.toBe(error);
    });
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
});

const secondCase = "10000000-0000-4000-8000-000000000002";
const member = { caseId: secondCase, assignmentVersion: 7 };
const target = { employeeId: 32, members: [member] };

it("prepares and sends only the selected second case and keeps its persisted version", async () => {
    const { wrapper } = setup();
    const url = "https://mobile.test/service-record/second";
    jest.mocked(api.post).mockResolvedValueOnce({
        data: {
            kind: "group", employeeId: 32, previewContent: `둘째 아기 제공기록지\n${url}`,
            members: [{ ...member, serviceRecordUrl: url, preparedLinkToken: "efl_second" }],
        },
    }).mockResolvedValueOnce({ data: { status: "sent" } });
    const { result } = renderHook(() => useSendServiceRecordLink(), { wrapper });
    await act(async () => {
        await result.current.mutateAsync({ clientId: 13, scheduleId: 11, target });
    });
    expect(jest.mocked(api.post).mock.calls).toEqual([
        ["/admin/service-records/schedules/11/prepare-link", { employeeId: 32, caseIds: [secondCase] }],
        ["/admin/service-records/schedules/11/send-link", { employeeId: 32, members: [{ ...member, preparedLinkToken: "efl_second" }] }],
    ]);
});

it("rejects a mismatched prepared case version and forwards the exact reset target", async () => {
    const { wrapper } = setup();
    jest.mocked(api.post).mockResolvedValueOnce({
        data: {
            kind: "group", employeeId: 32, previewContent: "https://mobile.test/service-record/second",
            members: [{ ...member, assignmentVersion: 6, serviceRecordUrl: "https://mobile.test/service-record/second", preparedLinkToken: "efl_old" }],
        },
    }).mockResolvedValueOnce({ data: { kind: "group", ...target } });
    const { result } = renderHook(() => useSendServiceRecordLink(), { wrapper });
    await act(async () => {
        await expect(result.current.mutateAsync({ clientId: 13, scheduleId: 11, target })).rejects.toThrow("배정이 변경");
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    await resetServiceRecordLink(11, target);
    expect(api.post).toHaveBeenLastCalledWith("/admin/service-records/schedules/11/reset-link", target);
});
