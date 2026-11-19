import { URL as NativeURL } from "node:url";

import {
  getSentryRuntimeOptions,
  sanitizeSentryText,
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
      Referer: "https://mobile.example.com",
      referer: "[Filtered]",
      REFERER: "[Filtered]",
      Authorization: "[Filtered]",
      "User-Agent": "Mobile browser",
      "X-Detail": "[Email] [Phone]",
    });
    expect(JSON.stringify(sent)).not.toMatch(/callback|receipt|oauth-code-fixture|state-fixture|fragment-fixture|authorization-fixture|[?#]/);
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
      const headerOrigin = origin || "[Filtered]";
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
        Referer: headerOrigin, "X-Forwarded-Uri": headerOrigin, "X-Detail": headerOrigin,
      });
      expect(JSON.stringify(sent.request?.headers)).not.toMatch(/proxy|inner|\/x/);
      expect(sent.contexts?.api?.path).toBe(expected);
      expect(JSON.stringify(sent)).not.toMatch(/alice|pw|outer-pass|\[Email\]|[?#]|documentId|qa-nested-query/);
    });
  });

  it.each([
    ["https://h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x", "https://h"],
    ["https://h/proxy/http://alice:a@b!c@i/x", "https://h/proxy/http://i/x", "https://h"],
    ["//h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x", "https://h"],
    ["/proxy/https://alice:s3cr!t@i/x", "/proxy/https://i/x", "[Filtered]"],
    ["https://outer:outer-pass@h/proxy/https://alice:s3cr!t@i/x", "https://h/proxy/https://i/x", "https://h"],
    ["https://h/proxy/https://alice:s3cr!t@i/http://bob:other-pass@j/x", "https://h/proxy/https://i/http://j/x", "https://h"],
    ["https://h/proxy/https://alice:s3cr!t@i/x?documentId=qa-nested-query#private", "https://h/proxy/https://i/x", "https://h"],
  ])("removes nested URL credentials (sentry-coverage-u7f1-r3/F1): %s", (value, expected, headerOrigin) => {
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
      Referer: headerOrigin, "X-Forwarded-Uri": headerOrigin, "X-Detail": headerOrigin,
    });
    expect(JSON.stringify(sent.request?.headers)).not.toMatch(/proxy|\/i|\/j|\/x/);
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
    expect(sent.request?.headers?.Referer).toBe("https://h");
    expect(JSON.stringify(sent)).not.toMatch(/proxy|inner|notify|@team|\/x/i);
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

    expect(sent.request?.headers?.[header]).toBe("https://admin.example.com");
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|\[Email\]|\/x|\?|documentId/);
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

  it.each(["contracts", "?a@secret", "ftp://example.com/x", "https://bad|host/x", "prefix //alice:s3cr!t@admin.example.com/x"])("filters unsupported or invalid header URLs: %s", (value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { Referer: value } },
    });
    expect(sent.request?.headers?.Referer).toBe("[Filtered]");
  });

  it.each([
    ["https://admin.example.com/x?q=kim@example.com&phone=01012345678&token=qa-query-secret&documentId=qa-document", "https://admin.example.com/x", "https://admin.example.com"],
    ["https://admin.example.com?q=kim@example.com&phone=01012345678", "https://admin.example.com/", "https://admin.example.com"],
    ["https://admin.example.com/x#kim@example.com&phone=01012345678", "https://admin.example.com/x", "https://admin.example.com"],
    ["https://admin.example.com/notify/@team?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/notify/@team", "https://admin.example.com"],
    ["https://alice:password@admin.example.com/x?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/x", "https://admin.example.com"],
    ["https://alice:a@b!c@admin.example.com/x?q=kim@example.com&documentId=qa-document", "https://admin.example.com/x", "https://admin.example.com"],
    ["https://alice:p?ss@admin.example.com/x?q=kim@example.com&phone=01012345678", "[Filtered]", "[Filtered]"],
    ["https://alice:p/ss@admin.example.com/x?q=kim@example.com&token=qa-query-secret", "[Filtered]", "[Filtered]"],
    ["https://[invalid/x?q=kim@example.com&phone=01012345678", "[Filtered]", "[Filtered]"],
    ["https://admin.example.com:8443/x?q=kim@example.com&phone=01012345678", "https://admin.example.com:8443/x", "https://admin.example.com:8443"],
    ["https://admin.example.com:bad/x?q=kim@example.com&phone=01012345678", "[Filtered]", "[Filtered]"],
    ["https://host:bad/x?a@b&token=qa-query-secret&documentId=qa-document", "[Filtered]", "[Filtered]"],
    ["https://host:bad/x?a@b&documentId=qa-document", "[Filtered]", "[Filtered]"],
    ["https://host:bad/x?a@b&documentId=qa-document/next", "[Filtered]", "[Filtered]"],
    ["https://host:bad/x?a@b;documentId=qa-document", "[Filtered]", "[Filtered]"],
    ["https://alice:p?key=value@admin.example.com/x?q=kim@example.com&phone=01012345678", "[Filtered]", "[Filtered]"],
    ["https://alice:p?ss@[invalid/x?q=kim@example.com&documentId=qa-document", "[Filtered]", "[Filtered]"],
    ["//admin.example.com/x?q=kim@example.com&token=qa-query-secret", "https://admin.example.com/x", "https://admin.example.com"],
  ])("keeps path and query @ characters out of the origin (sentry-coverage-u7/F1): %s", (value, expected, headerOrigin) => {
    expect(sanitizeSentryUrl(value)).toBe(expected);

    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { url: value, headers: { Referer: value } },
    });

    expect(sent.request?.url).toBe(expected);
    expect(sent.request?.headers?.Referer).toBe(headerOrigin);
    expect(sent.request?.headers?.Referer).not.toMatch(/\/x|notify|@team/);
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

    expect(sanitized).toBe("[Filtered]");
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

    expect(sent.request?.headers?.[header]).toBe("https://admin.example.com");
    expect(JSON.stringify(sent)).not.toMatch(/alice|s3cr|b!c|\[Email\]|\/x/);
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
      Referer: "https://admin.example.com",
      "X-Detail": "Contact [Email]",
    });
    expect(JSON.stringify(sent)).not.toMatch(/documentId|abc|user@example|\/x/);
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
      ["/retry with Bearer qa-header-credential", "[Filtered]"],
      ["https://x/retry with Bearer qa-header-credential", "https://x"],
      ["http://x/retry with Bearer qa-header-credential", "http://x"],
      ["//alice:s3cr!t@x/retry with Bearer qa-header-credential", "https://x"],
      ["/help call 010 1234 5678", "[Filtered]"],
      ["https://x/help call 010 1234 5678", "https://x"],
      ["/help contact user@example.com", "[Filtered]"],
      ["/retry with token=qa-header-credential", "[Filtered]"],
    ])("drops sensitive header paths: %s", (value, expected) => {
      const sent = getSentryRuntimeOptions().beforeSend({
        type: undefined,
        request: { headers: { [header]: value } },
      });

      expect(sent.request?.headers?.[header]).toBe(expected);
      expect(JSON.stringify(sent)).not.toMatch(/retry|help|Bearer|token|qa-header-credential|010(?: |%20)1234(?: |%20)5678|user(?:@|%40)example\.com/);
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

    expect(sent.request?.headers?.["X-Custom-Header"]).toBe("[Filtered]");
    expect(JSON.stringify(sent)).not.toMatch(/contracts|documentId|abc|#x/);
  });

  it.each(["Referer", "referer", "REFERER", "Origin", "x-forwarded-uri", "X-Original-URL", "Location", "Link", "Refresh", "X-Custom-Header"])("strips queries and fragments from %s", (header) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        [header]: "https://admin.example/contracts?documentId=abc&phone=01012345678#x",
      } },
    });
    expect(sent.request?.headers?.[header]).toBe("https://admin.example");
    expect(JSON.stringify(sent)).not.toMatch(/contracts|[?#]|documentId|abc|01012345678|#x/);
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
      "x-forwarded-uri": "[Filtered]",
      Referer: "[Filtered]",
      Authorization: "[Filtered]",
      "User-Agent": "Test browser",
    });
    expect(JSON.stringify(sent)).not.toMatch(/contracts|documentId|abc|private-fixture|#x/);
  });
});


