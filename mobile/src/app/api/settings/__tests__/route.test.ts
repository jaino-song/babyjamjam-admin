/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  GET as getMessageSenderApproval,
  POST as requestMessageSenderApproval,
} from "../message-sender-approval/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("settings API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function noCookieRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  it("requires auth before fetching message sender approval status", async () => {
    const response = await getMessageSenderApproval(noCookieRequest("/api/settings/message-sender-approval"));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before requesting message sender approval", async () => {
    const response = await requestMessageSenderApproval(noCookieRequest("/api/settings/message-sender-approval", "POST"));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects malformed message sender approval JSON before proxying", async () => {
    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards an empty message sender approval request body before proxying", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { approvalStatus: "pending" } });

    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/settings/message-sender-approval/request",
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("forwards validated message sender approval request to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { approvalStatus: "pending" } });

    const approvalBody = { senderPhone: "01012345678" };

    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approvalBody),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ approvalStatus: "pending" });
    expect(mockPost).toHaveBeenCalledWith(
      "/settings/message-sender-approval/request",
      approvalBody,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });
});
