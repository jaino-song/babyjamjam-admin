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

function request(body: unknown, withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/branches/branch-1/holidays/overrides", {
    method: "POST",
    headers: withCookie ? { cookie: "auth_token=auth-token", "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });
}

describe("POST /api/branches/[branchId]/holidays/overrides", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("rejects an unauthenticated write without calling the backend", async () => {
    const response = await POST(request({ date: "2026-10-21", kind: "add", name: "x" }, false), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the body and the auth header and returns the backend status and body", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { id: "ovr-1" } });
    const body = { date: "2026-10-21", kind: "add", name: "임시공휴일" };

    const response = await POST(request(body), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "ovr-1" });
    expect(mockPost).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/overrides",
      body,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("passes a backend problem+json status and code through", async () => {
    const problem = createProblemDetails({
      code: "HOLIDAY_NOT_WEEKDAY",
      requestId: "req-holiday-2",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockPost.mockRejectedValue({ response: { status: 400, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ date: "2026-10-24", kind: "add", name: "x" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "HOLIDAY_NOT_WEEKDAY", status: 400 });
    consoleErrorSpy.mockRestore();
  });
});
