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
    ["object row", providerResponse({ results: [{}] })],
    ["short row", providerResponse({ results: [[1]] })],
    ["invalid count", providerResponse({ results: [["broken", 0, 0, 0, null]] })],
    ["null count", providerResponse({ results: [[null, 0, 0, 0, null]] })],
    ["invalid timestamp", providerResponse({ results: [[1, 0, 1, 1, {}]] })],
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

describe("PostHog query scope and successful data", () => {
  it.each(["seoul.gangnam", "", " ", "qa' OR 1=1", "qa\\branch"])(
    "rejects an unusable supplied branch before any provider request: %s",
    async (slug) => {
      const ph = await import("./posthog");
      for (const run of [
        () => ph.getInquiriesSummary(slug),
        () => ph.getInquiriesDailyTrend(7, slug),
        () => ph.getInquiriesHourlyToday(slug),
        () => ph.getRecentInquiries(10, slug),
      ]) {
        await expect(run()).rejects.toThrow("Invalid statistics branch scope");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the valid tenant filter and converts valid numeric results", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ results: [[2, 1, "7", 20, "2026-09-17T01:00:00Z"]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[7]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[7]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[14]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[14]] }));
    const { getInquiriesSummary } = await import("./posthog");
    await expect(getInquiriesSummary("qa-20260917", 30)).resolves.toMatchObject({
      today: 2, yesterday: 1, sevenDayTotal: 7, thirtyDayTotal: 20, conversionRate: 50,
    });
    const queries = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).query.query);
    expect(queries[0]).toContain("AND properties.branch_slug = 'qa-20260917'");
    expect(queries[1]).toContain("AND properties.branch_slug = 'qa-20260917'");
  });

  it("reuses the seven-day conversion queries for the default period", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ results: [[0, 0, 7, 30, null]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[3]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[12]] }));
    const { getInquiriesSummary } = await import("./posthog");

    await expect(getInquiriesSummary()).resolves.toMatchObject({
      conversionRate: 25,
      selectedRange: { days: 7, conversionRate: 25 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const queries = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).query.query);
    expect(queries[0]).toContain("countIf(timestamp >= now() - INTERVAL 30 DAY)");
    expect(queries[1]).toContain("event = 'consultation_submitted'");
    expect(queries[1]).toContain("INTERVAL 7 DAY");
    expect(queries[2]).toContain("event = 'pricing_viewed'");
    expect(queries[2]).toContain("INTERVAL 7 DAY");
  });

  it("keeps distinct selected-range conversion queries for a 30-day period", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ results: [[1, 0, 7, 30, null]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[3]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[30]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[12]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[40]] }));
    const { getInquiriesSummary } = await import("./posthog");

    await expect(getInquiriesSummary(undefined, 30)).resolves.toMatchObject({
      conversionRate: 25,
      selectedRange: { days: 30, total: 30, average: 1, conversionRate: 75 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const queries = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).query.query);
    expect(queries[1]).toContain("event = 'consultation_submitted'");
    expect(queries[1]).toContain("INTERVAL 7 DAY");
    expect(queries[2]).toContain("event = 'consultation_submitted'");
    expect(queries[2]).toContain("INTERVAL 30 DAY");
    expect(queries[3]).toContain("event = 'pricing_viewed'");
    expect(queries[3]).toContain("INTERVAL 7 DAY");
    expect(queries[4]).toContain("event = 'pricing_viewed'");
    expect(queries[4]).toContain("INTERVAL 30 DAY");
  });

  it("preserves intentional all-branch scope and nullable inquiry dimensions", async () => {
    fetchMock.mockResolvedValue(providerResponse({ results: [["test-id", null, null, null, null, "2026-09-17T01:00:00Z"]] }));
    const { getRecentInquiries } = await import("./posthog");
    await expect(getRecentInquiries(10, null)).resolves.toEqual([{
      distinctId: "test-id", branchSlug: null, source: null, pathname: null,
      deviceType: null, timestamp: "2026-09-17T01:00:00Z",
    }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query.query).not.toContain("AND properties.branch_slug");
  });

  it("accepts a null average when no sessions qualify", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ results: [[0, 0, 0, 0, 0, 0, 0, 0]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[0, 0]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[0, 0]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[null]] }))
      .mockResolvedValueOnce(providerResponse({ results: [[null]] }));
    const { getTrafficSummary } = await import("./posthog");
    await expect(getTrafficSummary()).resolves.toMatchObject({ avgSessionSeconds: 0, bounceRate: 0 });
  });

  it("accepts null counts from unmatched page joins", async () => {
    fetchMock.mockResolvedValue(providerResponse({ results: [["/pricing", 2, 1, null, null, null]] }));
    const { getPagesDetail } = await import("./posthog");
    await expect(getPagesDetail()).resolves.toEqual([{
      path: "/pricing", pv: 2, unique: 1, entries: 0, exits: 0, bouncePct: 0,
    }]);
  });
});

