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
const context = { params: Promise.resolve({ branchId: "branch-1", eventId: "evt-1" }) };

function request(query = "", withCookie = true): NextRequest {
  return new NextRequest(`http://localhost/api/branches/branch-1/holidays/review-events/evt-1/items${query}`, {
    headers: withCookie ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("GET /api/branches/[branchId]/holidays/review-events/[eventId]/items", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("rejects an unauthenticated read without calling the backend", async () => {
    const response = await GET(request("", false), context);

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("passes category, status and q through and returns the backend items", async () => {
    const items = [{ id: "item-1", clientName: "김하늘", category: "safe" }];
    mockGet.mockResolvedValue({ status: 200, data: items });

    const response = await GET(request("?category=safe&status=open&q=%EA%B9%80"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(items);
    expect(mockGet).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/review-events/evt-1/items",
      expect.objectContaining({
        params: { category: "safe", status: "open", q: "김" },
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("omits filters the caller did not send and ignores unknown query keys", async () => {
    mockGet.mockResolvedValue({ status: 200, data: [] });

    await GET(request("?status=fixed&other=1"), context);

    expect(mockGet.mock.calls[0][1].params).toEqual({ status: "fixed" });
  });

  it("URL-encodes the branch and event ids", async () => {
    mockGet.mockResolvedValue({ status: 200, data: [] });

    await GET(request(), { params: Promise.resolve({ branchId: "a/b", eventId: "e v?" }) });

    expect(mockGet.mock.calls[0][0]).toBe("/branches/a%2Fb/holidays/review-events/e%20v%3F/items");
  });

  it("maps a 404 problem+json to its status and code", async () => {
    const problem = createProblemDetails({
      code: "RESOURCE_NOT_FOUND",
      requestId: "req-review-2",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockGet.mockRejectedValue({ response: { status: 404, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    consoleErrorSpy.mockRestore();
  });
});
