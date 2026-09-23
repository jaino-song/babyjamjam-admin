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

function createRequest(path: string, body: unknown, authenticated = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("message-deliveries SMS proxy", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("forwards the captured branch identity as a query precondition", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { result: { resultCode: 1 } },
    });

    const body = {
      receiver: "010-1111-1111",
      message: "현재 지점 문구",
      msgType: "AUTO",
      triggerType: "immediate",
    };
    const response = await POST(createRequest("/api/message-deliveries/sms?expectedBranchId=branch-a", body));

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/message-deliveries/sms",
      body,
      {
        headers: { Authorization: "Bearer token-1" },
        params: { expectedBranchId: "branch-a" },
      },
    );
  });

  it("preserves a branch-context conflict from the backend", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "BRANCH_CONTEXT_CHANGED",
          message: "Branch context changed while processing the request",
        },
      },
    });

    const response = await POST(
      createRequest(
        "/api/message-deliveries/sms?expectedBranchId=branch-a",
        { receiver: "010-1111-1111", message: "문구", msgType: "AUTO", triggerType: "immediate" },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "BRANCH_CONTEXT_CHANGED",
      error: "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.",
    });
  });

  it("rejects an unauthenticated send with a registered 401 problem body", async () => {
    const response = await POST(
      createRequest("/api/message-deliveries/sms", { receiver: "010-1111-1111" }, false),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("sanitizes a transport failure instead of a raw 500 body", async () => {
    mockPost.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.9:443"));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await POST(
        createRequest("/api/message-deliveries/sms", {
          receiver: "010-1111-1111",
          message: "문구",
          msgType: "AUTO",
          triggerType: "immediate",
        }),
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(typeof body.error).toBe("string");
      expect(JSON.stringify(body)).not.toContain("10.0.0.9");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