type PostHog = typeof import("./posthog");
const rowCases = [
  { name: "daily inquiries", run: (ph: PostHog) => ph.getInquiriesDailyTrend(), rows: [["2026-09-17", 2]], expected: [{ day: "2026-09-17", count: 2 }] },
  { name: "hourly inquiries", run: (ph: PostHog) => ph.getInquiriesHourlyToday(), rows: [[12, 2]], expected: expect.arrayContaining([{ hour: 12, count: 2 }]) },
  { name: "branch inquiries", run: (ph: PostHog) => ph.getInquiriesByBranch(), rows: [["qa-branch", 2]], expected: [{ branchSlug: "qa-branch", count: 2 }] },
  { name: "funnel counts", run: (ph: PostHog) => ph.getFunnelSummary(), rows: [[2]], expected: { totalEntries: 2, completedConversions: 2 } },
  { name: "funnel trend", run: (ph: PostHog) => ph.getFunnelTrend(), rows: [["2026-09-17", 4, 2]], expected: [{ day: "2026-09-17", conversionRate: 50 }] },
  { name: "funnel device", run: (ph: PostHog) => ph.getFunnelByDevice(), rows: [["Mobile", 4, 2]], expected: [{ device: "Mobile", entries: 4, completions: 2, conversionRate: 50 }] },
  { name: "funnel source", run: (ph: PostHog) => ph.getFunnelBySource(), rows: [["direct", 4, 3, 2, 1, 1]], expected: [{ source: "direct", entries: 4, conversionRate: 25 }] },
  { name: "traffic trend", run: (ph: PostHog) => ph.getTrafficTrend(), rows: [["2026-09-17", 4, 2]], expected: [{ day: "2026-09-17", pv: 4, unique: 2 }] },
  { name: "top pages", run: (ph: PostHog) => ph.getTopPages(), rows: [["/pricing", 4, 2]], expected: [{ path: "/pricing", pv: 4, unique: 2 }] },
  { name: "devices", run: (ph: PostHog) => ph.getDeviceBreakdown(), rows: [["Mobile", 4]], expected: [{ deviceType: "Mobile", count: 4, pct: 100 }] },
  { name: "browsers", run: (ph: PostHog) => ph.getBrowserBreakdown(), rows: [["Chrome / Mobile", 4]], expected: [{ browser: "Chrome / Mobile", count: 4, pct: 100 }] },
  { name: "sources", run: (ph: PostHog) => ph.getSourceBreakdown(), rows: [["direct", 4]], expected: [{ source: "direct", count: 4, pct: 100 }] },
  { name: "nullable region", run: (ph: PostHog) => ph.getRegionBreakdown(), rows: [[null, null, 4]], expected: [{ region: "Unknown", count: 4, pct: 100 }] },
  { name: "page entries", run: (ph: PostHog) => ph.getEntryPages(), rows: [["/pricing", 4]], expected: [{ path: "/pricing", count: 4, pct: 100 }] },
  { name: "page exits", run: (ph: PostHog) => ph.getExitPages(), rows: [["/pricing", 4]], expected: [{ path: "/pricing", count: 4, pct: 100 }] },
  { name: "page transitions", run: (ph: PostHog) => ph.getPageTransitions(), rows: [["/", "/pricing", 4]], expected: [{ fromPath: "/", toPath: "/pricing", count: 4, pct: 100 }] },
  { name: "navigation summary", run: (ph: PostHog) => ph.getPageNavSummary(), rows: [[2, 4]], expected: { activePages: 2, totalPv: 4, avgPvPerPage: 2, avgBouncePct: 50 } },
];

