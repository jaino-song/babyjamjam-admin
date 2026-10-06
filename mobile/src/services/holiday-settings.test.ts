import { api } from "@/lib/api/client";

import { holidaySettingsApi } from "./holiday-settings";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock; delete: jest.Mock };

describe("holidaySettingsApi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads one year of the branch's holidays", async () => {
    mockedApi.get.mockResolvedValue({ data: { year: 2026, holidays: [] } });

    await expect(holidaySettingsApi.getYear("branch-1", 2026)).resolves.toEqual({ year: 2026, holidays: [] });
    expect(mockedApi.get).toHaveBeenCalledWith("/branches/branch-1/holidays", { params: { year: 2026 } });
  });

  it("creates and deletes overrides on the branch", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    mockedApi.delete.mockResolvedValue({ data: { success: true } });

    await holidaySettingsApi.createOverride("branch-1", { date: "2026-10-05", kind: "exclude" });
    expect(mockedApi.post).toHaveBeenCalledWith("/branches/branch-1/holidays/overrides", {
      date: "2026-10-05",
      kind: "exclude",
    });

    await holidaySettingsApi.deleteOverride("branch-1", "ovr-1");
    expect(mockedApi.delete).toHaveBeenCalledWith("/branches/branch-1/holidays/overrides/ovr-1");
  });

  it("starts a sync and returns the per-year results", async () => {
    const results = { results: [{ year: 2026, status: "unchanged", added: 0, removed: 0 }] };
    mockedApi.post.mockResolvedValue({ data: results });

    await expect(holidaySettingsApi.syncNow("branch-1")).resolves.toEqual(results);
    expect(mockedApi.post).toHaveBeenCalledWith("/branches/branch-1/holidays/sync");
  });
});
