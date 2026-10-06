/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;
const context = { params: Promise.resolve({ branchId: "branch-1" }) };

function request(withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/branches/branch-1/holidays/sync", {
    method: "POST",
    headers: withCookie ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("POST /api/branches/[branchId]/holidays/sync", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("rejects an unauthenticated sync without calling the backend", async () => {
    const response = await POST(request(false), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("triggers the sync on the backend and returns its per-year results", async () => {
    const results = { results: [{ year: 2026, status: "unchanged", added: 0, removed: 0 }] };
    mockPost.mockResolvedValue({ status: 200, data: results });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(results);
    expect(mockPost).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/sync",
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("passes a 429 problem+json through", async () => {
    const problem = createProblemDetails({
      code: "REQUEST_RATE_LIMITED",
      requestId: "req-holiday-4",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockPost.mockRejectedValue({ response: { status: 429, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(), context);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_RATE_LIMITED", status: 429 });
    consoleErrorSpy.mockRestore();
  });
});
