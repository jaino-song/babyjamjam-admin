/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { PATCH as updateOpenStatus } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    patch: jest.fn(),
  },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

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

describe("employee open-status API route", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPatch.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("forwards the validated open-status update to the backend", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: 10, openToNextWork: true },
    });

    const response = await updateOpenStatus(
      createRequest("/api/employees/open-status?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openToNextWork: true }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 10, openToNextWork: true });
    expect(mockPatch).toHaveBeenCalledWith(
      "/employees/open-status",
      { openToNextWork: true },
      { params: { id: "10" }, headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("requires an employee id before proxying", async () => {
    const response = await updateOpenStatus(
      createRequest("/api/employees/open-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openToNextWork: true }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Employee ID is required" });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects a body missing openToNextWork before proxying", async () => {
    const response = await updateOpenStatus(
      createRequest("/api/employees/open-status?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean openToNextWork before proxying", async () => {
    const response = await updateOpenStatus(
      createRequest("/api/employees/open-status?id=10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openToNextWork: "yes" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before proxying", async () => {
    const response = await updateOpenStatus(
      createRequest("/api/employees/open-status?id=10", {
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
});
