import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { shouldRetryQuery } from "@/lib/queryClient";
import { fetchAllMessageLogs, fetchClientMessageLogs } from "@/lib/messages/logs";

import { useClientMessageHistory } from "../useClientMessageHistory";

jest.mock("@/lib/messages/logs", () => ({
    fetchAllMessageLogs: jest.fn(),
    fetchClientMessageLogs: jest.fn(),
}));

const fetchClientLogs = jest.mocked(fetchClientMessageLogs);
const fetchBranchLogs = jest.mocked(fetchAllMessageLogs);

function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// The app-wide retry policy (queryClient.ts) with no waiting between attempts.
function appPolicyWrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } },
    });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const client = { id: 1, name: "현재 고객", phone: "010-1234-5678" } as Client;

describe("useClientMessageHistory", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("reads this client's history by client id instead of filtering the branch-wide window", async () => {
        fetchClientLogs.mockResolvedValue({
            logs: [
                { id: "old", clientId: 1, receiver: "010-0000-0000", createdAt: "2024-01-01T00:00:00Z" },
                { id: "new", clientId: 1, receiver: "010-0000-0000", createdAt: "2026-10-03T00:00:00Z" },
            ] as never,
            hasMore: false,
        });

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.notificationLogs).toHaveLength(2));
        expect(fetchClientLogs).toHaveBeenCalledWith(1);
        expect(fetchBranchLogs).not.toHaveBeenCalled();
        // A client whose records are older than the branch window still shows them, newest first.
        expect(result.current.notificationLogs.map((log) => (log as unknown as { id: string }).id)).toEqual(["new", "old"]);
        expect(result.current.hasMore).toBe(false);
    });

    it("keeps whatever the server scoped to the client, including unowned rows sent to its phone", async () => {
        fetchClientLogs.mockResolvedValue({
            logs: [
                { id: "own", clientId: 1, receiver: "010-0000-0000", createdAt: "2026-10-03T00:00:00Z" },
                { id: "unowned", clientId: null, receiver: "01012345678", createdAt: "2026-10-02T00:00:00Z" },
            ] as never,
            hasMore: false,
        });

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.notificationLogs).toHaveLength(2));
        expect(result.current.notificationLogs.map((log) => (log as unknown as { id: string }).id)).toEqual(["own", "unowned"]);
    });

    it("reports when the server still holds older records than the ones returned", async () => {
        fetchClientLogs.mockResolvedValue({
            logs: [{ id: "a", clientId: 1, receiver: "x", createdAt: "2026-10-03T00:00:00Z" }] as never,
            hasMore: true,
        });

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.hasMore).toBe(true));
    });

    it("reports an error, not an empty history, when the server response is rejected", async () => {
        fetchClientLogs.mockRejectedValue(new Error("메시지 발송 기록 서버 응답 형식이 올바르지 않습니다."));

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.notificationLogs).toEqual([]);
    });

    it("inherits the app-wide retry policy: a 500 is tried 4 times, a 404 once", async () => {
        fetchClientLogs.mockRejectedValue({ response: { status: 500 } });
        const failing = renderHook(() => useClientMessageHistory(client), { wrapper: appPolicyWrapper });
        await waitFor(() => expect(failing.result.current.isError).toBe(true));
        expect(fetchClientLogs).toHaveBeenCalledTimes(4);
        failing.unmount();

        fetchClientLogs.mockReset();
        fetchClientLogs.mockRejectedValue({ response: { status: 404 } });
        const missing = renderHook(() => useClientMessageHistory(client), { wrapper: appPolicyWrapper });
        await waitFor(() => expect(missing.result.current.isError).toBe(true));
        expect(fetchClientLogs).toHaveBeenCalledTimes(1);
    });

    it("exposes whether a fetch is in flight", async () => {
        fetchClientLogs.mockResolvedValue({ logs: [] as never, hasMore: false });

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        expect(result.current.isFetching).toBe(true);
        await waitFor(() => expect(result.current.isFetching).toBe(false));
    });

    it("reports a first load held back by the offline pause as paused with no data, not as loaded", async () => {
        onlineManager.setOnline(false);
        try {
            fetchClientLogs.mockResolvedValue({ logs: [] as never, hasMore: false });

            const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

            // React Query v5 pauses the query instead of failing it: not loading, not an error.
            await waitFor(() => expect(result.current.isPaused).toBe(true));
            expect(result.current.hasData).toBe(false);
            expect(result.current.isLoading).toBe(false);
            expect(result.current.isError).toBe(false);
            expect(fetchClientLogs).not.toHaveBeenCalled();
        } finally {
            onlineManager.setOnline(true);
        }
    });

    it("reports data once the history has loaded", async () => {
        fetchClientLogs.mockResolvedValue({ logs: [] as never, hasMore: false });

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.hasData).toBe(true));
        expect(result.current.isPaused).toBe(false);
    });

    it("does not fetch without a client", () => {
        renderHook(() => useClientMessageHistory(null), { wrapper });

        expect(fetchClientLogs).not.toHaveBeenCalled();
    });
});
