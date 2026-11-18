import {
  getSentryRuntimeOptions,
  sanitizeSentryUrl,
} from "./sentry-config";

describe("mobile service-record Sentry scope", () => {
  it("redacts the public service-record token from URLs", () => {
    expect(sanitizeSentryUrl("https://mobile.example.com/service-record/efl_secret")).toBe(
      "https://mobile.example.com/service-record/[Filtered]",
    );
    expect(sanitizeSentryUrl("/service-record/link/efl_secret/context")).toBe(
      "/service-record/link/[Filtered]/context",
    );
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/sessions/1/submit")).toBe(
      "/api/service-record/[Filtered]/sessions/[Filtered]/submit",
    );
  });

  it("redacts service-record resource identifiers from URLs", () => {
    expect(sanitizeSentryUrl("/api/admin/service-records/client/77")).toBe(
      "/api/admin/service-records/client/[Filtered]",
    );
    expect(sanitizeSentryUrl("/admin/service-records/schedules/431/finalize")).toBe(
      "/admin/service-records/schedules/[Filtered]/finalize",
    );
    expect(
      sanitizeSentryUrl("/api/schedule-change-requests/schedules/431/apply"),
    ).toBe("/api/schedule-change-requests/schedules/[Filtered]/apply");
  });

  it("redacts UUID path segments from URLs", () => {
    expect(
      sanitizeSentryUrl(
        "/api/admin/service-records/client/123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBe("/api/admin/service-records/client/[Filtered]");
  });

  it("redacts the receipt-link token from URLs", () => {
    expect(sanitizeSentryUrl("/receipt/efr_SECRET")).toBe("/receipt/[Filtered]");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/status")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/image")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("https://mobile.example.com/api/receipt/efr_SECRET/image")).toBe(
      "https://mobile.example.com/api/receipt/[Filtered]/image",
    );
  });

  // M3: the BFF's own server-side axios call to the backend uses the /receipt-links/<token>/…
  // shape (not /api/receipt/<token>/…), which the original pattern left unredacted.
  it("redacts the receipt-link token from the server-side /receipt-links/<token>/… axios URL shape (M3)", () => {
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/verify")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/status")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/image")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/access")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/verify")).toBe("/receipt-links/[Filtered]/verify");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/access")).toBe("/receipt-links/[Filtered]/access");
    // Existing cases still pass unchanged.
    expect(sanitizeSentryUrl("/receipt/efr_SECRET")).toBe("/receipt/[Filtered]");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/status")).not.toContain("efr_SECRET");
    // The admin's token-free "send" route must stay legible for debugging — it carries no
    // token in the URL (documentId travels in the request body).
    expect(sanitizeSentryUrl("/api/receipt-links/send")).toBe("/api/receipt-links/send");
  });

  it("sends unrelated errors and keeps service-record route errors", () => {
    const options = getSentryRuntimeOptions();

    expect(options.beforeSend({ type: undefined, message: "dashboard failed" })).toMatchObject({
      message: "Mobile error", tags: { feature: "mobile" },
    });
    expect(
      options.beforeSend({
        type: undefined,
        user: { id: "user-1", email: "person@example.com" },
        request: {
          url: "https://mobile.example.com/api/service-record/efl_secret/context",
        },
      }),
    ).toMatchObject({
      user: undefined,
      request: {
        url: "https://mobile.example.com/api/service-record/[Filtered]/context",
      },
    });
  });

  it("sends removed schedule-change route errors without sampling their traces", () => {
    const options = getSentryRuntimeOptions();
    const path = "/api/schedule-change-requests/schedules/431/preview";

    expect(options.beforeSend({ type: undefined, request: { url: path } })).toMatchObject({
      tags: { feature: "mobile" },
    });
    expect(options.tracesSampler({
      name: `POST ${path}`,
      inheritOrSampleWith: (rate: number) => rate,
    })).toBe(0);
  });

  it("samples only service-record traces", () => {
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.3";

    const options = getSentryRuntimeOptions();
    const inheritOrSampleWith = jest.fn((rate: number) => rate);

    expect(
      options.tracesSampler({
        name: "GET /service-record/[token]",
        inheritOrSampleWith,
      }),
    ).toBe(0.3);
    expect(
      options.tracesSampler({
        name: "GET /dashboard",
        inheritOrSampleWith,
      }),
    ).toBe(0);

    if (previousRate === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = previousRate;
    }
  });
});