describe("origin-only request header privacy", () => {
  describe.each([
    "Referer", "Origin", "Location", "Destination", "Link", "Refresh",
    "x-forwarded-uri", "x-original-url", "x-middleware-rewrite",
    "x-nextjs-rewrite", "next-url", "X-Custom-Header",
  ])("%s", (header) => {
    it.each([
      ["https://h/proxy/https://bob:x@j/y/https:%5C%5Calice:pw@inner.example/x", "https://h"],
      ["https://h/proxy/https:%5C%5Calice:pw@inner.example/x", "https://h"],
      ["https://h/proxy/htt%09ps://alice:pw@inner.example/x", "https://h"],
      ["//alice:s3cr!t@admin.example.com/x?documentId=abc", "https://admin.example.com"],
      ["https://alice:p?ss@admin.example.com/x?redirect=https://kim@example.com", "[Filtered]"],
      ["https://host:bad/x?a@qa-query-secret", "[Filtered]"],
      ["https://admin.example.com/contracts?documentId=abc", "https://admin.example.com"],
      ["https://admin.example.com", "https://admin.example.com"],
      ["https://01012345678.example.com/x", "[Filtered]"],
      ["/x?token=abc", "[Filtered]"],
      [" https://alice:pw@ADMIN.example.com:443/contracts?documentId=abc#fragment ", "https://admin.example.com"],
      ["http://admin.example.com:8080/contracts?documentId=abc", "http://admin.example.com:8080"],
      ["https://sentry.local/contracts?documentId=abc", "https://sentry.local"],
      ["https://bad_host/x", "https://bad_host"],
      ["https://[::1]:8443/x", "https://[::1]:8443"],
    ])("emits only the parsed safe origin for %s", (value, expected) => {
      const sent = getSentryRuntimeOptions().beforeSend({
        type: undefined,
        request: { headers: { [header]: value } },
      });

      expect(sent.request?.headers?.[header]).toBe(expected);
      expect(JSON.stringify(sent)).not.toMatch(/alice|bob|pw|kim|documentId|qa-query-secret|proxy|inner|contracts|redirect|token|fragment|abc|s3cr|01012345678|\/x|\/y|%5C|%09/);
    });
  });

  it.each([
    ["Link", "<https://a.example/x?documentId=abc>"],
    ["Refresh", "0; url=https://a.example/x?documentId=abc"],
    ["Referer", "ftp://a.example/x?documentId=abc"],
    ["Origin", "null"],
    ["Location", "contracts"],
    ["Referer", ""],
  ])("filters non-HTTP URL or composite %s: %s", (header, value) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { [header]: value } },
    });

    expect(sent.request?.headers?.[header]).toBe("[Filtered]");
    expect(JSON.stringify(sent)).not.toMatch(/a\.example|contracts|documentId|abc|\/x/);
  });
});


