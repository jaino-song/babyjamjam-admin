import type { Event, Log } from "@sentry/nextjs";

import {
  getSentryEnvironment,
  getSentryRuntimeOptions,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryText,
  sanitizeSentryUrl,
} from "./sentry-config";

describe("Sentry privacy filters", () => {
  it("redacts credentials and common PII from text", () => {
    const value = "Bearer secret-token user@example.com 010-1234-5678 password=hunter2";

    expect(sanitizeSentryText(value)).toBe(
      "Bearer [Filtered] [Email] [Phone] password=[Filtered]",
    );
  });

  it("removes query strings and fragments from URLs", () => {
    expect(sanitizeSentryUrl("https://example.com/clients/7?token=secret#details")).toBe(
      "https://example.com/clients/7",
    );
    expect(sanitizeSentryUrl("/contracts?clientId=7")).toBe("/contracts");
  });

  it("redacts service-record access tokens from URLs", () => {
    expect(sanitizeSentryUrl("https://mobile.example.com/service-record/efl_secret")).toBe(
      "https://mobile.example.com/service-record/[Filtered]",
    );
    expect(sanitizeSentryUrl("/service-record/link/efl_secret/context")).toBe(
      "/service-record/link/[Filtered]/context",
    );
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/context")).toBe(
      "/api/service-record/[Filtered]/context",
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
      sanitizeSentryUrl("/api/schedule-change-requests/schedules/431/preview"),
    ).toBe("/api/schedule-change-requests/schedules/[Filtered]/preview");
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/sessions/9/submit")).toBe(
      "/api/service-record/[Filtered]/sessions/[Filtered]/submit",
    );
  });

  it("redacts UUID path segments from URLs", () => {
    expect(
      sanitizeSentryUrl(
        "/api/admin/service-records/client/123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBe("/api/admin/service-records/client/[Filtered]");
  });

  it("removes user identity and request payloads", () => {
    const event: Event = {
      transaction: "GET /api/clients?phone=01012345678",
      user: {
        id: "user-1",
        email: "user@example.com",
        ip_address: "127.0.0.1",
      },
      request: {
        url: "https://example.com/api/clients?phone=01012345678",
        data: { phone: "010-1234-5678" },
        cookies: { session: "secret" },
        headers: {
          authorization: "Bearer secret",
          "user-agent": "test-agent",
        },
      },
      extra: {
        email: "user@example.com",
        operation: "client lookup",
      },
    };

    expect(sanitizeSentryEvent(event)).toMatchObject({
      transaction: "GET /api/clients",
      user: undefined,
      request: {
        url: "https://example.com/api/clients",
        data: undefined,
        cookies: undefined,
        headers: {
          authorization: "[Filtered]",
          "user-agent": "test-agent",
        },
      },
      extra: {
        email: "[Filtered]",
        operation: "client lookup",
      },
    });
  });

  it("redacts sensitive structured log attributes", () => {
    const log: Log = {
      level: "error",
      message: "Failed for user@example.com",
      attributes: {
        route: "/clients",
        phone: "010-1234-5678",
      },
    };

    expect(sanitizeSentryLog(log)).toMatchObject({
      message: "Failed for [Email]",
      attributes: {
        route: "/clients",
        phone: "[Filtered]",
      },
    });
  });
});

