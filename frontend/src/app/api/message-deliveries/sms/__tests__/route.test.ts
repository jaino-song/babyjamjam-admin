/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";
import { POST as duplicatePOST } from "../duplicate-check/route";
import { api } from "@/lib/api/client";
import { messageDeliveryApi } from "@/services/message-delivery";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, body: unknown, authenticated = true, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
      "content-type": "application/json",
      ...headers,
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


describe.each([
  ["send", POST, "/message-deliveries/sms"],
  ["preflight", duplicatePOST, "/message-deliveries/sms/duplicate-check"],
] as const)("D4 %s exact proxy forwarding", (_kind, handler, path) => {
  beforeEach(() => mockPost.mockReset());
  const body = {
    receiver: "010-1111-1111", message: "본문", title: "제목", recipientName: "고객", clientId: 42, employeeId: 9,
    msgType: "LMS", triggerType: "scheduled", scheduledDate: "20261107", scheduledTime: "0900", testMode: true,
    idempotencyKey: "body-has-priority", duplicateDecision: { confirmed: true, checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [11, 12], payloadHash: "payload-hash" },
  };
  it.each([undefined, "", "conflicting-header"])("preserves the complete body and optional header %s", async (header) => {
    const upstream = { outcome: "deferred", items: [{ status: "deferred", scheduledAt: "2026-11-07T00:00:00.000Z", reason: "quiet-hours" }] };
    mockPost.mockResolvedValue({ status: 202, data: upstream });
    const response = await handler(createRequest(`/api${path}?expectedBranchId=branch-a`, body, true, header === undefined ? {} : { "Idempotency-Key": header }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(upstream);
    expect(mockPost).toHaveBeenCalledWith(path, body, {
      headers: { Authorization: "Bearer token-1", ...(header === undefined ? {} : { "Idempotency-Key": header }) },
      params: { expectedBranchId: "branch-a" },
    });
  });
  it.each(["", "?expectedBranchId=", "?expectedBranchId=%20branch-a%20"])("preserves branch query presence/value %s", async (query) => {
    mockPost.mockResolvedValue({ status: 200, data: { checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [11], latestSentAt: null, payloadHash: "hash" } });
    await handler(createRequest(`/api${path}${query}`, body));
    expect(mockPost).toHaveBeenCalledWith(path, body, {
      headers: { Authorization: "Bearer token-1" },
      ...(query ? { params: { expectedBranchId: query.includes("%20") ? " branch-a " : "" } } : {}),
    });
  });
  it("preserves a resolved upstream error status and sanitizes its body", async () => {
    mockPost.mockResolvedValue({ status: 409, data: { code: "REQUEST_CONFLICT", message: "private upstream detail" } });
    const response = await handler(createRequest(`/api${path}?expectedBranchId=branch-a`, body));
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.code).toBe("REQUEST_CONFLICT");
    expect(JSON.stringify(data)).not.toContain("private upstream detail");
  });
  it("requires authentication before forwarding", async () => {
    const response = await handler(createRequest(`/api${path}`, body, false));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });
  it("preserves an upstream rejection status without exposing transport details", async () => {
    mockPost.mockRejectedValue({ response: { status: 503, data: { message: "private provider origin" } } });
    const response = await handler(createRequest(`/api${path}`, body));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private provider origin");
  });
});

describe("D4 duplicate-check service boundary", () => {
  const clientPost = jest.mocked(api.post);
  beforeEach(() => clientPost.mockReset());
  const body = { receiver: "01011111111", message: "본문", idempotencyKey: "draft-key" };
  it("preserves the payload, branch, and server match/hash facts", async () => {
    const preflight = { checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [901, 902], latestSentAt: "2026-11-06T11:00:00.000Z", payloadHash: "server-hash" };
    clientPost.mockResolvedValue({ data: preflight } as never);
    await expect(messageDeliveryApi.checkSmsDuplicate(body, "branch-a")).resolves.toEqual(preflight);
    expect(clientPost).toHaveBeenCalledWith("/message-deliveries/sms/duplicate-check", body, { params: { expectedBranchId: "branch-a" } });
  });
  it.each([
    { checkedAt: "invalid", matchIds: [], latestSentAt: null, payloadHash: "hash" },
    { checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [0], latestSentAt: null, payloadHash: "hash" },
    { checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [1], latestSentAt: "invalid", payloadHash: "hash" },
    { checkedAt: "2026-11-06T12:00:00.000Z", matchIds: [], latestSentAt: null, payloadHash: "" },
  ])("rejects malformed preflight %#", async (data) => {
    clientPost.mockResolvedValue({ data } as never);
    await expect(messageDeliveryApi.checkSmsDuplicate(body, "branch-a")).rejects.toThrow("중복 확인 응답이 올바르지 않습니다.");
  });
});
