/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { PUT as updateTriggerDispatch } from "../trigger-dispatch/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    put: jest.fn(),
  },
}));

const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): NextRequest {
  const hasBody = init.body !== undefined;
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      ...(init.cookie === undefined ? { cookie: "auth_token=auth-token" } : { cookie: init.cookie }),
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
}

describe("trigger-dispatch policy activation proxy", () => {
  beforeEach(() => {
    mockPut.mockReset();
  });

  it("requires authentication before proxying", async () => {
    const response = await updateTriggerDispatch(
      createRequest("/api/settings/message-policy-activations/trigger-dispatch", {
        method: "PUT",
        cookie: "",
        body: { enabled: true },
      }),
    );

    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("forwards the literal enabled body and authentication header", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { policyId: "trigger-dispatch", enabled: false },
    });

    const response = await updateTriggerDispatch(
      createRequest("/api/settings/message-policy-activations/trigger-dispatch", {
        method: "PUT",
        body: { enabled: false },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ policyId: "trigger-dispatch", enabled: false });
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/message-policy-activations/trigger-dispatch",
      { enabled: false },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects malformed bodies before proxying", async () => {
    const response = await updateTriggerDispatch(
      createRequest("/api/settings/message-policy-activations/trigger-dispatch", {
        method: "PUT",
        body: { enabled: "true" },
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("preserves an upstream failure status with a sanitized error", async () => {
    mockPut.mockRejectedValue({
      response: {
        status: 409,
        data: { message: "branch secret and operator@example.com" },
      },
    });

    const response = await updateTriggerDispatch(
      createRequest("/api/settings/message-policy-activations/trigger-dispatch", {
        method: "PUT",
        body: { enabled: true },
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: "Failed to update message trigger dispatch activation",
      code: "UPSTREAM_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("operator@example.com");
  });
});
