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

  it("updates SDK dedupe state for an intervening API failure", async () => {
    function renderFailure(): void {
      Sentry.captureException(new Error("interrupted render fixture"));
    }

    for (let index = 0; index < 2; index += 1) {
      renderFailure();
      if (index === 0) captureApiError(apiFailure());
    }
    await Sentry.flush(2000);

    expect(events).toHaveLength(3);
    expect(events[1].tags?.feature).toBe("api");
    expect(events[0].exception).toEqual(events[2].exception);
  });

  function serviceRecordFailure(): Error {
    return Object.assign(new Error("service-record upstream fixture"), {
      isAxiosError: true,
      config: { method: "get", url: "/api/service-record/tok123/sessions/s1" },
      response: { status: 502 },
    });
  }

  it("delivers four independent service-record API 502s from the same call site", async () => {
    for (let index = 0; index < 4; index += 1) captureApiError(serviceRecordFailure());
    await Sentry.flush(2000);

    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(event.tags?.feature).toBe("service-records");
      expect(event.exception?.values?.[0]?.stacktrace).toEqual(events[0].exception?.values?.[0]?.stacktrace);
      expect(event.fingerprint).toEqual(["api-error", "GET", "/api/service-record/[Filtered]/sessions/[Filtered]", "502"]);
    }
  });

  it("delivers the same service-record API error object only once", async () => {
    const error = serviceRecordFailure();
    captureApiError(error);
    captureApiError(error);
    await Sentry.flush(2000);

    expect(events).toHaveLength(1);
    expect(events[0].tags?.feature).toBe("service-records");
  });

  it.each(["api-error"])("exempts the %s API fingerprint even with a different feature tag", async (prefix) => {
    for (let index = 0; index < 2; index += 1) {
      Sentry.captureException(new Error("fingerprinted API fixture"), {
        tags: { feature: "custom" },
        fingerprint: [prefix, "502"],
      });
    }
    await Sentry.flush(2000);

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.tags?.feature === "custom")).toBe(true);
  });

  it("still deduplicates consecutive service-record render errors without an API fingerprint", async () => {
    for (let index = 0; index < 2; index += 1) {
      Sentry.captureException(new Error("service-record render fixture"), {
        tags: { feature: "service-records" },
      });
    }
    await Sentry.flush(2000);

    expect(events).toHaveLength(1);
    expect(events[0].tags?.feature).toBe("service-records");
    expect(events[0].fingerprint).toBeUndefined();
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
