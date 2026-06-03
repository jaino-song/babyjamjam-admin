/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  DELETE as deleteRule,
  GET as getRule,
  PATCH as updateRule,
} from "../[triggerId]/route";
import { GET as listRules, POST as createRule } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
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

describe("Alimtalk trigger rule API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and payload when listing rules", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "trigger access denied" },
      },
    });

    const response = await listRules(createRequest("/api/alimtalk-trigger-rules"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "trigger access denied" });
  });

  it("preserves backend status and payload when creating rules", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createRule(
      createRequest("/api/alimtalk-trigger-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Reminder" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createRule(
      createRequest("/api/alimtalk-trigger-rules", {
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

  it("rejects unsafe trigger IDs before proxying", async () => {
    const response = await getRule(
      createRequest("/api/alimtalk-trigger-rules/bad%2Fid"),
      { params: Promise.resolve({ triggerId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid trigger id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateRule(
      createRequest("/api/alimtalk-trigger-rules/rule_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("preserves backend delete status and payload", async () => {
    mockDelete.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await deleteRule(
      createRequest("/api/alimtalk-trigger-rules/rule_123", { method: "DELETE" }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });
});
