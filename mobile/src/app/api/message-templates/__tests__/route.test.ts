/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listMessageTemplates, POST as createMessageTemplate } from "../route";
import {
  DELETE as deleteMessageTemplate,
  PATCH as updateMessageTemplate,
} from "../[id]/route";

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

describe("message-template API routes", () => {
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

  it("preserves backend status and payload when listing message templates", async () => {
    mockGet.mockResolvedValue({
      status: 409,
      data: { error: "message template conflict" },
    });

    const response = await listMessageTemplates(createRequest("/api/message-templates"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "message template conflict" });
  });

  it("preserves backend status and payload when creating message templates", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createMessageTemplate(
      createRequest("/api/message-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Reminder" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createMessageTemplate(
      createRequest("/api/message-templates", {
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

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateMessageTemplate(
      createRequest("/api/message-templates/24", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ id: "24" }) },
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

    const response = await deleteMessageTemplate(
      createRequest("/api/message-templates/24", { method: "DELETE" }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });
});
