import { api } from "@/lib/api/client";

import { messageTriggersApi } from "./message-triggers.api";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;
const mockPost = api.post as jest.MockedFunction<typeof api.post>;

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

describe("messageTriggersApi.resendJob", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { id: "job-uuid", status: "sent", reason: null } } as never);
  });

  it("posts an empty body to the bare job id resend endpoint", async () => {
    await messageTriggersApi.resendJob("8f14e45f-ceea-467a-9575-7b1a6f2f6c11");

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/message-trigger-jobs/8f14e45f-ceea-467a-9575-7b1a6f2f6c11/resend",
      {},
    );
  });
});
