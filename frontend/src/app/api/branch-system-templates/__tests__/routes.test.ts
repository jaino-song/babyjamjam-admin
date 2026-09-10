/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getTemplates } from "../route";
import { GET as getTemplate, PUT as updateTemplate } from "../[key]/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      cookie: "auth_token=token-1",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("branch system-template proxy routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  it("requires authentication before fetching the branch catalog", async () => {
    const response = await getTemplates(
      new NextRequest("http://localhost/api/branch-system-templates"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required. Please log in.",
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("forwards the captured branch identity for catalog reads", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: [{ templateKey: "GREETING", content: "안녕하세요" }],
    });

    const response = await getTemplates(
      createRequest("/api/branch-system-templates?expectedBranchId=branch-a"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { templateKey: "GREETING", content: "안녕하세요" },
    ]);
    expect(mockGet).toHaveBeenCalledWith("/branch-system-templates", {
      headers: { Authorization: "Bearer token-1" },
      params: { expectedBranchId: "branch-a" },
    });
  });

  it("preserves an upstream 403 message instead of flattening it to 500", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { message: "Branch selection required" },
      },
    });

    const response = await getTemplate(
      createRequest("/api/branch-system-templates/GREETING?expectedBranchId=branch-a"),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Branch selection required" });
  });

  it("forwards the captured branch identity and body for updates", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { templateKey: "GREETING", content: "변경된 인사" },
    });

    const response = await updateTemplate(
      createRequest(
        "/api/branch-system-templates/GREETING?expectedBranchId=branch-a",
        "PUT",
        { content: "변경된 인사", customVariables: [] },
      ),
      { params: Promise.resolve({ key: "GREETING" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templateKey: "GREETING",
      content: "변경된 인사",
    });
    expect(mockPut).toHaveBeenCalledWith(
      "/branch-system-templates/GREETING",
      { content: "변경된 인사", customVariables: [] },
      {
        headers: { Authorization: "Bearer token-1" },
        params: { expectedBranchId: "branch-a" },
      },
    );
  });
});
