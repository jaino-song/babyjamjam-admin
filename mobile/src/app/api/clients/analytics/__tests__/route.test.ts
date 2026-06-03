/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;

function createRequest(): NextRequest {
  return new NextRequest("http://localhost/api/clients/analytics", {
    headers: {
      cookie: "auth_token=auth-token",
    },
  });
}

describe("clients analytics route", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockServerGet.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it("overrides backend dashboard counts with service-start window derived counts", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-10T12:00:00+09:00"));

    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/analytics") {
        return {
          status: 200,
          data: {
            activeClients: 11,
            contractsNotSent: 99,
            contractsPendingSignature: 3,
            upcomingThisMonth: 4,
            upcomingNextMonth: 5,
          },
        };
      }

      return {
        status: 200,
        data: {
          data: [
            {
              serviceStatus: "waiting",
              startDate: "2026-06-03T00:00:00+09:00",
              eDocId: null,
              documentStatus: null,
            },
            {
              serviceStatus: "active",
              startDate: "2026-06-17T23:59:00+09:00",
              eDocId: "doc-1",
              documentStatus: "opened",
            },
            {
              serviceStatus: "active",
              startDate: "2026-06-18T00:00:00+09:00",
              eDocId: null,
              documentStatus: null,
            },
            {
              serviceStatus: "waiting",
              startDate: "2026-06-10T00:00:00+09:00",
              eDocId: "doc-2",
              documentStatus: "completed",
            },
          ],
        },
      };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeClients: 11,
      contractsNotSent: 2,
      contractsPendingSignature: 3,
      upcomingThisMonth: 2,
      upcomingNextMonth: 5,
    });
  });

  it("does not expose raw backend details when client-derived analytics fail", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/analytics") {
        return { status: 404, data: { message: "missing analytics endpoint" } };
      }

      return {
        status: 502,
        data: {
          message: "database host analytics.internal returned /tmp/clients",
          code: "CLIENT_ANALYTICS_ERROR",
          diagnostics: { host: "analytics.internal" },
        },
      };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch dashboard analytics",
      code: "CLIENT_ANALYTICS_ERROR",
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/clients");
    expect(logged).not.toContain("analytics.internal");
  });
});
