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

function request(withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/branches/branch-1/holidays/review-events", {
    headers: withCookie ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("GET /api/branches/[branchId]/holidays/review-events", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("rejects an unauthenticated read without calling the backend", async () => {
    const response = await GET(request(false), { params: Promise.resolve({ branchId: "branch-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns the backend events and sends the auth header", async () => {
    const events = [{ id: "evt-1", date: "2026-10-05", change: "added", safeOpen: 2, riskOpen: 1 }];
    mockGet.mockResolvedValue({ status: 200, data: events });

    const response = await GET(request(), { params: Promise.resolve({ branchId: "branch-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(events);
    expect(mockGet).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/review-events",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("URL-encodes the branch id", async () => {
    mockGet.mockResolvedValue({ status: 200, data: [] });

    await GET(request(), { params: Promise.resolve({ branchId: "a/b c" }) });

    expect(mockGet.mock.calls[0][0]).toBe("/branches/a%2Fb%20c/holidays/review-events");
  });

  it("maps a backend problem+json to its status and code", async () => {
    const problem = createProblemDetails({
      code: "RESOURCE_NOT_FOUND",
      requestId: "req-review-1",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockGet.mockRejectedValue({ response: { status: 404, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request(), { params: Promise.resolve({ branchId: "branch-1" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    consoleErrorSpy.mockRestore();
  });
});