describe("PostHog row contracts across query consumers", () => {
  it.each(rowCases)("accepts valid $name data", async ({ run, rows, expected }) => {
    fetchMock.mockResolvedValue(providerResponse({ results: rows }));
    const ph = await import("./posthog");
    await expect(run(ph)).resolves.toMatchObject(expected);
  });

  it.each(rowCases)("rejects invalid $name rows", async ({ run }) => {
    fetchMock.mockResolvedValue(providerResponse({ results: [{}] }));
    const ph = await import("./posthog");
    await expect(run(ph)).rejects.toThrow(/^PostHog statistics are unavailable$/);
  });
});

const validIssue = {
  id: "test-issue", title: "Test issue", level: "error", count: "3", userCount: 2,
  firstSeen: "2026-09-16T01:00:00Z", lastSeen: "2026-09-17T01:00:00Z",
  permalink: "https://sentry.io/organizations/test/issues/test-issue/",
};

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

  it.each([
    {},
    { ...validIssue, count: "broken" },
    { ...validIssue, userCount: null },
    { ...validIssue, lastSeen: "not-a-date" },
    { ...validIssue, metadata: { filename: {} } },
    { ...validIssue, stats: { "24h": [{}] } },
    { ...validIssue, stats: { "24h": [[1, "broken"]] } },
    { ...validIssue, stats: { "30d": [[1]] } },
    { ...validIssue, stats: { "30d": [[1e30, 1]] } },
  ])("rejects malformed entries inside a provider array: %j", async (issue) => {
    fetchMock.mockResolvedValue(providerResponse([issue]));
    const { getSummary, getOpenIssues } = await import("./sentry");
    await expect(getSummary()).rejects.toThrow(/^Invalid Sentry statistics response$/);
    await expect(getOpenIssues()).rejects.toThrow(/^Invalid Sentry statistics response$/);
  });

  it("normalizes valid issues and valid nested statistics", async () => {
    const timestamp = Date.parse("2026-09-17T01:00:00Z") / 1000;
    fetchMock.mockResolvedValue(providerResponse([{
      ...validIssue, culprit: null, metadata: { filename: "page.tsx" },
      stats: { "24h": [[timestamp, 3]] },
    }]));
    const { getSummary, getOpenIssues, get24hEventTrend } = await import("./sentry");
    await expect(getSummary()).resolves.toMatchObject({ openCount: 1, totalEvents7d: 3, affectedUsers: 2, sparkline7d: [0, 0, 0, 0, 0, 0, 3] });
    await expect(getOpenIssues()).resolves.toEqual([expect.objectContaining({ id: "test-issue", count: 3, filename: "page.tsx" })]);
    await expect(get24hEventTrend()).resolves.toEqual([{ timestamp: "2026-09-17T01:00:00.000Z", count: 3 }]);
  });

  it("does not propagate transport details or credentials", async () => {
    fetchMock.mockRejectedValue(new Error("private transport detail test-sentry-key"));
    const { getSummary } = await import("./sentry");

    await expect(getSummary()).rejects.toThrow(/^Sentry statistics are unavailable$/);
  });
});
