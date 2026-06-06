/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  DELETE as deleteEmployee,
  GET as listEmployees,
  PATCH as updateEmployee,
  POST as createEmployee,
} from "../route";
import { GET as checkEmployeePhone } from "../check-phone/route";

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

describe("employee API routes", () => {
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

  it("preserves backend error status and sanitizes payload when listing employees", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "employee access denied" },
      },
    });

    const response = await listEmployees(createRequest("/api/employees"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch employees" });
  });

  const validCreatePayload = {
    name: "Kim",
    workArea: ["서울"],
    phone: "01000000000",
    grade: "스탠다드",
    openToNextWork: true,
  };

  it("preserves backend status and payload when creating employees", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreatePayload),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/employees",
      validCreatePayload,
      expect.anything(),
    );
  });

  it("rejects a create body missing required fields before proxying", async () => {
    const response = await createEmployee(
      createRequest("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Kim" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards a valid partial update body to the backend", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: 10, name: "Lee" },
    });

    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lee" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 10, name: "Lee" });
    expect(mockPatch).toHaveBeenCalledWith(
      "/employees",
      { name: "Lee" },
      { params: { id: "10" }, headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects an update body with a mistyped field before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createEmployee(
      createRequest("/api/employees", {
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

  it("rejects invalid update IDs before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lee" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateEmployee(
      createRequest("/api/employees?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects invalid delete IDs before proxying", async () => {
    const response = await deleteEmployee(
      createRequest("/api/employees?id=0", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("preserves backend empty delete responses", async () => {
    mockDelete.mockResolvedValue({
      status: 204,
      data: null,
    });

    const response = await deleteEmployee(
      createRequest("/api/employees?id=10", { method: "DELETE" }),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  describe("auth rejection", () => {
    it("rejects check-phone without auth_token", async () => {
      const request = new NextRequest("http://localhost/api/employees/check-phone?phone=01000000000");
      const response = await checkEmployeePhone(request);
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
