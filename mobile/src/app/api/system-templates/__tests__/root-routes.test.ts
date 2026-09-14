/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listSystemTemplates } from "../route";
import { GET as getSystemTemplate, PUT as updateSystemTemplate } from "../[key]/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
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

describe("system-template root API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function noCookieRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  const keyParams = { params: Promise.resolve({ key: "GREETING" }) };

  it("requires auth before listing system templates", async () => {
    const response = await listSystemTemplates(noCookieRequest("/api/system-templates"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before fetching a system template", async () => {
    const response = await getSystemTemplate(noCookieRequest("/api/system-templates/GREETING"), keyParams);
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before updating a system template", async () => {
    const response = await updateSystemTemplate(noCookieRequest("/api/system-templates/GREETING", "PUT"), keyParams);
    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("preserves backend status and payload when listing system templates", async () => {
    mockGet.mockResolvedValue({
      status: 403,
      data: { error: "system template access denied" },
    });

    const response = await listSystemTemplates(createRequest("/api/system-templates"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "system template access denied" });
  });

  it("preserves backend status and payload when fetching a system template", async () => {
    mockGet.mockResolvedValue({
      status: 404,
      data: { error: "template not found" },
    });

    const response = await getSystemTemplate(
      createRequest("/api/system-templates/GREETING"),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch system template",
      code: "UPSTREAM_ERROR",
    });
  });

  it("forwards a validated template update to the backend path", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { key: "GREETING", content: "Hello" },
    });

    const response = await updateSystemTemplate(
      createRequest("/api/system-templates/GREETING", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      }),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ key: "GREETING", content: "Hello" });
    expect(mockPut).toHaveBeenCalledWith(
      "/system-templates/GREETING",
      { content: "Hello" },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects an update body missing content before proxying", async () => {
    const response = await updateSystemTemplate(
      createRequest("/api/system-templates/GREETING", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customVariables: [] }),
      }),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateSystemTemplate(
      createRequest("/api/system-templates/GREETING", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPut).not.toHaveBeenCalled();
  });
});
