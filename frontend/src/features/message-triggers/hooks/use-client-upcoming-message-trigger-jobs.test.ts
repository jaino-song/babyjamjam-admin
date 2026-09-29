import { useInfiniteQuery } from "@tanstack/react-query";

import { messageTriggersApi } from "../api/message-triggers.api";
import { useClientUpcomingMessageTriggerJobs } from "./use-message-triggers";
import { messageTriggerKeys } from "./keys";

jest.mock("@tanstack/react-query", () => ({
    useInfiniteQuery: jest.fn(),
}));

jest.mock("../api/message-triggers.api", () => ({
    messageTriggersApi: {
        listClientUpcomingJobs: jest.fn(),
    },
}));

const mockedUseInfiniteQuery = jest.mocked(useInfiniteQuery);

const job = (overrides: Record<string, unknown> = {}) => ({
    id: "job-1",
    ruleName: "모니터링 설문",
    templateKey: "SURVEY",
    scheduledFor: "2026-09-29T06:00:00.000Z",
    nextAttemptAt: null,
    effectiveDueAt: "2026-09-29T06:00:00.000Z",
    status: "pending",
    recipientType: "CLIENT",
    recipientName: "고객",
    ...overrides,
});

describe("useClientUpcomingMessageTriggerJobs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseInfiniteQuery.mockReturnValue({
            data: undefined,
            isError: false,
            isLoading: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: jest.fn(),
            refetch: jest.fn(),
        } as never);
    });

    it("uses the client upcoming key as a child of the shared upcoming prefix", () => {
        useClientUpcomingMessageTriggerJobs(42, { enabled: true });

        expect(mockedUseInfiniteQuery).toHaveBeenCalledWith(expect.objectContaining({
            queryKey: messageTriggerKeys.clientUpcoming(42),
            enabled: true,
            initialPageParam: null,
            refetchOnWindowFocus: true,
            refetchInterval: 30_000,
            refetchIntervalInBackground: false,
        }));
        expect(messageTriggerKeys.clientUpcoming(42)).toEqual([
            ...messageTriggerKeys.upcoming(),
            "client",
            42,
        ]);
    });

    it("deduplicates pages and removes sent/canceled jobs from the client list", () => {
        mockedUseInfiniteQuery.mockReturnValue({
            data: {
                pages: [
                    {
                        items: [job(), job({ id: "job-2", status: "processing" }), job({ id: "job-3", status: "sent" })],
                        nextCursor: "next",
                    },
                    {
                        items: [job({ ruleName: "최신 규칙" }), job({ id: "job-4", status: "canceled" })],
                        nextCursor: null,
                    },
                ],
            },
            isError: false,
            isLoading: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: jest.fn(),
            refetch: jest.fn(),
        } as never);

        const result = useClientUpcomingMessageTriggerJobs(42);

        expect(result.items).toEqual([
            expect.objectContaining({ id: "job-1", ruleName: "최신 규칙" }),
            expect.objectContaining({ id: "job-2", status: "processing" }),
        ]);
    });

    it("does not retain the previous client's rows after an error", () => {
        mockedUseInfiniteQuery.mockReturnValue({
            data: {
                pages: [{ items: [job()], nextCursor: null }],
            },
            isError: true,
            isLoading: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: jest.fn(),
            refetch: jest.fn(),
        } as never);

        expect(useClientUpcomingMessageTriggerJobs(43).items).toEqual([]);
    });

    it("forwards the opaque cursor from the infinite query to the API", async () => {
        mockedUseInfiniteQuery.mockImplementation((options) => {
            const queryOptions = options as unknown as {
                queryFn: (context: { pageParam: string | null }) => Promise<unknown>;
            };
            void queryOptions.queryFn({ pageParam: "opaque-cursor" });
            return {
                data: undefined,
                isError: false,
                isLoading: false,
                isFetchingNextPage: false,
                hasNextPage: false,
                fetchNextPage: jest.fn(),
                refetch: jest.fn(),
            } as never;
        });
        jest.mocked(messageTriggersApi.listClientUpcomingJobs).mockResolvedValue({
            data: { items: [], nextCursor: null },
        } as never);

        useClientUpcomingMessageTriggerJobs(42);

        await Promise.resolve();
        expect(messageTriggersApi.listClientUpcomingJobs).toHaveBeenCalledWith(42, {
            limit: 50,
            cursor: "opaque-cursor",
        });
    });
});
