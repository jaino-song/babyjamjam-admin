/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { PATCH as confirmBooking } from "../[id]/confirm-booking/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    patch: jest.fn(),
  },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(path: string, init: { body?: BodyInit; headers?: Record<string, string>; auth?: boolean } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    headers: {
      ...(init.auth === false ? {} : { cookie: "auth_token=auth-token" }),
      ...init.headers,
    },
    body: init.body,
  });
}

describe("PATCH /api/clients/[id]/confirm-booking", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPatch.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("forwards the confirmation to the backend with the caller's token and returns the client", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: 12, serviceStatus: "waiting", bookingConfirmedAt: "2026-10-13T00:00:00.000Z" },
    });

    const response = await confirmBooking(
      createRequest("/api/clients/12/confirm-booking", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 12,
      serviceStatus: "waiting",
      bookingConfirmedAt: "2026-10-13T00:00:00.000Z",
    });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith(
      "/clients/12/confirm-booking",
      {},
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
      }),
    );
  });

  it("rejects a request without auth_token before reaching the backend", async () => {
    const response = await confirmBooking(
      createRequest("/api/clients/12/confirm-booking", { auth: false }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects a client id that is not a positive integer", async () => {
    const response = await confirmBooking(
      createRequest("/api/clients/abc/confirm-booking", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "abc" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before proxying", async () => {
    const response = await confirmBooking(
      createRequest("/api/clients/12/confirm-booking", {
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("passes a backend refusal through with its status instead of reporting success", async () => {
    mockPatch.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: "VALIDATION_FAILED",
          status: 400,
          errors: [{ pointer: "/startDate", detail: "서비스 시작일과 종료일을 먼저 입력해 주세요." }],
        },
      },
    });

    const response = await confirmBooking(
      createRequest("/api/clients/12/confirm-booking", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "12" }) },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(600);
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
