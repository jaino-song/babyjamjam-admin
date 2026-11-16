import { loadPostHogStat } from "./load-posthog-stat";

describe("loadPostHogStat", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns successful statistics without logging an error", async () => {
    const stats = { today: 0, sevenDayTotal: 7 };

    await expect(loadPostHogStat(Promise.resolve(stats))).resolves.toBe(stats);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    "PostHog statistics are not configured",
    "Invalid statistics branch scope",
  ])("preserves the known failure category: %s", async (message) => {
    await expect(loadPostHogStat(Promise.reject(new Error(message)))).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(message);
  });

  it.each([
    ["provider error", new Error("private provider payload")],
    ["known category with appended details", new Error("Invalid statistics branch scope: private detail")],
    ["string rejection", "private transport detail"],
    ["object rejection", { message: "private provider payload" }],
    ["null rejection", null],
  ])("logs only the generic category for %s", async (_label, error) => {
    await expect(loadPostHogStat(Promise.reject(error))).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("PostHog statistics are unavailable");
  });
});
