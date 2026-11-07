/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { POST as send } from "../route";
import { POST as duplicateCheck } from "../duplicate-check/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const mockPost = serverAPIClient.post as jest.Mock;

const payload = {
  receiver: "010-1234-5678", message: "동일 payload", title: "제목", recipientName: "고객",
  clientId: 7, employeeId: null, msgType: "LMS", triggerType: "scheduled",
  scheduledDate: "2026-11-07", scheduledTime: "0900", testMode: false, idempotencyKey: "body-key",
  duplicateDecision: { confirmed: true, checkedAt: "2026-11-06T00:00:00.000Z", matchIds: [1], payloadHash: "hash" },
};
function request(path: string, body: unknown = payload, key?: string, authenticated = true) {
  return new NextRequest(`http://localhost/api${path}`, {
    method: "POST", headers: {
      "content-type": "application/json",
      ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    }, body: JSON.stringify(body),
  });
}

beforeEach(() => { mockPost.mockReset(); });

describe.each([
  ["send", "/message-deliveries/sms", send],
  ["duplicate-check", "/message-deliveries/sms/duplicate-check", duplicateCheck],
] as const)("%s proxy", (_name, path, handler) => {
  it.each([undefined, "", "header-key"])("preserves full body, query and header presence/value (%p)", async (key) => {
    const data = { outcome: "deferred", items: [{ status: "deferred" }] };
    mockPost.mockResolvedValue({ status: 202, data });
    const query = "?expectedBranchId=branch-a&other=value&other=second";
    const response = await handler(request(`${path}${query}`, payload, key));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(data);
    expect(mockPost).toHaveBeenCalledWith(`${path}${query}`, payload, { headers: {
      Authorization: "Bearer token-1", ...(key === undefined ? {} : { "Idempotency-Key": key }),
    } });
    // When both keys exist, preserve both. Backend owns body-key precedence.
    expect(mockPost.mock.calls[0][1].idempotencyKey).toBe("body-key");
  });

  it("preserves a sanitized upstream 409 without fabricating success", async () => {
    mockPost.mockRejectedValue({ response: { status: 409, data: {
      code: "BRANCH_CONTEXT_CHANGED", message: "internal branch details", secret: "do-not-forward",
    } } });
    const response = await handler(request(`${path}?expectedBranchId=branch-a`));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("BRANCH_CONTEXT_CHANGED");
    expect(JSON.stringify(body)).not.toContain("internal branch details");
    expect(JSON.stringify(body)).not.toContain("do-not-forward");
  });

  it("requires authentication before forwarding", async () => {
    const response = await handler(request(path, payload, undefined, false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([{ receiver: "", message: "body" }, { receiver: "01012345678", message: "" }])("rejects invalid required fields", async (body) => {
    const response = await handler(request(path, body));
    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("sanitizes transport errors", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockPost.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.9:443"));
    try {
      const response = await handler(request(path));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("10.0.0.9");
    } finally { consoleSpy.mockRestore(); }
  });
});
