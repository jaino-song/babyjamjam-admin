/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const context = { params: Promise.resolve({ branchId: "branch-1" }) };

function request(path: string, withCookie = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: withCookie ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("GET /api/branches/[branchId]/holidays", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("rejects an unauthenticated read without calling the backend", async () => {
    const response = await GET(request("/api/branches/branch-1/holidays?year=2026", false), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("forwards the year and the auth header to the backend and returns its body", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { year: 2026, holidays: [] } });

    const response = await GET(request("/api/branches/branch-1/holidays?year=2026"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ year: 2026, holidays: [] });
    expect(mockGet).toHaveBeenCalledWith(
      "/branches/branch-1/holidays",
      expect.objectContaining({
        params: { year: "2026" },
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("passes a backend problem+json status and code through", async () => {
    const problem = createProblemDetails({
      code: "HOLIDAY_YEAR_UNSUPPORTED",
      requestId: "req-holiday-1",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockGet.mockRejectedValue({ response: { status: 409, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request("/api/branches/branch-1/holidays?year=1999"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "HOLIDAY_YEAR_UNSUPPORTED",
      status: 409,
      requestId: "req-holiday-1",
    });
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    consoleErrorSpy.mockRestore();
  });
});
