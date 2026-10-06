/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { DELETE } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const context = { params: Promise.resolve({ branchId: "branch-1", id: "ovr-1" }) };

function request(withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/branches/branch-1/holidays/overrides/ovr-1", {
    method: "DELETE",
    headers: withCookie ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("DELETE /api/branches/[branchId]/holidays/overrides/[id]", () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it("rejects an unauthenticated delete without calling the backend", async () => {
    const response = await DELETE(request(false), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the override on the backend with the auth header", async () => {
    mockDelete.mockResolvedValue({ status: 200, data: { success: true } });

    const response = await DELETE(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith(
      "/branches/branch-1/holidays/overrides/ovr-1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("auth-token") }),
      }),
    );
  });

  it("passes a backend problem+json status and code through", async () => {
    const problem = createProblemDetails({
      code: "HOLIDAY_DATE_IN_PAST",
      requestId: "req-holiday-3",
      outcome: "NOT_APPLIED",
      recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    mockDelete.mockRejectedValue({ response: { status: 409, data: problem } });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "HOLIDAY_DATE_IN_PAST", status: 409 });
    consoleErrorSpy.mockRestore();
  });
});
