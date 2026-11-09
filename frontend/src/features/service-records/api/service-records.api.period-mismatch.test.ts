import { api } from "@/lib/api/client";
import { serviceRecordsApi } from "./service-records.api";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));
const mockPost = api.post as jest.Mock;
beforeEach(() => mockPost.mockReset());

it("posts the case indexes to keep and normalizes the result", async () => {
    mockPost.mockResolvedValue({ data: { keptSessionIndexes: [1, 3], extra: "ignored" } });
    await expect(serviceRecordsApi.keepPeriodMismatch(100, [1, 3])).resolves.toMatchObject({ data: { keptSessionIndexes: [1, 3] } });
    expect(mockPost).toHaveBeenCalledWith("/admin/service-records/client/100/period-mismatch/keep", { sessionIndexes: [1, 3] });
});

it("posts an empty object to fit and returns date-only bounds", async () => {
    mockPost.mockResolvedValue({ data: { startDate: "2026-08-07", endDate: "2026-08-20" } });
    await expect(serviceRecordsApi.fitPeriodMismatch(100)).resolves.toMatchObject({ data: { startDate: "2026-08-07", endDate: "2026-08-20" } });
    expect(mockPost).toHaveBeenCalledWith("/admin/service-records/client/100/period-mismatch/fit", {});
});

it.each([{ keptSessionIndexes: [0] }, { keptSessionIndexes: ["1"] }, null, {}])("rejects malformed keep results %j", async (data) => {
    mockPost.mockResolvedValue({ data });
    await expect(serviceRecordsApi.keepPeriodMismatch(100, [1])).rejects.toThrow("Invalid period-mismatch keep response");
});
it.each([
    { startDate: "2026-02-30", endDate: "2026-08-20" },
    { startDate: "2026-08-07T00:00:00Z", endDate: "2026-08-20" },
    null,
    {},
    { endDate: "2026-08-20" },
    { startDate: "2026-08-07" },
])("rejects malformed fit results %j", async (data) => {
    mockPost.mockResolvedValue({ data });
    await expect(serviceRecordsApi.fitPeriodMismatch(100)).rejects.toThrow("Invalid period-mismatch fit response");
});

it.each([
    { startDate: null, endDate: null },
    { startDate: null, endDate: "2026-08-20" },
    { startDate: "2026-08-07", endDate: null },
])("accepts open fit periods %j", async (data) => {
    mockPost.mockResolvedValue({ data });
    await expect(serviceRecordsApi.fitPeriodMismatch(100)).resolves.toMatchObject({ data });
});
