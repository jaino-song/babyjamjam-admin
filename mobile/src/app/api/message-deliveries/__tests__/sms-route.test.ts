/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST as sendSms } from "../sms/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: BodyInit): NextRequest {
  return new NextRequest("http://localhost/api/message-deliveries/sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

describe("SMS delivery API route", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("rejects malformed JSON before proxying", async () => {
    const response = await sendSms(createRequest("{bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("preserves backend status and payload", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await sendSms(createRequest(JSON.stringify({ message: "hello" })));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });
});
