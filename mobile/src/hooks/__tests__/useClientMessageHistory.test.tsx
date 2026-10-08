import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
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

    it("does not fetch without a client", () => {
        renderHook(() => useClientMessageHistory(null), { wrapper });

        expect(fetchClientLogs).not.toHaveBeenCalled();
    });
});