describe("all mobile Sentry errors", () => {
  it.each(["mobile", "service-records"])("strips query strings and fragments from %s context paths (F1)", (feature) => {
    const trace = { trace_id: "trace-id", span_id: "span-id", op: "http.server" };
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      tags: { feature },
      contexts: {
        trace,
        nextjs: { request_path: "/callback?code=oauth-code-fixture&state=state-fixture#fragment-fixture" },
        api: { path: "/api/service-record/access-fixture/context?code=oauth-code-fixture" },
      },
    });

    expect(sent.contexts?.nextjs).toEqual({ request_path: "/callback" });
    expect(sent.contexts?.api).toEqual({ path: "/api/service-record/[Filtered]/context" });
    expect(sent.contexts?.trace).toBe(trace);
    expect(JSON.stringify(sent)).not.toMatch(/oauth-code-fixture|state-fixture|fragment-fixture|access-fixture|[?#]/);
  });

  it.each(["mobile", "service-records"])("sanitizes %s Referer headers case-insensitively (F2)", (feature) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      tags: { feature },
      request: {
        headers: {
          Referer: "https://mobile.example.com/callback?code=oauth-code-fixture&state=state-fixture#fragment-fixture",
          referer: "/receipt/receipt-fixture?code=oauth-code-fixture#fragment-fixture",
          REFERER: "https://[invalid/callback?code=oauth-code-fixture#fragment-fixture",
          Authorization: "Bearer authorization-fixture",
          "User-Agent": "Mobile browser",
          "X-Detail": "person@example.com 010-1234-5678",
        },
      },
    });

    expect(sent.request?.headers).toEqual({
      Referer: "https://mobile.example.com/callback",
      referer: "/receipt/[Filtered]",
      REFERER: "https://[invalid/callback",
      Authorization: "[Filtered]",
      "User-Agent": "Mobile browser",
      "X-Detail": "[Email] [Phone]",
    });
    expect(JSON.stringify(sent)).not.toMatch(/oauth-code-fixture|state-fixture|fragment-fixture|receipt-fixture|authorization-fixture|[?#]/);
  });

  it("removes private data from plain errors while keeping their type and stack", () => {
    const stacktrace = { frames: [{ filename: "dashboard.tsx", lineno: 12 }] };
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      message: "person@example.com 010-1234-5678",
      logentry: { message: "person@example.com", params: ["private"] },
      exception: { values: [{ type: "TypeError", value: "010-1234-5678", stacktrace }] },
      user: { id: "private-user", email: "person@example.com" },
      request: { url: "/api/clients?email=person@example.com", data: "private-body", query_string: "private-query" },
    });
    expect(sent).toMatchObject({
      message: "Mobile error",
      logentry: { message: "Mobile error", params: undefined },
      exception: { values: [{ type: "TypeError", value: "Mobile error", stacktrace }] },
      tags: { feature: "mobile" },
      user: undefined,
      request: { url: "/api/clients", data: undefined, query_string: undefined },
    });
    for (const secret of ["person@example.com", "010-1234-5678", "private-user", "private-body", "private-query"]) {
      expect(JSON.stringify(sent)).not.toContain(secret);
    }
  });

  it("preserves the existing service-record sanitizer output", () => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      message: "service-record failed",
      logentry: { message: "failed", params: ["private"] },
      exception: { values: [{ type: "Error", value: "failed" }] },
    });
    expect(sent).toEqual({
      message: "Service-record error",
      transaction: undefined, user: undefined, request: undefined,
      logentry: { message: "Service-record error", params: undefined },
      exception: { values: [{ type: "Error", value: "Service-record error" }] },
      breadcrumbs: undefined, extra: undefined, spans: undefined,
    });
    expect(sent?.tags).toBeUndefined();
  });

  it.each(["api", "service-records"])("sanitizes contexts and tags for %s while retaining trace context", (feature) => {
    const trace = { trace_id: "trace-id", span_id: "span-id", op: "http.client" };
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      tags: { feature, detail: "person@example.com 010-1234-5678", count: 2 },
      contexts: { trace, api: { detail: "person@example.com 010-1234-5678", url: "/clients?token=private" } },
    });
    expect(sent?.tags).toEqual({ feature, detail: "[Email] [Phone]", count: 2 });
    expect(sent?.contexts?.trace).toBe(trace);
    expect(sent?.contexts?.api).toEqual({ detail: "[Email] [Phone]", url: "/clients" });
    expect(JSON.stringify(sent)).not.toMatch(/person@example.com|010-1234-5678/);
  });

  it("ignores extension errors and ResizeObserver noise without changing transaction filtering", () => {
    const options = getSentryRuntimeOptions();
    for (const url of ["chrome-extension://id/a.js", "moz-extension://id/a.js", "safari-extension://id/a.js", "safari-web-extension://id/a.js"]) {
      expect(options.denyUrls.some((pattern) => pattern.test(url))).toBe(true);
    }
    expect(options.ignoreErrors.some((pattern) => pattern.test("ResizeObserver loop limit exceeded"))).toBe(true);
    expect(options.beforeSendTransaction({ type: "transaction", transaction: "GET /dashboard" })).toBeNull();
  });
});


describe("URL-valued request headers", () => {
  it.each(["Referer", "referer", "REFERER", "Origin", "x-forwarded-uri", "X-Original-URL", "Location", "Link", "Refresh", "X-Custom-Header"])("strips queries and fragments from %s", (header) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        [header]: "https://admin.example/contracts?documentId=abc&phone=01012345678#x",
      } },
    });
    expect(sent.request?.headers?.[header]).toBe("https://admin.example/contracts");
    expect(JSON.stringify(sent)).not.toMatch(/[?#]|documentId|abc|01012345678|#x/);
  });

  it("sanitizes relative and malformed header URLs while retaining ordinary headers", () => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        "x-forwarded-uri": "/contracts?documentId=abc#x",
        Referer: "https://[invalid/contracts?documentId=abc#x",
        Authorization: "Bearer private-fixture",
        "User-Agent": "Test browser",
      } },
    });
    expect(sent.request?.headers).toEqual({
      "x-forwarded-uri": "/contracts",
      Referer: "https://[invalid/contracts",
      Authorization: "[Filtered]",
      "User-Agent": "Test browser",
    });
  });
});
