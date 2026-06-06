/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listAlimtalkLogs } from "../alimtalk-logs/route";
import {
  GET as listAlimtalkTemplates,
  POST as createAlimtalkTemplate,
} from "../alimtalk-templates/route";
import { GET as listUpcomingJobs } from "../alimtalk-trigger-jobs/upcoming/route";
import { GET as listTriggerTemplates } from "../alimtalk-trigger-templates/route";

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

describe("Alimtalk API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and sanitizes payload when listing Alimtalk logs", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "log access denied" },
      },
    });

    const response = await listAlimtalkLogs(createRequest("/api/alimtalk-logs"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch alimtalk logs" });
  });

  it("forwards Alimtalk log limit and skip params", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: [],
    });

    const response = await listAlimtalkLogs(createRequest("/api/alimtalk-logs?limit=500&skip=500"));

    expect(response.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith("/alimtalk-logs", {
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
      createRequest("/api/alimtalk-trigger-jobs/upcoming?limit=50"),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch upcoming alimtalk trigger jobs" });
  });

  it("preserves backend error status and sanitizes payload when listing trigger templates", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 422,
        data: { error: "invalid provider" },
      },
    });

    const response = await listTriggerTemplates(
      createRequest("/api/alimtalk-trigger-templates?provider=unknown"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch alimtalk trigger templates" });
  });

  it("preserves backend status and payload when listing Alimtalk templates", async () => {
    mockGet.mockResolvedValue({
      status: 206,
      data: [{ key: "welcome" }],
    });

    const response = await listAlimtalkTemplates(createRequest("/api/alimtalk-templates"));

    expect(response.status).toBe(206);
    await expect(response.json()).resolves.toEqual([{ key: "welcome" }]);
  });

  it("rejects malformed Alimtalk template JSON before proxying", async () => {
    const response = await createAlimtalkTemplate(
      createRequest("/api/alimtalk-templates", {
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
});
