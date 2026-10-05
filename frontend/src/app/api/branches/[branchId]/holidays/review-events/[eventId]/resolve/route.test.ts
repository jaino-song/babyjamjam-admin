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
const context = { params: Promise.resolve({ branchId: "branch-1", eventId: "evt-1" }) };

function request(body: unknown, withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/branches/branch-1/holidays/review-events/evt-1/resolve", {
    method: "POST",
    headers: withCookie ? { cookie: "auth_token=auth-token", "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });
}

describe("POST /api/branches/[branchId]/holidays/review-events/[eventId]/resolve", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("rejects an unauthenticated write without calling the backend", async () => {
    const response = await POST(request({ itemIds: ["a"], action: "fix" }, false), context);

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the body and auth header and returns the backend result", async () => {
    const result = { fixed: 1, kept: 0, skipped: [{ itemId: "b", code: "CLIENT_CHANGED" }] };
    mockPost.mockResolvedValue({ status: 200, data: result });

    const response = await POST(request({ itemIds: ["a", "b"], action: "fix" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(mockPost).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/review-events/evt-1/resolve",
      { itemIds: ["a", "b"], action: "fix" },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("URL-encodes the branch and event ids", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { fixed: 0, kept: 0, skipped: [] } });

    await POST(request({ itemIds: [], action: "keep" }), {
      params: Promise.resolve({ branchId: "a/b", eventId: "e v" }),
    });

    expect(mockPost.mock.calls[0][0]).toBe("/branches/a%2Fb/holidays/review-events/e%20v/resolve");
  });

  it("maps a 400 validation problem+json to its status and code", async () => {
    const problem = createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId: "req-review-3",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockPost.mockRejectedValue({ response: { status: 400, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ itemIds: [], action: "fix" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    consoleErrorSpy.mockRestore();
  });
});
