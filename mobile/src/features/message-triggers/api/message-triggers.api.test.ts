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
