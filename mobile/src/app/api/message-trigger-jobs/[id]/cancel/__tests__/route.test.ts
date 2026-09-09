/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(id: string, authenticated = true): NextRequest {
  return new NextRequest(`http://localhost/api/message-trigger-jobs/${id}/cancel`, {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("POST /api/message-trigger-jobs/[id]/cancel", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires authentication before proxying", async () => {
    const response = await POST(createRequest("job-1", false), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects an id the validator refuses before proxying", async () => {
    // Manual-scheduled rows synthesize ids like "log:41" (see backend
    // MessageTriggerService.listManualScheduledSmsLogs) — the colon fails
    // isValidJobId's [A-Za-z0-9_-] charset. That is exactly why those rows
    // must never reach this endpoint (see the mobile isCancelable fix in
    // MessagesDataPages.tsx, which now excludes them from the cancel action).
    const response = await POST(createRequest("log:41"), {
      params: Promise.resolve({ id: "log:41" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid message trigger job id" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards an authenticated cancel request for a valid job id", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { id: "job-1", status: "canceled" },
    });

    const response = await POST(createRequest("job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "job-1", status: "canceled" });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-trigger-jobs/job-1/cancel",
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("forwards a safe backend conflict message while omitting diagnostics", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: "이미 발송되었거나 취소할 수 없는 상태예요.",
          diagnostics: { authorization: "Bearer upstream-secret", query: "SELECT * FROM MessageJob" },
        },
      },
    });

    const response = await POST(createRequest("job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: "이미 발송되었거나 취소할 수 없는 상태예요." });
    expect(JSON.stringify(body)).not.toContain("upstream-secret");
    expect(JSON.stringify(body)).not.toContain("SELECT * FROM MessageJob");
  });

  it.each([
    [400, "Invalid access token: eyJ.secret"],
    [500, "PrismaClientKnownRequestError: SELECT * FROM MessageJob"],
  ])("suppresses unsafe cancel diagnostics from %i responses", async (status, message) => {
    mockPost.mockRejectedValue({
      response: {
        status,
        data: { message, diagnostics: { authorization: "Bearer upstream-secret" } },
      },
    });

    const response = await POST(createRequest("job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toEqual({ error: expect.stringMatching(/[가-힣].*요[.!]?$/) });
    expect(JSON.stringify(body)).not.toContain(message);
    expect(JSON.stringify(body)).not.toContain("upstream-secret");
  });
});
