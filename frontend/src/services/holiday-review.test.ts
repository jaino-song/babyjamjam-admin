import { api } from "@/lib/api/client";

import { holidayReviewApi } from "./holiday-review";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;

const ids = (count: number) => Array.from({ length: count }, (_, index) => `i-${index}`);

describe("holidayReviewApi", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("sends only the filters that are set", async () => {
    mockGet.mockResolvedValue({ data: [] });

    await holidayReviewApi.listItems("b1", "e1", { category: "safe", status: "open", q: "" });

    expect(mockGet).toHaveBeenCalledWith("/branches/b1/holidays/review-events/e1/items", {
      params: { category: "safe", status: "open" },
    });
  });

  it("fixes in sequential chunks of at most 50 and merges the results", async () => {
    mockPost
      .mockResolvedValueOnce({ data: { fixed: 50, kept: 0, skipped: [] } })
      .mockResolvedValueOnce({ data: { fixed: 19, kept: 0, skipped: [{ itemId: "i-99", code: "CLIENT_CHANGED" }] } });

    const result = await holidayReviewApi.resolve("b1", "e1", ids(70), "fix");

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][1].itemIds).toHaveLength(50);
    expect(mockPost.mock.calls[1][1].itemIds).toHaveLength(20);
    expect(mockPost.mock.calls[0][0]).toBe("/branches/b1/holidays/review-events/e1/resolve");
    expect(result).toEqual({ fixed: 69, kept: 0, skipped: [{ itemId: "i-99", code: "CLIENT_CHANGED" }] });
  });

  it("keeps up to 500 ids per request", async () => {
    mockPost.mockResolvedValue({ data: { fixed: 0, kept: 1, skipped: [] } });

    const result = await holidayReviewApi.resolve("b1", "e1", ids(501), "keep");

    expect(mockPost.mock.calls.map((call) => call[1].itemIds.length)).toEqual([500, 1]);
    expect(result.kept).toBe(2);
  });

  it("rethrows when the first chunk fails", async () => {
    mockPost.mockRejectedValue(new Error("boom"));

    await expect(holidayReviewApi.resolve("b1", "e1", ids(60), "fix")).rejects.toThrow("boom");
  });

  it("keeps earlier progress and reports the unhandled ids as skipped when a later chunk fails", async () => {
    mockPost
      .mockResolvedValueOnce({ data: { fixed: 50, kept: 0, skipped: [] } })
      .mockRejectedValueOnce(new Error("boom"));

    const result = await holidayReviewApi.resolve("b1", "e1", ids(60), "fix");

    expect(result.fixed).toBe(50);
    expect(result.skipped).toHaveLength(10);
    expect(result.skipped[0]).toEqual({ itemId: "i-50", code: "REQUEST_FAILED" });
  });
});
