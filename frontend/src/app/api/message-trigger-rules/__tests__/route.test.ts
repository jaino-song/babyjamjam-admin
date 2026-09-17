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
import { PUT as updateBranchActivation } from "../[triggerId]/branch-activation/route";
import { GET as listRules, POST as createRule } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(
  path: string,
  init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("frontend message trigger rule API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ["GET", () => listRules(createRequest("/api/message-trigger-rules", { headers: { cookie: "" } }))],
    [
      "POST",
      () => createRule(createRequest("/api/message-trigger-rules", {
        method: "POST",
        headers: { cookie: "", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })),
    ],
  ])("requires authentication before proxying %s with a registered 401 problem body", async (_method, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("accepts SERVICE_END_NOTICE through the shared create schema", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { id: "rule-1" } });

    const payload = {
      name: "서비스 종료 영수증 안내",
      eventType: "SERVICE_END",
      offsetType: "SAME_DAY",
      recipientType: "CLIENT",
      templateKey: "SERVICE_END_NOTICE",
    };

    const response = await createRule(createRequest("/api/message-trigger-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "rule-1" });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-trigger-rules",
      payload,
      expect.objectContaining({ headers: { Authorization: "Bearer auth-token" } }),
    );
  });

  it.each([
    ["CLIENT_CREATED", "NOT_A_TEMPLATE"],
    ["PATCH", "NOT_A_TEMPLATE"],
  ])("rejects an invalid template key before proxying (%s)", async (method, templateKey) => {
    const response = method === "PATCH"
      ? await updateRule(createRequest("/api/message-trigger-rules/rule-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey }),
      }), { params: Promise.resolve({ triggerId: "rule-1" }) })
      : await createRule(createRequest("/api/message-trigger-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "규칙",
          eventType: "SERVICE_END",
          offsetType: "SAME_DAY",
          recipientType: "CLIENT",
          templateKey,
        }),
      }));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409, 422])(
    "propagates upstream %s through the sanitized error contract without the UPSTREAM_ERROR fallacy",
    async (status) => {
      mockGet.mockRejectedValue({
        response: {
          status,
          data: {
            error: "Bearer upstream-secret",
            message: "internal db host and member@example.com",
          },
        },
      });

      const response = await listRules(createRequest("/api/message-trigger-rules"));

      expect(response.status).toBe(status);
      const body = await response.json();
      expect(typeof body.error).toBe("string");
      expect(body.code).not.toBe("UPSTREAM_ERROR");
      expect(JSON.stringify(body)).not.toContain("upstream-secret");
      expect(JSON.stringify(body)).not.toContain("member@example.com");
    },
  );

  it("propagates a registered upstream problem body with its status and code", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 422,
        data: {
          type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
          title: "Validation failed",
          status: 422,
          detail: "입력 정보가 처리 조건에 맞지 않아요.",
          code: "VALIDATION_FAILED",
          requestId: "req-trigger-1",
          params: {},
        },
      },
    });

    const response = await listRules(createRequest("/api/message-trigger-rules"));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 422, requestId: "req-trigger-1" });
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("encodes system trigger IDs before proxying", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { id: "rule_123" } });

    const response = await getRule(
      createRequest("/api/message-trigger-rules/system:service_end_notice"),
      { params: Promise.resolve({ triggerId: "system:service_end_notice" }) },
    );

    expect(response.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith(
      "/message-trigger-rules/system%3Aservice_end_notice",
      expect.objectContaining({ headers: { Authorization: "Bearer auth-token" } }),
    );
  });

  it("rejects unsafe trigger IDs before proxying", async () => {
    const response = await getRule(
      createRequest("/api/message-trigger-rules/bad%2Fid"),
      { params: Promise.resolve({ triggerId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid trigger id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("uses the shared update schema and preserves a backend response status", async () => {
    mockPatch.mockResolvedValue({ status: 202, data: { queued: true } });

    const response = await updateRule(
      createRequest("/api/message-trigger-rules/rule_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false, templateKey: "SERVICE_END_NOTICE" }),
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPatch).toHaveBeenCalledWith(
      "/message-trigger-rules/rule_123",
      { isActive: false, templateKey: "SERVICE_END_NOTICE" },
      expect.anything(),
    );
  });

  it("preserves a backend delete response instead of manufacturing a success body", async () => {
    mockDelete.mockResolvedValue({ status: 204, data: undefined });

    const response = await deleteRule(
      createRequest("/api/message-trigger-rules/rule_123", { method: "DELETE" }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith(
      "/message-trigger-rules/rule_123",
      expect.anything(),
    );
  });

  it("uses the encoded ID and shared body parsing for branch activation", async () => {
    mockPut.mockResolvedValue({ status: 200, data: { id: "system:service_end_notice", isActive: false } });

    const response = await updateBranchActivation(
      createRequest("/api/message-trigger-rules/system:service_end_notice/branch-activation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ triggerId: "system:service_end_notice" }) },
    );

    expect(response.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith(
      "/message-trigger-rules/system%3Aservice_end_notice/branch-activation",
      { isActive: false },
      expect.anything(),
    );
  });
});
