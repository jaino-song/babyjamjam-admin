/**
 * @jest-environment node
 */

const originalFetch = global.fetch;
const envKeys = ["POSTHOG_HOST", "POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe("stats tenant scoping", () => {
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

  it("applies the branch filter to every inquiry query", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getStatsView } = await import("../stats-server");
    const response = await getStatsView("inquiries", "gangnam");

    expect(response.state).toBe("ready");
    const queries = (fetchMock.mock.calls as unknown as Array<[unknown, RequestInit?]>).map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { query: { query: string } };
      return body.query.query;
    });
    expect(queries).toHaveLength(7);
    expect(queries.filter((query) => /event = '(consultation_submitted|pricing_viewed)'/.test(query))).toHaveLength(7);
    expect(queries.every((query) => query.includes("AND properties.branch_slug = 'gangnam'"))).toBe(true);
  });
});
