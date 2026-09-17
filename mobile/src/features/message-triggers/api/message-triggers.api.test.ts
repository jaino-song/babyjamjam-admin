import { api } from "@/lib/api/client";

import { messageTriggersApi } from "./message-triggers.api";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;

describe("messageTriggersApi.listHistory", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ data: [] } as never);
  });

  it("forwards pagination and an already-aborted signal to the request", async () => {
    const controller = new AbortController();
    controller.abort();

    await messageTriggersApi.listHistory(200, 400, controller.signal);

    expect(mockGet).toHaveBeenCalledWith("/message-logs", {
      params: { limit: 200, skip: 400 },
      signal: controller.signal,
    });
  });
});

describe("messageTriggersApi.listHistoryPage", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      data: {
        items: [],
        page: { snapshotAt: "2026-09-17T00:00:00.000Z", nextCursor: null, hasMore: false },
      },
    } as never);
  });

  it("forwards the bounded page size, cursor, and abort signal", async () => {
    const controller = new AbortController();

    await messageTriggersApi.listHistoryPage(500, "cursor-v1", controller.signal);

    expect(mockGet).toHaveBeenCalledWith("/message-logs/page", {
      params: { limit: 500, cursor: "cursor-v1" },
      signal: controller.signal,
    });
  });

  it("omits the continuation cursor on the first page", async () => {
    await messageTriggersApi.listHistoryPage();

    expect(mockGet).toHaveBeenCalledWith("/message-logs/page", {
      params: { limit: 500 },
      signal: undefined,
    });
  });
});
