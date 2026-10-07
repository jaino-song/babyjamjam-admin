import { api } from "@/lib/api/client";

import { fetchAllMessageLogs, fetchClientMessageLogs } from "../logs";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;

describe("fetchAllMessageLogs", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("loads additional log pages until the backend returns a short page", async () => {
    mockGet
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => ({ id: index + 1 })) })
      .mockResolvedValueOnce({ data: [{ id: 501 }] });

    await expect(fetchAllMessageLogs<{ id: number }>()).resolves.toHaveLength(501);

    expect(mockGet).toHaveBeenNthCalledWith(1, "/message-logs", {
      params: { limit: 500, skip: 0 },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/message-logs", {
      params: { limit: 500, skip: 500 },
    });
  });
});

describe("fetchClientMessageLogs", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  const page = (items: Array<{ id: number }>, nextCursor: string | null) => ({
    data: { items, page: { snapshotAt: "2026-10-01T00:00:00.000Z", nextCursor, hasMore: nextCursor !== null } },
  });

  it("reads the client-scoped endpoint, not the branch-wide log window", async () => {
    mockGet.mockResolvedValueOnce(page([{ id: 7 }], null));

    await expect(fetchClientMessageLogs<{ id: number }>(42)).resolves.toEqual({
      logs: [{ id: 7 }],
      hasMore: false,
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/message-logs/client/42", { params: { limit: 100 } });
  });

  it("follows the server cursor until the history is exhausted", async () => {
    mockGet
      .mockResolvedValueOnce(page([{ id: 3 }, { id: 2 }], "cursor-2"))
      .mockResolvedValueOnce(page([{ id: 1 }], null));

    const result = await fetchClientMessageLogs<{ id: number }>(42);

    expect(result).toEqual({ logs: [{ id: 3 }, { id: 2 }, { id: 1 }], hasMore: false });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/message-logs/client/42", {
      params: { limit: 100, cursor: "cursor-2" },
    });
  });

  it("says so when the page cap is reached before the server runs out of records", async () => {
    mockGet.mockResolvedValue(page([{ id: 1 }], "more"));

    const result = await fetchClientMessageLogs<{ id: number }>(42);

    expect(mockGet).toHaveBeenCalledTimes(20);
    expect(result.hasMore).toBe(true);
    expect(result.logs).toHaveLength(20);
  });

  it.each([
    ["data: null", null],
    ["no items array", { page: { nextCursor: null, hasMore: false } }],
    ["no page object", { items: [] }],
    ["hasMore is not a boolean", { items: [], page: { nextCursor: null } }],
    ["hasMore without a cursor", { items: [], page: { nextCursor: null, hasMore: true } }],
    ["a cursor while hasMore is false", { items: [], page: { nextCursor: "c", hasMore: false } }],
  ])("rejects a malformed response (%s) instead of reporting an empty history", async (_label, data) => {
    mockGet.mockResolvedValueOnce({ data });

    await expect(fetchClientMessageLogs(42)).rejects.toThrow("서버 응답 형식");
  });

  it("rejects when a later page is malformed rather than returning a silently shortened history", async () => {
    mockGet
      .mockResolvedValueOnce(page([{ id: 2 }], "cursor-2"))
      .mockResolvedValueOnce({ data: null });

    await expect(fetchClientMessageLogs(42)).rejects.toThrow("서버 응답 형식");
  });
});
