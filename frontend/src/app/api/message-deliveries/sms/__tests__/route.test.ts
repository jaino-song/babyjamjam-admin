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
      error: "Branch context changed while processing the request",
    });
  });
});
