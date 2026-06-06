/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getClients, POST as createClient } from "../route";
import { GET as getClient } from "../[id]/route";
import { PATCH as requestReplacement } from "../[id]/request-replacement/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));

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

describe("client API routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPost.mockReset();
  });

  it("preserves backend status and payload when listing clients", async () => {
    mockGet.mockResolvedValue({
      status: 403,
      data: { error: "branch access denied" },
    });

    const response = await getClients(createRequest("/api/clients?page=2&limit=10"));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ error: "branch access denied" });
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createClient(
      createRequest("/api/clients", {
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

  it("rejects create bodies missing required fields before proxying", async () => {
    const response = await createClient(
      createRequest("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // missing the required booleans careCenter/voucherClient/breastPump
        body: JSON.stringify({ name: "Baby Kim" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the validated create body to the backend", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { id: 7 } });

    const payload = {
      name: "Baby Kim",
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      primaryEmployeeId: 12,
    };

    const response = await createClient(
      createRequest("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 7 });
    expect(mockPost).toHaveBeenCalledWith("/clients", payload, expect.any(Object));
  });

  it("rejects invalid client detail IDs before proxying", async () => {
    const response = await getClient(
      createRequest("/api/clients/not-a-number"),
      { params: Promise.resolve({ id: "not-a-number" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid client id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects malformed request-replacement JSON before proxying", async () => {
    const response = await requestReplacement(
      createRequest("/api/clients/12/request-replacement", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
