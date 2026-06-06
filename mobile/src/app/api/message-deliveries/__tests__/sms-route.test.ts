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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
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

  it("does not return or log raw upstream SMS error payloads", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 502,
        data: {
          error: "provider trace /tmp/sms-worker",
          code: "SMS_PROVIDER_ERROR",
          diagnostics: { host: "sms.internal" },
        },
      },
      code: "ERR_BAD_RESPONSE",
      name: "AxiosError",
    });

    const response = await sendSms(createRequest(JSON.stringify({ message: "hello" })));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to send SMS",
      code: "SMS_PROVIDER_ERROR",
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/sms-worker");
    expect(logged).not.toContain("sms.internal");
  });
});
