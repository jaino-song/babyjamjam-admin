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
      REFERER: "[Filtered]",
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
  describe.each([
    ["https://h", "https://h"],
    ["//h", "https://h"],
    ["", ""],
    ["https://outer:outer-pass@h", "https://h"],
  ])("%s normalized nested credentials", (prefix, origin) => {
    it.each([
      "https:/.//alice:pw@inner.example/x",
      "https:/%2e//alice:pw@inner.example/x",
      "https:\\\\alice:pw@inner.example/x",
      "htt\tps://alice:pw@inner.example/x",
      "https://ali\tce:pw@inner.example/x",
      "https:// alice:pw@inner.example/x",
      "https://alice:pw @inner.example/x",
    ])("removes credentials after URL normalization (sentry-coverage-u7f1-r3/F3): %s", (nested) => {
      const value = `${prefix}/proxy/${nested}?documentId=qa-nested-query#private`;
      const expected = `${origin}/proxy/https://inner.example/x`;
      const sent = getSentryRuntimeOptions().beforeSend({
        type: undefined,
        request: {
          url: value,
          headers: { Referer: value, "X-Forwarded-Uri": value, "X-Detail": value },
        },
        contexts: { api: { path: value } },
      });

      expect(sanitizeSentryUrl(value)).toBe(expected);
      expect(sent.request?.url).toBe(expected);
      expect(sent.request?.headers).toEqual({
        Referer: expected, "X-Forwarded-Uri": expected, "X-Detail": expected,
      });
      expect(sent.contexts?.api?.path).toBe(expected);
      expect(JSON.stringify(sent)).not.toMatch(/alice|pw|outer-pass|\[Email\]|[?#]|documentId|qa-nested-query/);
    });
  });

  it.each([
    ["https://h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x"],
    ["https://h/proxy/http://alice:a@b!c@i/x", "https://h/proxy/http://i/x"],
    ["//h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x"],
    ["/proxy/https://alice:s3cr!t@i/x", "/proxy/https://i/x"],
    ["https://outer:outer-pass@h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x"],
    ["https://h/proxy/https://alice:s3cr!t@i/http://bob:other-pass@j/x", "https://h/proxy/https://i/http://j/x"],
    ["https://h/proxy/https://alice:s3cr!t@i/x?documentId=qa-nested-query#private", "https://h/proxy/https://i/x"],
  ])("removes nested URL credentials (sentry-coverage-u7f1-r3/F1): %s", (value, expected) => {
    expect(sanitizeSentryUrl(value)).toBe(expected);

    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: {
        url: value,
        headers: { Referer: value, "X-Forwarded-Uri": value, "X-Detail": value },
      },
      contexts: { api: { path: value } },
    });

    expect(sent.request?.url).toBe(expected);
    expect(sent.request?.headers).toEqual({
      Referer: expected, "X-Forwarded-Uri": expected, "X-Detail": expected,
    });
    expect(sent.contexts?.api?.path).toBe(expected);
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|b!c|outer-pass|bob|other-pass|\[Email\]|[?#]|documentId|qa-nested-query/);
  });

  it.each([
    "https://h/proxy/https://i/x",
    "https://h/proxy/HTTPS://Inner.Example:443/x",
    "https://h/proxy/https://i/notify/@team",
  ])("preserves credential-free nested URLs: %s", (value) => {
    expect(sanitizeSentryUrl(value)).toBe(value);
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { Referer: value } },
    });
    expect(sent.request?.headers?.Referer).toBe(value);
  });

  it.each([
    ["Referer", "//alice:s3cr!t@admin.example.com/x?documentId=abc"],
    ["X-Forwarded-Uri", "//alice:s3cr!t@admin.example.com/x"],
    ["Referer", " //alice:s3cr!t@admin.example.com/x?documentId=abc"],
    ["X-Custom-Header", " //alice:s3cr!t@admin.example.com/x?documentId=abc"],
  ])("removes scheme-relative credentials from %s", (header, value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: value } },
    });

    expect(sent.request?.headers?.[header]).toBe("https://admin.example.com/x");
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|\[Email\]|\?|documentId/);
  });

  it.each([
    "https://alice:p?ss@admin.example.com/x?redirect=https://kim@example.com",
    "https://host:bad/x?a@b%26documentId%3Dqa-document",
    "https://host:bad/x?a@qa-query-secret",
    " https://host:bad/x|a@b",
    "https://host:bad/x?a@secret",
    "https://host:bad/x?redirect=https://x@secret&documentId=qa-document",
    "//alice:s3cr!t@[invalid/x?documentId=qa-document",
  ])("filters malformed authorities without recovering query text: %s", (value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { url: value, headers: { Referer: value, "X-Forwarded-Uri": value } },
    });

    expect(sent.request?.url).toBe("[Filtered]");
    expect(sent.request?.headers).toEqual({ Referer: "[Filtered]", "X-Forwarded-Uri": "[Filtered]" });
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|kim|qa-document|qa-query-secret|documentId|\[Email\]|[?#]/);
  });

  it.each(["contracts", "?a@secret", "ftp://example.com/x", "https://bad|host/x", "https://bad_host/x", "prefix //alice:s3cr!t@admin.example.com/x"])("filters unsupported or invalid header URLs: %s", (value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { Referer: value } },
    });
    expect(sent.request?.headers?.Referer).toBe("[Filtered]");
  });

  it.each([
    ["https://admin.example.com/x?q=kim@example.com&phone=01012345678&token=qa-query-secret&documentId=qa-document", "https://admin.example.com/x"],
    ["https://admin.example.com?q=kim@example.com&phone=01012345678", "https://admin.example.com/"],
    ["https://admin.example.com/x#kim@example.com&phone=01012345678", "https://admin.example.com/x"],
    ["https://admin.example.com/notify/@team?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/notify/@team"],
    ["https://alice:password@admin.example.com/x?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/x"],
    ["https://alice:a@b!c@admin.example.com/x?q=kim@example.com&documentId=qa-document", "https://admin.example.com/x"],
    ["https://alice:p?ss@admin.example.com/x?q=kim@example.com&phone=01012345678", "[Filtered]"],
    ["https://alice:p/ss@admin.example.com/x?q=kim@example.com&token=qa-query-secret", "[Filtered]"],
    ["https://[invalid/x?q=kim@example.com&phone=01012345678", "[Filtered]"],
    ["https://admin.example.com:8443/x?q=kim@example.com&phone=01012345678", "https://admin.example.com:8443/x"],
    ["https://admin.example.com:bad/x?q=kim@example.com&phone=01012345678", "[Filtered]"],
    ["https://host:bad/x?a@b&token=qa-query-secret&documentId=qa-document", "[Filtered]"],
    ["https://host:bad/x?a@b&documentId=qa-document", "[Filtered]"],
    ["https://host:bad/x?a@b&documentId=qa-document/next", "[Filtered]"],
    ["https://host:bad/x?a@b;documentId=qa-document", "[Filtered]"],
    ["https://alice:p?key=value@admin.example.com/x?q=kim@example.com&phone=01012345678", "[Filtered]"],
    ["https://alice:p?ss@[invalid/x?q=kim@example.com&documentId=qa-document", "[Filtered]"],
    ["//admin.example.com/x?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/x"],
  ])("keeps path and query @ characters out of the origin (sentry-coverage-u7/F1): %s", (value, expected) => {
    expect(sanitizeSentryUrl(value)).toBe(expected);

    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { url: value, headers: { Referer: value } },
    });

    expect(sent.request?.url).toBe(expected);
    expect(sent.request?.headers?.Referer).toBe(expected);
    expect(JSON.stringify(sent)).not.toMatch(/alice|password|kim|01012345678|qa-query-secret|qa-document|[?#]/);
  });

  it.each([
    ["Referer", "admin.example.com/x?documentId=qa-query-value#details"],
    ["x-forwarded-uri", "contracts?documentId=qa-query-value#details"],
    ["Link", "<https://a.example/x?documentId=qa-query-value>"],
    ["Refresh", "0; url=/x?token=qa-query-value"],
  ])("routes non-URL-shaped %s values by header name", (header, value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: value } },
    });
    const sanitized = sent.request?.headers?.[header];

    expect(sanitized).toBeDefined();
    expect(sanitized).not.toMatch(/[?#]|documentId|token|qa-query-value|details/);
  });

  it.each(["?", "/", "?/", "/?"])("strips userinfo containing an unencoded %s before parsing a Referer", (separator) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        Referer: `https://alice:p${separator}ss@admin.example.com/x?documentId=abc`,
      } },
    });

    expect(sent.request?.headers?.Referer).toBe("[Filtered]");
    expect(JSON.stringify(sent)).not.toMatch(/alice|p[?/]ss|ss@|documentId|abc/);
  });

  it.each([
    ["https://alice:p?ss@admin.example.com/x?documentId=abc", "[Filtered]"],
    ["https://alice:p/ss@admin.example.com/x?documentId=abc", "[Filtered]"],
    ["https://alice:p?ss@[invalid/x?documentId=abc", "[Filtered]"],
    ["https://alice:p/ss@[invalid/x?documentId=abc", "[Filtered]"],
  ])("strips ambiguous userinfo from direct URL sanitization: %s", (value, expected) => {
    const sanitized = sanitizeSentryUrl(value);

    expect(sanitized).toBe(expected);
    expect(sanitized).not.toMatch(/alice|p[?/]ss|ss@|documentId|abc/);
  });

  it.each(["origin", "Origin", "ORIGIN"])("preserves a browser %s header without adding a trailing slash", (header) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: "https://admin.example.com" } },
    });

    expect(sent.request?.headers?.[header]).toBe("https://admin.example.com");
  });

  it.each([
    ["Referer", "https://alice:s3cr!t@admin.example.com/x?documentId=abc"],
    ["x-forwarded-uri", "https://alice:s3cr!t@admin.example.com/x"],
    ["Referer", "https://alice:a@b!c@admin.example.com/x?documentId=abc"],
    ["x-forwarded-uri", "https://alice:a@b!c@admin.example.com/x"],
  ])("removes URL credentials before text masking in %s", (header, value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: value } },
    });

    expect(sent.request?.headers?.[header]).toBe("https://admin.example.com/x");
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|b!c|\[Email\]/);
  });

  it("preserves a credential-free Referer and masks email in a non-URL header", () => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        Referer: "https://admin.example.com/x?documentId=abc",
        "X-Detail": "Contact user@example.com",
      } },
    });

    expect(sent.request?.headers).toEqual({
      Referer: "https://admin.example.com/x",
      "X-Detail": "Contact [Email]",
    });
  });

  it.each([
    ["https://alice:s3cr!t@admin.example.com/x?documentId=abc", "https://admin.example.com/x"],
    ["https://alice:s3cr!t@[invalid/x?documentId=abc", "[Filtered]"],
    ["https://alice:a@b!c@admin.example.com/x?documentId=abc", "https://admin.example.com/x"],
    ["https://alice:a@b!c@[invalid/x?documentId=abc", "[Filtered]"],
  ])("removes URL credentials from direct URL sanitization: %s", (value, expected) => {
    const sanitized = sanitizeSentryUrl(value);

    expect(sanitized).toBe(expected);
    expect(sanitized).not.toMatch(/alice|s3cr|b!c|\[Email\]/);
  });

  describe.each(["X-Detail", "Referer", "x-forwarded-uri"])("%s URL-prefixed text privacy", (header) => {
    it.each([
      ["/retry with Bearer qa-header-credential", "/retry%20with%20Bearer%20[Filtered]"],
      ["https://x/retry with Bearer qa-header-credential", "https://x/retry%20with%20Bearer%20[Filtered]"],
      ["http://x/retry with Bearer qa-header-credential", "http://x/retry%20with%20Bearer%20[Filtered]"],
      ["//alice:s3cr!t@x/retry with Bearer qa-header-credential", "https://x/retry%20with%20Bearer%20[Filtered]"],
      ["/help call 010 1234 5678", "/help%20call%20[Phone]"],
      ["https://x/help call 010 1234 5678", "https://x/help%20call%20[Phone]"],
      ["/help contact user@example.com", "/help%20contact%20[Email]"],
      ["/retry with token=qa-header-credential", "/retry%20with%20token=[Filtered]"],
    ])("redacts sensitive text before URL encoding: %s", (value, expected) => {
      const sent = getSentryRuntimeOptions().beforeSend({
        type: undefined,
        request: { headers: { [header]: value } },
      });

      expect(sent.request?.headers?.[header]).toBe(expected);
      expect(JSON.stringify(sent)).not.toMatch(/qa-header-credential|010(?: |%20)1234(?: |%20)5678|user(?:@|%40)example\.com/);
    });
  });

  it.each([
    ["X-Detail", "Contact 010 1234 5678 via https://example.com/help", "Contact [Phone] via https://example.com/help"],
    ["X-Detail", "See https://example.com/help or call 010 1234 5678", "See https://example.com/help or call [Phone]"],
    ["User-Agent", "ExampleBot/1.0 (+https://example.com/bot)", "ExampleBot/1.0 (+https://example.com/bot)"],
    ["User-Agent", "ExampleBot/1.0 (+http://example.com/bot)", "ExampleBot/1.0 (+http://example.com/bot)"],
  ])("sanitizes free-text %s without treating an embedded URL as the whole value", (header, value, expected) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: value } },
    });

    expect(sent.request?.headers?.[header]).toBe(expected);
    expect(JSON.stringify(sent)).not.toMatch(/010(?: |%20)1234(?: |%20)5678/);
  });

  it("strips queries and fragments from relative URLs in custom headers", () => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { "X-Custom-Header": "/contracts?documentId=abc#x" } },
    });

    expect(sent.request?.headers?.["X-Custom-Header"]).toBe("/contracts");
  });

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
      Referer: "[Filtered]",
      Authorization: "[Filtered]",
      "User-Agent": "Test browser",
    });
  });
});
