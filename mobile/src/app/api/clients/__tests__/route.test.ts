/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getClients, POST as createClient } from "../route";
import { GET as getClient, PATCH as updateClient, DELETE as deleteClient } from "../[id]/route";
import { PATCH as terminateClient } from "../[id]/terminate/route";
import { PATCH as requestReplacement } from "../[id]/request-replacement/route";
import { PATCH as completeReplacement } from "../[id]/complete-replacement/route";
import { GET as checkClientPhone } from "../check-phone/route";

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
const mockDelete = serverAPIClient.delete as jest.Mock;

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

  it("preserves the safe duplicate-client conflict payload", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: "이미 같은 전화번호의 고객이 있습니다.",
          clientId: 73,
          internal: "discarded",
        },
      },
    });

    const response = await createClient(
      createRequest("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Baby Kim",
          careCenter: false,
          voucherClient: true,
          breastPump: false,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "이미 같은 전화번호의 고객이 있습니다.",
      clientId: 73,
    });
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

  it("rejects malformed update-client JSON before proxying", async () => {
    const response = await updateClient(
      createRequest("/api/clients/12", {
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

  it("rejects update-client bodies with wrong field types before proxying", async () => {
    const response = await updateClient(
      createRequest("/api/clients/12", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // careCenter must be a boolean per UpdateClientDto
        body: JSON.stringify({ careCenter: "yes" }),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("forwards the validated update-client body to the backend", async () => {
    mockPatch.mockResolvedValue({ status: 200, data: { id: 12 } });

    const payload = { name: "Baby Lee", careCenter: true, primaryEmployeeId: 3 };

    const response = await updateClient(
      createRequest("/api/clients/12", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 12 });
    expect(mockPatch).toHaveBeenCalledWith("/clients/12", payload, expect.any(Object));
  });

  it("rejects malformed terminate JSON before proxying", async () => {
    const response = await terminateClient(
      createRequest("/api/clients/12/terminate", {
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

  it("rejects terminate bodies with a wrong reason type before proxying", async () => {
    const response = await terminateClient(
      createRequest("/api/clients/12/terminate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // reason must be a string per TerminateServiceDto
        body: JSON.stringify({ reason: 42 }),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("forwards the validated terminate body to the backend", async () => {
    mockPatch.mockResolvedValue({ status: 200, data: { status: "terminated" } });

    const payload = { reason: "client moved" };

    const response = await terminateClient(
      createRequest("/api/clients/12/terminate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "terminated" });
    expect(mockPatch).toHaveBeenCalledWith("/clients/12/terminate", payload, expect.any(Object));
  });

  it("rejects request-replacement bodies missing the required primary employee id", async () => {
    const response = await requestReplacement(
      createRequest("/api/clients/12/request-replacement", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // newPrimaryEmployeeId is @IsInt (required) per RequestReplacementDto
        body: JSON.stringify({ newSecondaryEmployeeId: 5 }),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("forwards the validated request-replacement body to the backend", async () => {
    mockPatch.mockResolvedValue({ status: 200, data: { status: "replacement_requested" } });

    const payload = { newPrimaryEmployeeId: 8, newSecondaryEmployeeId: null };

    const response = await requestReplacement(
      createRequest("/api/clients/12/request-replacement", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "replacement_requested" });
    expect(mockPatch).toHaveBeenCalledWith(
      "/clients/12/request-replacement",
      payload,
      expect.any(Object),
    );
  });

  it("rejects malformed complete-replacement JSON before proxying", async () => {
    const response = await completeReplacement(
      createRequest("/api/clients/12/complete-replacement", {
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

  it("forwards an empty complete-replacement body to the backend", async () => {
    mockPatch.mockResolvedValue({ status: 200, data: { status: "active" } });

    const response = await completeReplacement(
      createRequest("/api/clients/12/complete-replacement", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "active" });
    expect(mockPatch).toHaveBeenCalledWith(
      "/clients/12/complete-replacement",
      {},
      expect.any(Object),
    );
  });
});

describe("client API routes auth rejection", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    mockPost.mockReset();
  });

  function noAuthRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  it("rejects client detail GET without auth_token", async () => {
    const response = await getClient(noAuthRequest("/api/clients/12"), {
      params: Promise.resolve({ id: "12" }),
    });
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects client update without auth_token", async () => {
    const response = await updateClient(noAuthRequest("/api/clients/12", "PATCH"), {
      params: Promise.resolve({ id: "12" }),
    });
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects client delete without auth_token", async () => {
    const response = await deleteClient(noAuthRequest("/api/clients/12", "DELETE"), {
      params: Promise.resolve({ id: "12" }),
    });
    expect(response.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("rejects terminate without auth_token", async () => {
    const response = await terminateClient(noAuthRequest("/api/clients/12/terminate", "PATCH"), {
      params: Promise.resolve({ id: "12" }),
    });
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects request-replacement without auth_token", async () => {
    const response = await requestReplacement(
      noAuthRequest("/api/clients/12/request-replacement", "PATCH"),
      { params: Promise.resolve({ id: "12" }) },
    );
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects complete-replacement without auth_token", async () => {
    const response = await completeReplacement(
      noAuthRequest("/api/clients/12/complete-replacement", "PATCH"),
      { params: Promise.resolve({ id: "12" }) },
    );
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects check-phone without auth_token", async () => {
    const response = await checkClientPhone(noAuthRequest("/api/clients/check-phone?phone=01000000000"));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