describe("service-record Sentry scope", () => {
  it("uses canonical environments and the production 10 percent trace default", () => {
    const previousEnvironment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "production";
    delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;

    const options = getSentryRuntimeOptions();
    expect(getSentryEnvironment()).toBe("production");
    expect(options.environment).toBe("production");
    expect(options.tracesSampler({
      name: "GET /service-record/[token]",
      inheritOrSampleWith: (rate: number) => rate,
    })).toBe(0.1);

    if (previousEnvironment === undefined) delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = previousEnvironment;
    if (previousRate === undefined) delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    else process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = previousRate;
  });

  it("keeps unrelated errors and tagged service-record errors", () => {
    const options = getSentryRuntimeOptions();

    expect(options.beforeSend({ type: undefined, message: "dashboard failed" })).toMatchObject({
      message: "Frontend error",
      tags: { feature: "frontend" },
    });
    expect(
      options.beforeSend({
        type: undefined,
        message: "service record failed",
        tags: { feature: "service-records" },
      }),
    ).toMatchObject({
      message: "Service-record error",
      tags: { feature: "service-records" },
    });
  });

  it("keeps service-record request errors and drops unrelated transactions", () => {
    const options = getSentryRuntimeOptions();

    expect(
      options.beforeSend({
        type: undefined,
        request: {
          url: "https://admin.example.com/api/admin/service-records/client/7",
        },
      }),
    ).toMatchObject({
      request: {
        url: "https://admin.example.com/api/admin/service-records/client/[Filtered]",
      },
    });
    expect(
      options.beforeSendTransaction({
        type: "transaction",
        transaction: "GET /dashboard",
      }),
    ).toBeNull();
  });

  it("reports removed schedule-change route errors without sampling their traces", () => {
    const options = getSentryRuntimeOptions();
    const path = "/api/schedule-change-requests/schedules/431/preview";

    expect(options.beforeSend({ type: undefined, request: { url: path } })).toMatchObject({
      tags: { feature: "frontend" },
      request: { url: "/api/schedule-change-requests/schedules/[Filtered]/preview" },
    });
    expect(options.tracesSampler({
      name: `POST ${path}`,
      inheritOrSampleWith: (rate: number) => rate,
    })).toBe(0);
  });

  it("samples only service-record traces", () => {
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.4";

    const options = getSentryRuntimeOptions();
    const inheritOrSampleWith = jest.fn((rate: number) => rate);

    expect(
      options.tracesSampler({
        name: "GET /api/admin/service-records/client/:id",
        inheritOrSampleWith,
      }),
    ).toBe(0.4);
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


describe("frontend Sentry error coverage", () => {
  it("sends a sanitized render error without its original PII or request payload", () => {
    const detail = "user@example.com 010-1234-5678";
    const stacktrace = { frames: [{ filename: "/contracts/page.tsx", function: "render" }] };
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      message: `Failed for ${detail}`,
      logentry: { message: detail, params: [detail] },
      exception: { values: [{ type: "TypeError", value: detail, stacktrace }] },
      user: { email: "user@example.com" },
      request: {
        url: "/contracts?token=private#details",
        data: { detail },
        query_string: detail,
        cookies: { session: "private" },
      },
      breadcrumbs: [{ message: detail }],
    });

    expect(sent).toMatchObject({
      message: "Frontend error",
      logentry: { message: "Frontend error", params: undefined },
      exception: { values: [{ type: "TypeError", value: "Frontend error", stacktrace }] },
      tags: { feature: "frontend" },
      user: undefined,
      request: { url: "/contracts", data: undefined, query_string: undefined, cookies: undefined },
      breadcrumbs: undefined,
    });
    expect(JSON.stringify(sent)).not.toContain("user@example.com");
    expect(JSON.stringify(sent)).not.toContain("010-1234-5678");
    expect(JSON.stringify(sent)).not.toContain("private");
  });

  it("preserves the existing service-record output without adding a feature tag", () => {
    const stacktrace = { frames: [{ filename: "/service-record/page.tsx" }] };
    expect(getSentryRuntimeOptions().beforeSend({
      type: undefined,
      message: "service-record failed",
      logentry: { message: "private detail", params: ["private"] },
      exception: { values: [{ type: "TypeError", value: "private", stacktrace }] },
      user: { id: "private" },
      request: { url: "/api/service-record/private/context?token=private", data: "private" },
      breadcrumbs: [{ message: "private" }],
      extra: { email: "user@example.com", operation: "context" },
    })).toEqual({
      type: undefined,
      message: "Service-record error",
      transaction: undefined,
      logentry: { message: "Service-record error", params: undefined },
      exception: { values: [{ type: "TypeError", value: "Service-record error", stacktrace }] },
      user: undefined,
      request: {
        url: "/api/service-record/[Filtered]/context", data: undefined,
        query_string: undefined, cookies: undefined, headers: undefined,
      },
      breadcrumbs: undefined,
      extra: { email: "[Filtered]", operation: "context" },
      spans: undefined,
    });
  });

  it.each(["frontend", "service-records"])("sanitizes contexts and tags for %s while preserving trace linkage", (feature) => {
    const trace = { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef" };
    const sent = getSentryRuntimeOptions().beforeSend({
      type: undefined,
      tags: { feature, detail: "user@example.com 010-1234-5678", count: 7, enabled: true },
      contexts: {
        trace,
        diagnostic: {
          detail: "user@example.com 010-1234-5678",
          nested: { email: "user@example.com", phone: "010-1234-5678" },
          url: "/clients?token=private",
          query_string: "private",
        },
      },
    });
    expect(sent).toMatchObject({
      tags: { feature, detail: "[Email] [Phone]", count: 7, enabled: true },
      contexts: {
        trace,
        diagnostic: {
          detail: "[Email] [Phone]",
          nested: { email: "[Filtered]", phone: "[Filtered]" },
          url: "/clients",
          query_string: "[Filtered]",
        },
      },
    });
    expect(sent?.contexts?.trace).toBe(trace);
    expect(JSON.stringify(sent)).not.toMatch(/user@example\.com|010-1234-5678|private/);
  });

  it("preserves an existing feature tag on a non-service-record event", () => {
    expect(getSentryRuntimeOptions().beforeSend({ type: undefined, tags: { feature: "api" } })).toMatchObject({
      tags: { feature: "api" },
    });
  });

  describe.each(["frontend", "service-records"])("%s request path privacy", (feature) => {
    it.each([
      ["/clients?search=QA-Client-Name#details", "/clients"],
      ["https://admin.example.com/contracts?search=QA-Client-Name#details", "https://admin.example.com/contracts"],
      ["/clients?search=QA%20Client%20Name#details", "/clients"],
    ])("strips queries and fragments from contexts.nextjs.request_path: %s", (requestPath, expectedPath) => {
      const trace = { trace_id: "0123456789abcdef0123456789abcdef", span_id: "0123456789abcdef" };
      const sent = getSentryRuntimeOptions().beforeSend({
        type: undefined,
        tags: { feature },
        contexts: { trace, nextjs: { request_path: requestPath } },
      });

      expect(sent.contexts?.nextjs?.request_path).toBe(expectedPath);
      expect(sent.contexts?.trace).toBe(trace);
      expect(sent.tags?.feature).toBe(feature);
      expect(JSON.stringify(sent)).not.toMatch(/search|QA-Client-Name|QA%20Client%20Name|details/);
    });
  });

  it("filters browser extensions and ResizeObserver loop noise", () => {
    const options = getSentryRuntimeOptions();
    for (const url of ["chrome-extension://abc/script.js", "moz-extension://abc/script.js", "safari-extension://abc/script.js", "safari-web-extension://abc/script.js"]) {
      expect(options.denyUrls.some((pattern) => pattern.test(url))).toBe(true);
    }
    expect(options.denyUrls.some((pattern) => pattern.test("https://admin.example.com/script.js"))).toBe(false);
    expect(options.ignoreErrors.some((pattern) => pattern.test("ResizeObserver loop limit exceeded"))).toBe(true);
    expect(options.ignoreErrors.some((pattern) => pattern.test("Render failed"))).toBe(false);
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
