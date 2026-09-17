import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { MessageLogRecord } from "../types";
import { messageTriggersApi } from "../api/message-triggers.api";
import {
  getMessageHistoryRefetchInterval,
  MESSAGE_HISTORY_REFRESH_INTERVAL_MS,
  useMessageHistory,
} from "./use-message-triggers";

jest.mock("../api/message-triggers.api", () => ({
  messageTriggersApi: {
    listHistoryPage: jest.fn(),
  },
}));

const mockListHistoryPage = messageTriggersApi.listHistoryPage as jest.MockedFunction<
  typeof messageTriggersApi.listHistoryPage
>;

function createRecord(
  id: number | string,
  overrides: Partial<MessageLogRecord> = {},
): MessageLogRecord {
  return {
    id,
    provider: "aligo_sms",
    templateKey: "CLIENT_GREETING",
    triggerJobId: null,
    receiver: "01000000000",
    clientId: null,
    recipientPhone: "01000000000",
    messageBody: "안녕하세요",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-09-17T01:00:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-09-17T01:00:00.000Z",
    updatedAt: "2026-09-17T01:00:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: "CLIENT",
    recipientName: "고객",
    clientName: "고객",
    employeeName: null,
    ...overrides,
  };
}

const snapshotAt = "2026-09-17T02:00:00.000Z";

