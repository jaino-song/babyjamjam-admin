import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent } from "@sentry/nextjs";

import { captureApiError } from "./capture-api-error";
import { getSentryRuntimeOptions } from "./sentry-config";

// No network transport: even SDK outcomes stay inside this process.
describe("real browser SDK API deduplication", () => {
  let events: ErrorEvent[];
  let defaultIntegrations: ReturnType<typeof Sentry.getDefaultIntegrations>;

  const originalGetEntries = Object.getOwnPropertyDescriptor(performance, "getEntriesByType");

  beforeAll(() => {
    Object.defineProperty(performance, "getEntriesByType", { configurable: true, value: () => [] });
    events = [];
    const runtimeOptions = getSentryRuntimeOptions();
    Sentry.init({
      ...runtimeOptions,
      integrations: (defaults) => {
        // Snapshot the SDK input before the application callback can change it.
        defaultIntegrations = [...defaults];
        return runtimeOptions.integrations(defaults);
      },
      dsn: "https://public@example.invalid/1",
      enabled: true,
      transport: () => ({
        send: async (envelope) => {
          for (const [header, payload] of envelope[1]) {
            if (header.type === "event") events.push(payload as ErrorEvent);
          }
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    } satisfies Sentry.BrowserOptions);
  });

  beforeEach(() => { events = []; });

  afterAll(async () => {
    await Sentry.close(2000);
    Sentry.getCurrentScope().clear();
    if (originalGetEntries) Object.defineProperty(performance, "getEntriesByType", originalGetEntries);
    else Reflect.deleteProperty(performance, "getEntriesByType");
  });

  function apiFailure(): Error {
    return Object.assign(new Error("upstream fixture"), {
      isAxiosError: true,
      config: { method: "get", url: "/api/clients/123" },
      response: { status: 502 },
    });
  }

  it("delivers four independent 502 failures from the same call site", async () => {
    for (let index = 0; index < 4; index += 1) captureApiError(apiFailure());
    await Sentry.flush(2000);
    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(event.tags?.feature).toBe("api");
      expect(event.exception?.values?.[0]?.stacktrace).toEqual(events[0].exception?.values?.[0]?.stacktrace);
      expect(event.fingerprint).toEqual(["api-error", "GET", "/api/clients/:id", "502"]);
    }
  });

  it("delivers the same error object only once", async () => {
    const error = apiFailure();
    captureApiError(error);
    captureApiError(error);
    await Sentry.flush(2000);
    expect(events).toHaveLength(1);
  });

  it("still deduplicates identical consecutive non-API errors", async () => {
    for (let index = 0; index < 2; index += 1) Sentry.captureException(new Error("duplicate fixture"));
    await Sentry.flush(2000);
    expect(events).toHaveLength(1);
  });

  it("replaces only Dedupe and preserves default integration order and identities", () => {
    const defaults = defaultIntegrations;
    const integrations = Sentry.getClient()?.getOptions().integrations ?? [];
    expect(defaults.some((integration) => integration.name === "Dedupe")).toBe(true);
    expect(integrations.map((integration) => integration.name)).toEqual(defaults.map((integration) => integration.name));
    defaults.forEach((integration, index) => {
      if (integration.name === "Dedupe") expect(integrations[index]).not.toBe(integration);
      else expect(integrations[index]).toBe(integration);
    });
  });
});
