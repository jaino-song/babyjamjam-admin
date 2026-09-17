import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { MessageLogRecord } from "../types";
import { messageTriggersApi } from "../api/message-triggers.api";
import { useMessageHistory } from "./use-message-triggers";

jest.mock("../api/message-triggers.api", () => ({
  messageTriggersApi: {
    listHistory: jest.fn(),
  },
}));

const mockListHistory = messageTriggersApi.listHistory as jest.MockedFunction<
  typeof messageTriggersApi.listHistory
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

describe("useMessageHistory pagination", () => {
  beforeEach(() => {
    mockListHistory.mockReset();
  });

  it("loads an older date or recipient from a later page", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => createRecord(index + 1));
    const olderMatchingRecord = createRecord(201, {
      recipientName: "오래된 수신자",
      clientName: "오래된 수신자",
      lastAttemptAt: "2024-01-05T01:00:00.000Z",
      createdAt: "2024-01-05T01:00:00.000Z",
    });
    mockListHistory
      .mockResolvedValueOnce({ data: firstPage } as never)
      .mockResolvedValueOnce({ data: [olderMatchingRecord] } as never);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(201);
    expect(result.current.data).toContainEqual(olderMatchingRecord);
    expect(mockListHistory).toHaveBeenNthCalledWith(1, 200, 0, expect.anything());
    expect(mockListHistory).toHaveBeenNthCalledWith(2, 200, 200, expect.anything());
    expect(mockListHistory).toHaveBeenCalledTimes(2);
  });

  it("deduplicates a short final page without requesting an unnecessary third page", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => createRecord(index + 1));
    const overlappingRecord = createRecord(200);
    const finalRecord = createRecord(201);
    mockListHistory
      .mockResolvedValueOnce({ data: firstPage } as never)
      .mockResolvedValueOnce({ data: [overlappingRecord, finalRecord] } as never);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((record) => record.id)).toHaveLength(201);
    expect(new Set(result.current.data?.map((record) => String(record.id))).size).toBe(201);
    expect(mockListHistory).toHaveBeenCalledTimes(2);
  });

  it("fails instead of treating a repeated full page as complete history", async () => {
    const page = Array.from({ length: 200 }, (_, index) => createRecord(index + 1));
    mockListHistory
      .mockResolvedValueOnce({ data: page } as never)
      .mockResolvedValueOnce({ data: page } as never);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(
      new Error("메시지 발송 기록 페이지가 중복되어 전체 기록을 확인할 수 없습니다."),
    );
    expect(mockListHistory).toHaveBeenCalledTimes(2);
  });

  it("keeps a later-page failure in the query error state", async () => {
    const page = Array.from({ length: 200 }, (_, index) => createRecord(index + 1));
    const pageError = new Error("history page unavailable");
    mockListHistory
      .mockResolvedValueOnce({ data: page } as never)
      .mockRejectedValueOnce(pageError);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(pageError);
    expect(mockListHistory).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing one-page behavior for a small history", async () => {
    const onlyRecord = createRecord(1);
    mockListHistory.mockResolvedValueOnce({ data: [onlyRecord] } as never);

    const { result } = renderHook(() => useMessageHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([onlyRecord]);
    expect(mockListHistory).toHaveBeenCalledTimes(1);
  });
});
