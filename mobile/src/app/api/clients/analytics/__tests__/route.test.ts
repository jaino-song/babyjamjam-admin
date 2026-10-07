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

  const weekClients = {
    status: 200,
    data: {
      data: [
        { serviceStatus: "waiting", startDate: "2026-06-03T00:00:00+09:00", eDocId: null, documentStatus: null },
        { serviceStatus: "active", startDate: "2026-06-17T23:59:00+09:00", eDocId: "doc-1", documentStatus: "opened" },
        { serviceStatus: "active", startDate: "2026-06-18T00:00:00+09:00", eDocId: null, documentStatus: null },
        { serviceStatus: "waiting", startDate: "2026-06-10T00:00:00+09:00", eDocId: "doc-2", documentStatus: "completed" },
        { serviceStatus: "pre_booking", startDate: "2026-06-12T00:00:00+09:00", eDocId: null, documentStatus: null },
      ],
    },
  };

  it("returns the backend stats as-is and only adds the seven-day start count from the client list", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-10T12:00:00+09:00"));

    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        return {
          status: 200,
          data: {
            activeClients: 11,
            contractsNotSent: 4,
            contractsPendingSignature: 3,
            upcomingThisMonth: 9,
            upcomingNextMonth: 5,
          },
        };
      }

      return weekClients;
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    // contractsNotSent / upcomingThisMonth are the backend's numbers, not locally re-derived ones.
    await expect(response.json()).resolves.toEqual({
      activeClients: 11,
      contractsNotSent: 4,
      contractsPendingSignature: 3,
      upcomingThisMonth: 9,
      upcomingNextMonth: 5,
      upcomingWithinWeek: 3,
    });
    expect(mockServerGet).toHaveBeenCalledWith("/clients/stats", expect.anything());
    expect(mockServerGet).not.toHaveBeenCalledWith("/clients/analytics", expect.anything());
  });

  it("reports the contract counts as unknown (null), never zero, when the backend stats are unavailable", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-10T12:00:00+09:00"));

    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        return { status: 500, data: { message: "boom" } };
      }

      return weekClients;
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activeClients: 2,
      contractsNotSent: null,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: 0,
      upcomingWithinWeek: 3,
    });
  });

  it("returns 200 with all-unknown counts when both upstreams are unreachable", async () => {
    mockServerGet.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3001"), { code: "ECONNREFUSED" }));

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      activeClients: null,
      contractsNotSent: null,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: null,
      upcomingWithinWeek: null,
    });
  });

  it("returns 200 with unknown counts when both upstreams answer 5xx (thrown by axios)", async () => {
    mockServerGet.mockRejectedValue({ response: { status: 503, data: { message: "down" } } });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ activeClients: null, contractsNotSent: null });
  });

  it("derives only list-based counts when the stats request fails but the list loads", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-10T12:00:00+09:00"));

    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") throw new Error("connect ECONNREFUSED");
      return weekClients;
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activeClients: 2,
      contractsNotSent: null,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: 0,
      upcomingWithinWeek: 3,
    });
  });

  it("does not mask an upstream 401 on the stats request", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        throw { response: { status: 401, data: { message: "Unauthorized" } } };
      }
      return weekClients;
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
  });

  it("does not mask an upstream 403 on the client list", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") throw new Error("connect ECONNREFUSED");
      throw { response: { status: 403, data: { message: "Forbidden" } } };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
  });

  it("keeps the backend stats when the client list fails", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        return {
          status: 200,
          data: { activeClients: 11, contractsNotSent: 4, contractsPendingSignature: 3, upcomingThisMonth: 9, upcomingNextMonth: 5 },
        };
      }

      return { status: 502, data: { message: "down" } };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ contractsNotSent: 4, upcomingThisMonth: 9 });
  });

  it("uses the backend-safe clients page limit when deriving analytics locally", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        return { status: 404, data: { message: "missing analytics endpoint" } };
      }

      return {
        status: 200,
        data: { data: [] },
      };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(mockServerGet).toHaveBeenCalledWith(
      "/clients",
      expect.objectContaining({
        params: { page: 1, limit: 100 },
      }),
    );
  });

  it("does not expose raw backend details when the stats and the client list are both unavailable", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
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

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    const body = await response.json();
    expect(body).toEqual({
      activeClients: null,
      contractsNotSent: null,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: null,
      upcomingWithinWeek: null,
    });
    expect(JSON.stringify(body)).not.toContain("analytics.internal");
  });

  it("sanitizes an authorization failure on the client list instead of leaking upstream details", async () => {
    mockServerGet.mockImplementation(async (path: string) => {
      if (path === "/clients/stats") {
        return { status: 404, data: { message: "missing analytics endpoint" } };
      }

      return {
        status: 403,
        data: {
          message: "database host analytics.internal returned /tmp/clients",
          code: "CLIENT_ANALYTICS_ERROR",
          diagnostics: { host: "analytics.internal" },
        },
      };
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("analytics.internal");
    expect(JSON.stringify(body)).not.toContain("/tmp/clients");
  });
});
