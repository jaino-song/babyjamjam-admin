/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listMessageLogs } from "../message-logs/route";
import { GET as listUpcomingJobs } from "../message-trigger-jobs/upcoming/route";
import { GET as listTriggerTemplates } from "../message-trigger-templates/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

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

describe("Message API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("auth rejection", () => {
    const noAuth = { headers: { cookie: "" } };

    it("rejects message logs GET without an auth cookie before proxying", async () => {
      const response = await listMessageLogs(createRequest("/api/message-logs", noAuth));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects upcoming jobs GET without an auth cookie before proxying", async () => {
      const response = await listUpcomingJobs(createRequest("/api/message-trigger-jobs/upcoming", noAuth));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects trigger templates GET without an auth cookie before proxying", async () => {
      const response = await listTriggerTemplates(createRequest("/api/message-trigger-templates", noAuth));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  it("preserves backend error status and sanitizes payload when listing message logs", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "log access denied" },
      },
    });

    const response = await listMessageLogs(createRequest("/api/message-logs"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch message logs" });
  });

  it("forwards message log limit and skip params", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: [],
    });

    const response = await listMessageLogs(createRequest("/api/message-logs?limit=500&skip=500"));

    expect(response.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith("/message-logs", {
      headers: { Authorization: "Bearer auth-token" },
      params: {
        limit: "500",
        skip: "500",
      },
    });
  });

  it("preserves backend error status and sanitizes payload when listing upcoming jobs", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 429,
        data: { error: "too many requests" },
      },
    });

    const response = await listUpcomingJobs(
      createRequest("/api/message-trigger-jobs/upcoming?limit=50"),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch upcoming message trigger jobs" });
  });

  it("preserves backend error status and sanitizes payload when listing trigger templates", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 422,
        data: { error: "invalid provider" },
      },
    });

    const response = await listTriggerTemplates(
      createRequest("/api/message-trigger-templates?provider=unknown"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch message trigger templates" });
  });

});
