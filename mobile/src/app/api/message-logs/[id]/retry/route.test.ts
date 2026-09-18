/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(id: string, authenticated = true): NextRequest {
  return new NextRequest(`http://localhost/api/message-logs/${id}/retry`, {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("POST /api/message-logs/[id]/retry", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires authentication before proxying", async () => {
    const response = await POST(createRequest("77", false), {
      params: Promise.resolve({ id: "77" }),
    });

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "abc", "1/../2", ""])(
    "rejects an invalid message log id (%s) before proxying",
    async (id) => {
      const response = await POST(createRequest(id), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(400);
      expect(mockPost).not.toHaveBeenCalled();
    },
  );

  it("forwards an authenticated retry request for a valid id", async () => {
    mockPost.mockResolvedValue({
      status: 201,
      data: { id: 77, status: "pending" },
    });

    const response = await POST(createRequest("77"), {
      params: Promise.resolve({ id: "77" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 77, status: "pending" });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-logs/77/retry",
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("suppresses unsafe upstream diagnostics while retaining the status", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: "이미 재발송이 진행 중입니다.",
          diagnostics: { authorization: "Bearer upstream-secret", query: "SELECT * FROM message_logs" },
        },
      },
    });

    const response = await POST(createRequest("77"), {
      params: Promise.resolve({ id: "77" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to retry message log", code: "UPSTREAM_ERROR" });
    expect(JSON.stringify(body)).not.toContain("upstream-secret");
    expect(JSON.stringify(body)).not.toContain("SELECT * FROM message_logs");
  });
});
