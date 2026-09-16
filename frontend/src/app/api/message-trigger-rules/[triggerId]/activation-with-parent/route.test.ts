/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { PUT as activateWithParent } from "./route";

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

describe("message trigger activation-with-parent proxy", () => {
  beforeEach(() => {
    mockPut.mockReset();
  });

  it("requires authentication before proxying", async () => {
    const response = await activateWithParent(
      createRequest("/api/message-trigger-rules/rule-1/activation-with-parent", {
        method: "PUT",
        cookie: "",
        body: { isActive: true, enableParent: true },
      }),
      { params: Promise.resolve({ triggerId: "rule-1" }) },
    );

    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("forwards both required literals and encodes the trigger id", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { id: "system:rule-1", isActive: true },
    });

    const response = await activateWithParent(
      createRequest("/api/message-trigger-rules/system:rule-1/activation-with-parent", {
        method: "PUT",
        body: { isActive: true, enableParent: true },
      }),
      { params: Promise.resolve({ triggerId: "system:rule-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith(
      "/message-trigger-rules/system%3Arule-1/activation-with-parent",
      { isActive: true, enableParent: true },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it.each([
    { isActive: false, enableParent: true },
    { isActive: true, enableParent: false },
    { isActive: true, enableParent: true, extra: "reject" },
  ])("rejects a non-literal aggregate body before proxying", async (body) => {
    const response = await activateWithParent(
      createRequest("/api/message-trigger-rules/rule-1/activation-with-parent", {
        method: "PUT",
        body,
      }),
      { params: Promise.resolve({ triggerId: "rule-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("preserves an upstream conflict status with a sanitized error", async () => {
    mockPut.mockRejectedValue({
      response: {
        status: 409,
        data: { message: "internal branch id and Bearer secret" },
      },
    });

    const response = await activateWithParent(
      createRequest("/api/message-trigger-rules/rule-1/activation-with-parent", {
        method: "PUT",
        body: { isActive: true, enableParent: true },
      }),
      { params: Promise.resolve({ triggerId: "rule-1" }) },
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: "Failed to activate message trigger rule with parent",
      code: "UPSTREAM_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("Bearer secret");
  });

  it("preserves the stable parent-disabled code for a parent-off race", async () => {
    mockPut.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
          message: "internal branch details",
        },
      },
    });

    const response = await activateWithParent(
      createRequest("/api/message-trigger-rules/rule-1/activation-with-parent", {
        method: "PUT",
        body: { isActive: true, enableParent: true },
      }),
      { params: Promise.resolve({ triggerId: "rule-1" }) },
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: "Failed to activate message trigger rule with parent",
      code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
    });
    expect(JSON.stringify(body)).not.toContain("internal branch details");
  });
});