describe("credential-bearing path segment privacy", () => {
  it("sanitizes a 200,000-separator path segment in under 50 ms", () => {
    const options = getSentryRuntimeOptions();
    const url = `https://h/proxy/${":".repeat(200_000)}/x`;
    const event = { type: undefined, request: { url } };
    // Measure with the runtime's native parser rather than jsdom's slow JS URL polyfill.
    const urlSpy = jest.spyOn(globalThis, "URL")
      .mockImplementation((value, base) => new NativeURL(value, base));

    try {
      const start = performance.now();
      const sent = options.beforeSend(event);
      const elapsed = performance.now() - start;

      expect(sent.request?.url).toBe(url);
      expect(elapsed).toBeLessThan(50);
    } finally {
      urlSpy.mockRestore();
    }
  });

  it.each([
    "alice:pw@host",
    "a@b:c@d",
    "x@y%2Fz@host",
    "https:%5C%5Calice:pw@x",
    "@team",
    "a@b.com",
    "x:y",
    "a%2Fb%40c",
    "::@",
    "@:",
  ])("matches the original userinfo regex for raw and decoded segments: %s", (segment) => {
    const originalPattern = /[:/\\][^@]*@/;
    const filtered = originalPattern.test(segment)
      || originalPattern.test(decodeURIComponent(segment));
    const expected = filtered ? "[Filtered]" : sanitizeSentryText(segment);
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { url: `https://h/proxy/${segment}/x` },
    });

    expect(sent.request?.url).toBe(`https://h/proxy/${expected}/x`);
  });

  it.each([
    "https:%5C%5Calice:pw@inner.example",
    "https:%2F%2Fbob:x%40inner.example",
    "alice:pw@inner.example",
    "alice%3Apw%40inner.example",
    "%2Falice%40inner.example",
    "%5Calice%40inner.example",
    "https:%5c%5calice:pw%40inner.example",
    "bad%ZZalice@inner.example",
    "bad%ZZalice%40inner.example",
  ])("filters raw or decoded userinfo before text masking: %s", (segment) => {
    const url = `https://h/proxy/${segment}/x`;
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { url },
      contexts: { api: { path: url } },
    });

    expect(sanitizeSentryUrl(url)).toBe("https://h/proxy/[Filtered]/x");
    expect(sent.request?.url).toBe("https://h/proxy/[Filtered]/x");
    expect(sent.contexts?.api?.path).toBe("https://h/proxy/[Filtered]/x");
    expect(JSON.stringify(sent)).not.toMatch(/alice|bob|pw|inner\.example|\[Email\]/);
  });

  it.each([
    ["/contracts", "/contracts"],
    ["http://localhost:3000/x", "http://localhost:3000/x"],
    ["https://admin.example.com/clients/7", "https://admin.example.com/clients/7"],
    ["https://h/notify/@team", "https://h/notify/@team"],
    ["https://h/notify/a@b.com", "https://h/notify/[Email]"],
    ["https://h/notify/a%40b.com", "https://h/notify/a%40b.com"],
    ["https://h/notify/bad%ZZ", "https://h/notify/bad%ZZ"],
    ["/service-record/efl_secret/context", "/service-record/[Filtered]/context"],
    ["/clients/123e4567-e89b-42d3-a456-426614174000", "/clients/[Filtered]"],
  ])("preserves existing page URL sanitization: %s", (url, expected) => {
    const sent = getSentryRuntimeOptions().beforeSend({ type: undefined, request: { url } });

    expect(sanitizeSentryUrl(url)).toBe(expected);
    expect(sent.request?.url).toBe(expected);
  });
});

