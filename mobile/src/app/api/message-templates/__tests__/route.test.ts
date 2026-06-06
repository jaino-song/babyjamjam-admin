/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listMessageTemplates, POST as createMessageTemplate } from "../route";
import {
  DELETE as deleteMessageTemplate,
  GET as getMessageTemplate,
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

  function noCookieRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  const idParams = { params: Promise.resolve({ id: "24" }) };

  it("requires auth before listing message templates", async () => {
    const response = await listMessageTemplates(noCookieRequest("/api/message-templates"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before creating message templates", async () => {
    const response = await createMessageTemplate(noCookieRequest("/api/message-templates", "POST"));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("requires auth before fetching a single message template", async () => {
    const response = await getMessageTemplate(noCookieRequest("/api/message-templates/24"), idParams);
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before updating a message template", async () => {
    const response = await updateMessageTemplate(noCookieRequest("/api/message-templates/24", "PATCH"), idParams);
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("requires auth before deleting a message template", async () => {
    const response = await deleteMessageTemplate(noCookieRequest("/api/message-templates/24", "DELETE"), idParams);
    expect(response.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
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

  const validTemplatePayload = {
    name: "Reminder",
    content: "안녕하세요 {{name}}",
    variables: [],
  };

  it("forwards the validated payload to the backend when creating message templates", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createMessageTemplate(
      createRequest("/api/message-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTemplatePayload),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-templates",
      validTemplatePayload,
      expect.anything(),
    );
  });

  it("rejects a create body missing required fields before proxying", async () => {
    const response = await createMessageTemplate(
      createRequest("/api/message-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Reminder" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
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

  it("forwards the validated payload to the backend when updating", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: "24" },
    });

    const response = await updateMessageTemplate(
      createRequest("/api/message-templates/24", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(response.status).toBe(200);
    expect(mockPatch).toHaveBeenCalledWith(
      "/message-templates/24",
      { name: "Updated" },
      expect.anything(),
    );
  });

  it("rejects an update body with a wrong-typed field before proxying", async () => {
    const response = await updateMessageTemplate(
      createRequest("/api/message-templates/24", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects unsafe message template IDs before proxying", async () => {
    const response = await updateMessageTemplate(
      createRequest("/api/message-templates/bad%2Fid", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      }),
      { params: Promise.resolve({ id: "bad/id" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid message template id",
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
