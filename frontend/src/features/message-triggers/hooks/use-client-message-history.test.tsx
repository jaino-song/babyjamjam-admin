import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import { useClientMessageHistory } from "./use-message-triggers";

jest.mock("../api/message-triggers.api", () => ({
    messageTriggersApi: {
        listClientHistory: jest.fn(),
        listHistory: jest.fn(),
    },
}));

const mockListClientHistory = jest.mocked(messageTriggersApi.listClientHistory);
const mockListHistory = jest.mocked(messageTriggersApi.listHistory);

const record = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    clientId: 42,
    receiver: "01012345678",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
});

const page = (items: unknown[], nextCursor: string | null = null) => ({
    data: {
        items,
        page: { snapshotAt: "2026-10-01T00:00:00.000Z", nextCursor, hasMore: nextCursor !== null },
    },
});

function createWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, wrapper };
}

describe("useClientMessageHistory", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("asks the client-scoped endpoint, never the branch-wide message-log window", async () => {
        mockListClientHistory.mockResolvedValue(page([record(1)]) as never);
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42, { limit: 50 }), { wrapper });

        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(mockListClientHistory).toHaveBeenCalledWith(42, { limit: 50, cursor: null });
        expect(mockListHistory).not.toHaveBeenCalled();
    });

    it("shows a client whose history is older than any branch-wide window", async () => {
        const old = record(7, { createdAt: "2024-01-02T00:00:00.000Z" });
        mockListClientHistory.mockResolvedValue(page([old]) as never);
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42), { wrapper });

        await waitFor(() => expect(result.current.items).toEqual([old]));
        expect(result.current.hasNextPage).toBe(false);
    });

    it("follows the server cursor to older pages and drops a repeated record", async () => {
        mockListClientHistory
            .mockResolvedValueOnce(page([record(3), record(2)], "cursor-2") as never)
            .mockResolvedValueOnce(page([record(2), record(1)]) as never);
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42, { limit: 2 }), { wrapper });

        await waitFor(() => expect(result.current.items).toHaveLength(2));
        expect(result.current.hasNextPage).toBe(true);

        await act(async () => {
            await result.current.fetchNextPage();
        });

        await waitFor(() => expect(result.current.items).toHaveLength(3));
        expect(mockListClientHistory).toHaveBeenLastCalledWith(42, { limit: 2, cursor: "cursor-2" });
        expect(result.current.items.map((item) => item.id)).toEqual([3, 2, 1]);
        expect(result.current.hasNextPage).toBe(false);
    });

    it("stays idle for a missing client or a disabled tab", () => {
        const { wrapper } = createWrapper();

        renderHook(() => useClientMessageHistory(null), { wrapper });
        renderHook(() => useClientMessageHistory(42, { enabled: false }), { wrapper });

        expect(mockListClientHistory).not.toHaveBeenCalled();
    });

    it("keeps one cache entry per client so a switch never shows the previous client's rows", () => {
        expect(messageTriggerKeys.clientHistory(42)).not.toEqual(messageTriggerKeys.clientHistory(43));
        expect(messageTriggerKeys.clientHistory(42).slice(0, 1)).toEqual(messageTriggerKeys.all);
    });

    it.each([
        ["data: null", { data: null }],
        ["no items array", { data: { page: { snapshotAt: "x", nextCursor: null, hasMore: false } } }],
        ["no page object", { data: { items: [] } }],
        ["hasMore is not a boolean", { data: { items: [], page: { nextCursor: null } } }],
        ["hasMore without a cursor", { data: { items: [], page: { nextCursor: null, hasMore: true } } }],
        ["a cursor while hasMore is false", { data: { items: [], page: { nextCursor: "c", hasMore: false } } }],
    ])("rejects a malformed response (%s) instead of showing an empty history", async (_label, response) => {
        mockListClientHistory.mockResolvedValue(response as never);
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.items).toEqual([]);
    });

    it("keeps the truncation signal when the server reports more records", async () => {
        mockListClientHistory.mockResolvedValue(page([record(1)], "older") as never);
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42), { wrapper });

        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(result.current.isError).toBe(false);
        expect(result.current.hasNextPage).toBe(true);
    });

    it("drops loaded rows when a refetch errors", async () => {
        mockListClientHistory.mockRejectedValue(new Error("boom"));
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useClientMessageHistory(42), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.items).toEqual([]);
    });
});