function page(
  items: MessageLogRecord[],
  options: { nextCursor?: string | null; hasMore?: boolean; snapshot?: string } = {},
) {
  return {
    data: {
      items,
      page: {
        snapshotAt: options.snapshot ?? snapshotAt,
        nextCursor: options.nextCursor ?? null,
        hasMore: options.hasMore ?? false,
      },
    },
  } as never;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useMessageHistory cursor pagination", () => {
  beforeEach(() => {
    mockListHistoryPage.mockReset();
  });

  it("keeps small histories at the normal cadence and spaces multi-page refreshes", () => {
    expect(getMessageHistoryRefetchInterval(undefined, 500)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS);
    expect(getMessageHistoryRefetchInterval(1, 500)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS);
    expect(getMessageHistoryRefetchInterval(500, 500)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS * 2);
    expect(getMessageHistoryRefetchInterval(501, 500)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS * 2);
    expect(getMessageHistoryRefetchInterval(1_000, 500)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS * 3);
    expect(getMessageHistoryRefetchInterval(undefined, 500, 90)).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS * 90);
  });

  it("loads an older date or recipient from a later cursor page exactly once", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => createRecord(index + 1));
    const olderMatchingRecord = createRecord(501, {
      recipientName: "오래된 수신자",
      clientName: "오래된 수신자",
      lastAttemptAt: "2024-01-05T01:00:00.000Z",
      createdAt: "2024-01-05T01:00:00.000Z",
    });
    mockListHistoryPage
      .mockResolvedValueOnce(page(firstPage, { nextCursor: "cursor-1", hasMore: true }))
      .mockResolvedValueOnce(page([olderMatchingRecord]));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(501);
    expect(result.current.data).toContainEqual(olderMatchingRecord);
    expect(new Set(result.current.data?.map((record) => String(record.id))).size).toBe(501);
    expect(mockListHistoryPage).toHaveBeenNthCalledWith(1, 500, undefined, expect.anything());
    expect(mockListHistoryPage).toHaveBeenNthCalledWith(2, 500, "cursor-1", expect.anything());
    expect(mockListHistoryPage.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(mockListHistoryPage.mock.calls[1][2]).toBe(mockListHistoryPage.mock.calls[0][2]);
    expect(mockListHistoryPage).toHaveBeenCalledTimes(2);
  });

  it("fails rather than publishing partial data when a later page repeats an ID", async () => {
    const firstRecord = createRecord(1);
    mockListHistoryPage
      .mockResolvedValueOnce(page([firstRecord], { nextCursor: "cursor-1", hasMore: true }))
      .mockResolvedValueOnce(page([firstRecord]));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록에 중복된 항목이 있어 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a page that claims more records without a continuation cursor", async () => {
    mockListHistoryPage.mockResolvedValueOnce(page([createRecord(1)], { hasMore: true }));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 페이지 커서가 누락되어 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty non-terminal page instead of claiming exhaustion", async () => {
    mockListHistoryPage.mockResolvedValueOnce(
      page([], { nextCursor: "cursor-1", hasMore: true }),
    );

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 페이지가 비어 있어 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated continuation cursor without requesting another page", async () => {
    mockListHistoryPage
      .mockResolvedValueOnce(page([createRecord(1)], { nextCursor: "cursor-1", hasMore: true }))
      .mockResolvedValueOnce(page([createRecord(2)], { nextCursor: "cursor-1", hasMore: true }));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 페이지 커서가 진행되지 않아 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a multi-page cursor cycle before requesting the repeated cursor", async () => {
    mockListHistoryPage
      .mockResolvedValueOnce(page([createRecord(1)], { nextCursor: "cursor-a", hasMore: true }))
      .mockResolvedValueOnce(page([createRecord(2)], { nextCursor: "cursor-b", hasMore: true }))
      .mockResolvedValueOnce(page([createRecord(3)], { nextCursor: "cursor-a", hasMore: true }));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 페이지 커서가 반복되어 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(3);
  });

  it("rejects snapshot drift before exposing records", async () => {
    mockListHistoryPage
      .mockResolvedValueOnce(page([createRecord(1)], { nextCursor: "cursor-1", hasMore: true }))
      .mockResolvedValueOnce(page([createRecord(2)], { snapshot: "2026-09-17T03:00:00.000Z" }));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 스냅샷이 변경되어 전체 기록을 확인할 수 없습니다."),
    );
    expect(result.current.data).toBeUndefined();
  });

  it("keeps a later-page failure in the query error state without partial data", async () => {
    const pageOne = Array.from({ length: 500 }, (_, index) => createRecord(index + 1));
    const pageError = new Error("history page unavailable");
    mockListHistoryPage
      .mockResolvedValueOnce(page(pageOne, { nextCursor: "cursor-1", hasMore: true }))
      .mockRejectedValueOnce(pageError);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({
      name: "MessageHistoryTransientError",
      attemptedPages: 2,
      retryable: true,
    });
    expect(
      getMessageHistoryRefetchInterval(
        undefined,
        500,
        (result.current.error as Error & { attemptedPages: number }).attemptedPages,
      ),
    ).toBe(MESSAGE_HISTORY_REFRESH_INTERVAL_MS * 2);
    expect(mockListHistoryPage).toHaveBeenCalledTimes(2);
  });

  it("propagates the same abort signal through a later page", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    // Native abort reasons expose a read-only name. Keep that invariant here
    // so cancellation cannot regress by mutating the reason in strict mode.
    Object.defineProperty(abortError, "name", {
      configurable: false,
      value: "AbortError",
      writable: false,
    });
    mockListHistoryPage
      .mockResolvedValueOnce(page([createRecord(1)], { nextCursor: "cursor-1", hasMore: true }))
      .mockRejectedValueOnce(abortError);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(abortError);
    expect(mockListHistoryPage.mock.calls[1][2]).toBe(mockListHistoryPage.mock.calls[0][2]);
  });

  it("stops at the 100-page loading bound without a 101st request", async () => {
    for (let index = 0; index < 100; index += 1) {
      mockListHistoryPage.mockResolvedValueOnce(
        page([createRecord(index + 1)], { nextCursor: `cursor-${index + 1}`, hasMore: true }),
      );
    }

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록이 100페이지(최대 50,000건)를 초과하여 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistoryPage).toHaveBeenCalledTimes(100);
  });

  it("keeps the existing one-page behavior for a small history", async () => {
    const onlyRecord = createRecord(1);
    mockListHistoryPage.mockResolvedValueOnce(page([onlyRecord]));

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([onlyRecord]);
    expect(mockListHistoryPage).toHaveBeenCalledTimes(1);
  });
});
