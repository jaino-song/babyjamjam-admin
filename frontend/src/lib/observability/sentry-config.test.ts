import type { Event, Log } from "@sentry/nextjs";

import {
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

  it("keeps only the internal user id and removes request payloads", () => {
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
      user: { id: "user-1" },
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
