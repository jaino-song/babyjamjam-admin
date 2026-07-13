import { api } from "@/lib/api/client";

import { fetchAllMessageLogs } from "../logs";

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
