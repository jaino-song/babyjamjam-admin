/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getPolicies } from "./route";
import { PUT as updateConfig } from "./auto-finalize/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): NextRequest {
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

describe("contract automation settings proxy routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  it("requires authentication before fetching contract automation policies", async () => {
    const response = await getPolicies(createRequest("/api/settings/contract-automation-policies", { cookie: "" }));

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("forwards authenticated policy reads and preserves the backend response", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: { autoFinalize: { enabled: true, graceDays: 7, maxAttempts: 3 } },
    });

    const response = await getPolicies(createRequest("/api/settings/contract-automation-policies"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      autoFinalize: { enabled: true, graceDays: 7, maxAttempts: 3 },
    });
    expect(mockGet).toHaveBeenCalledWith("/settings/contract-automation-policies", {
      headers: { Authorization: "Bearer auth-token" },
    });
  });

  it("preserves an upstream policy read failure status with a sanitized error", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 503,
        data: { message: "database host and Bearer upstream-secret" },
      },
    });

    const response = await getPolicies(createRequest("/api/settings/contract-automation-policies"));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "서버가 현재 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(JSON.stringify(body)).not.toContain("upstream-secret");
  });

  it("requires authentication before updating auto-finalize settings", async () => {
    const response = await updateConfig(createRequest(
      "/api/settings/contract-automation-policies/auto-finalize",
      { method: "PUT", cookie: "", body: { enabled: true, graceDays: 7, maxAttempts: 3 } },
    ));

    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("forwards the authenticated auto-finalize update body", async () => {
    const config = { enabled: false, graceDays: 14, maxAttempts: 5 };
    mockPut.mockResolvedValue({ status: 200, data: config });

    const response = await updateConfig(createRequest(
      "/api/settings/contract-automation-policies/auto-finalize",
      { method: "PUT", body: config },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(config);
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/contract-automation-policies/auto-finalize",
      config,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("preserves an upstream auto-finalize update failure status", async () => {
    mockPut.mockRejectedValue({
      response: {
        status: 403,
        data: { message: "operator@example.com cannot update this setting" },
      },
    });

    const response = await updateConfig(createRequest(
      "/api/settings/contract-automation-policies/auto-finalize",
      { method: "PUT", body: { enabled: true, graceDays: 0, maxAttempts: 1 } },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "이 작업을 할 권한이 없어요.",
    });
  });
});
