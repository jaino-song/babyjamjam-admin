import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";

import { useClientMessageHistory } from "../useClientMessageHistory";

jest.mock("@/lib/messages/logs", () => ({
    fetchAllMessageLogs: jest.fn(),
}));

const fetchLogs = jest.mocked(fetchAllMessageLogs);

function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const client = { id: 1, name: "현재 고객", phone: "010-1234-5678" } as Client;

describe("useClientMessageHistory", () => {
    it("keeps logs owned by another client out, even when they were sent to this client's phone", async () => {
        fetchLogs.mockResolvedValue([
            { id: "own", clientId: 1, receiver: "010-0000-0000", createdAt: "2026-10-03T00:00:00Z" },
            { id: "unowned", clientId: null, receiver: "01012345678", createdAt: "2026-10-02T00:00:00Z" },
            { id: "other-client", clientId: 2, receiver: "010-1234-5678", recipientPhone: "01012345678", createdAt: "2026-10-01T00:00:00Z" },
        ] as never);

        const { result } = renderHook(() => useClientMessageHistory(client), { wrapper });

        await waitFor(() => expect(result.current.notificationLogs).toHaveLength(2));
        expect(result.current.notificationLogs.map((log) => (log as { id: string }).id)).toEqual(["own", "unowned"]);
    });
});