describe("noncanonical URL-valued header privacy", () => {
  it.each([
    ["https:/alice:pw@host.example/x?documentId=abc", "https://host.example"],
    [String.raw`https:\alice:pw@host.example/x?documentId=abc`, "https://host.example"],
    [String.raw`\\alice:pw@host.example/x?documentId=abc`, "[Filtered]"],
    [String.raw`/\alice:pw@host.example/x?documentId=abc`, "[Filtered]"],
    [String.raw`\/alice:pw@host.example/x?documentId=abc`, "[Filtered]"],
    [String.raw`\\\alice:pw@host.example/x?documentId=abc`, "[Filtered]"],
    ["ftp:/alice:pw@host.example/x?documentId=abc", "[Filtered]"],
    [String.raw`custom+scheme:\alice:pw@host.example/x?documentId=abc`, "[Filtered]"],
    ["https:/alice:pw@[invalid/x?documentId=abc", "[Filtered]"],
  ])("routes trimmed custom header values through URL sanitization: %s", (value, expected) => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: { "x-custom-header": ` ${value} ` } },
    });

    expect(sent.request?.headers?.["x-custom-header"]).toBe(expected);
    expect(JSON.stringify(sent)).not.toMatch(/alice|pw|documentId|abc|\[Email\]/);
  });

  it("preserves ordinary header values and sensitive-name filtering", () => {
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      request: { headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "x-custom-header": "Contact a@b.com",
        "x-detail": String.raw`\relative-path`,
        authorization: "ordinary value",
      } },
    });

    expect(sent.request?.headers).toEqual({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "x-custom-header": "Contact [Email]",
      "x-detail": String.raw`\relative-path`,
      authorization: "[Filtered]",
    });
  });
});
