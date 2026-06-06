/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listTemplates, POST as createTemplate } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

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

describe("alimtalk-template API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validTemplatePayload = {
    name: "신규 환영",
    tplType: "BA",
    tplEmType: "NONE",
    content: "안녕하세요 {{name}}님",
    buttons: [],
  };

  describe("auth rejection", () => {
    const noAuth = { headers: { cookie: "" } };

    it("rejects template GET without an auth cookie before proxying", async () => {
      const response = await listTemplates(createRequest("/api/alimtalk-templates", noAuth));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects template POST without an auth cookie before proxying", async () => {
      const response = await createTemplate(
        createRequest("/api/alimtalk-templates", { method: "POST", headers: { cookie: "" } }),
      );
      expect(response.status).toBe(401);
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it("forwards the validated payload to the backend when creating templates", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createTemplate(
      createRequest("/api/alimtalk-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTemplatePayload),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/alimtalk-templates",
      validTemplatePayload,
      expect.anything(),
    );
  });

  it("rejects a create body with an invalid tplType before proxying", async () => {
    const response = await createTemplate(
      createRequest("/api/alimtalk-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validTemplatePayload, tplType: "ZZ" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects a create body missing required fields before proxying", async () => {
    const response = await createTemplate(
      createRequest("/api/alimtalk-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "신규 환영" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
