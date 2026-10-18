/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { AxiosError, AxiosHeaders } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    patch: jest.fn(),
  },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(body: object, authenticated = true): NextRequest {
  return new NextRequest("http://localhost/api/users/approved-user/sms-automation", {
    method: "PATCH",
    headers: {
      ...(authenticated ? { cookie: "auth_token=access-token" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/users/[id]/sms-automation", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("forwards the authenticated toggle to the backend", async () => {
    mockPatch.mockResolvedValue({ data: { id: "approved-user", smsAutomationEnabled: false }, status: 200 });

    const response = await PATCH(createRequest({ enabled: false }), {
      params: Promise.resolve({ id: "approved-user" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "approved-user", smsAutomationEnabled: false });
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/approved-user/sms-automation",
      { enabled: false },
      { headers: { Authorization: "Bearer access-token" } },
    );
  });

  it("rejects an unauthenticated request without contacting the backend", async () => {
    const response = await PATCH(createRequest({ enabled: true }, false), {
      params: Promise.resolve({ id: "approved-user" }),
    });

    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("encodes the dynamic user id before forwarding it upstream", async () => {
    mockPatch.mockResolvedValue({ data: {}, status: 200 });

    await PATCH(createRequest({ enabled: true }), {
      params: Promise.resolve({ id: "user id/with?reserved" }),
    });

    expect(mockPatch).toHaveBeenCalledWith(
      "/users/user%20id%2Fwith%3Freserved/sms-automation",
      { enabled: true },
      { headers: { Authorization: "Bearer access-token" } },
    );
  });

  it("passes an upstream failure status through", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockPatch.mockRejectedValue(
      new AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 403,
        statusText: "Forbidden",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: "권한이 없어요." },
      }),
    );

    const response = await PATCH(createRequest({ enabled: true }), {
      params: Promise.resolve({ id: "approved-user" }),
    });

    expect(response.status).toBe(403);
    consoleError.mockRestore();
  });
});
