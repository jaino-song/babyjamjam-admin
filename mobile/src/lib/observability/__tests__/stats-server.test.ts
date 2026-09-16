/**
 * @jest-environment node
 */

const originalFetch = global.fetch;
const envKeys = ["POSTHOG_HOST", "POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe("stats tenant scoping and conversion semantics", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.POSTHOG_HOST = "https://posthog.example";
    process.env.POSTHOG_API_KEY = "test-key";
    process.env.POSTHOG_PROJECT_ID = "test-project";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps branch inquiry conversion unavailable when pricing views have no branch dimension", async () => {
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: { query: string } };
      const query = body.query.query;
      if (query.includes("countIf(toDate(timestamp) = today())")) return { ok: true, json: async () => ({ results: [[2, 1, 8, 12, "2026-09-17T00:00:00.000Z"]] }) };
      if (query.includes("toDate(timestamp), count()")) return { ok: true, json: async () => ({ results: [["2026-09-17", 3]] }) };
      if (query.includes("toHour(timestamp)")) return { ok: true, json: async () => ({ results: [[10, 2]] }) };
      if (query.includes("properties.branch_slug, count()")) return { ok: true, json: async () => ({ results: [["gangnam", 8]] }) };
      if (query.includes("distinct_id, properties.branch_slug")) return { ok: true, json: async () => ({ results: [["visitor-1", "gangnam", "organic", "/consult", "mobile", "2026-09-17T00:00:00.000Z"]] }) };
      if (query.includes("event = 'consultation_submitted'")) return { ok: true, json: async () => ({ results: [[8]] }) };
      return { ok: true, json: async () => ({ results: [] }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getStatsView } = await import("../stats-server");
    const response = await getStatsView("inquiries", "gangnam");

    expect(response.state).toBe("ready");
    const queries = (fetchMock.mock.calls as unknown as Array<[unknown, RequestInit?]>).map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { query: { query: string } };
      return body.query.query;
    });
    expect(queries).toHaveLength(6);
    expect(queries.some((query) => query.includes("event = 'pricing_viewed'"))).toBe(false);
    expect(queries.every((query) => query.includes("AND properties.branch_slug = 'gangnam'"))).toBe(true);
    expect(response.data?.summary.today).toBe(2);
    expect(response.data?.summary.sevenDayTotal).toBe(8);
    expect(response.data?.summary.conversionRate).toBeNull();
  });

  it("computes global conversion from the unscoped pricing view denominator for owners", async () => {
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: { query: string } };
      const query = body.query.query;
      if (query.includes("event = 'pricing_viewed'")) return { ok: true, json: async () => ({ results: [[20]] }) };
      if (query.includes("countIf(toDate(timestamp) = today())")) return { ok: true, json: async () => ({ results: [[2, 1, 8, 12, "2026-09-17T00:00:00.000Z"]] }) };
      if (query.includes("event = 'consultation_submitted'")) return { ok: true, json: async () => ({ results: [[10]] }) };
      return { ok: true, json: async () => ({ results: [] }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getStatsView } = await import("../stats-server");
    const response = await getStatsView("inquiries", null);

    expect(response.state).toBe("ready");
    expect(response.data?.summary.conversionRate).toBe(50);
    const pricingQuery = (fetchMock.mock.calls as unknown as Array<[unknown, RequestInit?]>)
      .map(([, init]) => JSON.parse(String(init?.body)) as { query: { query: string } })
      .map((body) => body.query.query)
      .find((query) => query.includes("event = 'pricing_viewed'"));
    expect(pricingQuery).toBeDefined();
    expect(pricingQuery).not.toContain("properties.branch_slug");
  });
});
