const originalFetch = global.fetch;
const environmentKeys = [
  "POSTHOG_API_KEY",
  "POSTHOG_PROJECT_ID",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);
const fetchMock = jest.fn();

function providerResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  jest.resetModules();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.POSTHOG_API_KEY = "test-posthog-key";
  process.env.POSTHOG_PROJECT_ID = "test-project";
  process.env.SENTRY_AUTH_TOKEN = "test-sentry-key";
  process.env.SENTRY_ORG = "test-org";
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

describe("PostHog statistics availability", () => {
  it("preserves a successful empty result as zero statistics", async () => {
    fetchMock.mockResolvedValue(providerResponse({ results: [] }));
    const { getInquiriesSummary } = await import("./posthog");

    await expect(getInquiriesSummary()).resolves.toMatchObject({ today: 0, yesterday: 0 });
  });

  it.each(["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"] as const)(
    "rejects missing %s before fetching instead of reporting zero",
    async (key) => {
      delete process.env[key];
      const { getInquiriesSummary } = await import("./posthog");

      await expect(getInquiriesSummary()).rejects.toThrow("not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["HTTP error", providerResponse({ results: [] }, false)],
    ["query error", providerResponse({ results: [], error: "private provider detail" })],
    ["missing results", providerResponse({})],
    ["invalid results", providerResponse({ results: null })],
  ])("rejects %s instead of presenting empty data", async (_case, response) => {
    fetchMock.mockResolvedValue(response);
    const { getInquiriesSummary } = await import("./posthog");

    await expect(getInquiriesSummary()).rejects.toThrow("PostHog statistics are unavailable");
  });

  it("does not propagate transport details or credentials", async () => {
    fetchMock.mockRejectedValue(new Error("private transport detail test-posthog-key"));
    const { getInquiriesSummary } = await import("./posthog");

    await expect(getInquiriesSummary()).rejects.toThrow(/^PostHog statistics are unavailable$/);
  });
});

describe("Sentry statistics availability", () => {
  it("preserves an empty successful issue list", async () => {
    fetchMock.mockResolvedValue(providerResponse([]));
    const { getSummary, getOpenIssues } = await import("./sentry");

    await expect(getSummary()).resolves.toMatchObject({ openCount: 0, totalEvents7d: 0 });
    await expect(getOpenIssues()).resolves.toEqual([]);
  });

  it.each(["SENTRY_AUTH_TOKEN", "SENTRY_ORG"] as const)(
    "rejects missing %s instead of reporting no open issues",
    async (key) => {
      delete process.env[key];
      const { getSummary } = await import("./sentry");

      await expect(getSummary()).rejects.toThrow("not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects HTTP failures instead of reporting no open issues", async () => {
    fetchMock.mockResolvedValue(providerResponse([], false));
    const { getSummary } = await import("./sentry");

    await expect(getSummary()).rejects.toThrow("Sentry statistics are unavailable");
  });

  it.each([null, {}, { detail: "private provider detail" }])(
    "rejects a non-list provider response: %j",
    async (body) => {
      fetchMock.mockResolvedValue(providerResponse(body));
      const { getSummary, getOpenIssues } = await import("./sentry");

      await expect(getSummary()).rejects.toThrow("Invalid Sentry statistics response");
      await expect(getOpenIssues()).rejects.toThrow("Invalid Sentry statistics response");
    },
  );

  it("does not propagate transport details or credentials", async () => {
    fetchMock.mockRejectedValue(new Error("private transport detail test-sentry-key"));
    const { getSummary } = await import("./sentry");

    await expect(getSummary()).rejects.toThrow(/^Sentry statistics are unavailable$/);
  });
});
