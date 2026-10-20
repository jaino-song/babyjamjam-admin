/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

const JOB_UUID = "8f14e45f-ceea-467a-9575-7b1a6f2f6c11";

function createRequest(id: string, authenticated = true): NextRequest {
  return new NextRequest(`http://localhost/api/message-trigger-jobs/${id}/resend`, {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("POST /api/message-trigger-jobs/[id]/resend", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires authentication before proxying", async () => {
    const response = await POST(createRequest(JOB_UUID, false), {
      params: Promise.resolve({ id: JOB_UUID }),
    });

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([`job:${JOB_UUID}`, "log:41"])(
    "rejects the prefixed row id %s before proxying",
    async (id) => {
      // History rows carry `job:<uuid>`; the colon fails the id charset, so only
      // the bare trigger-job uuid may reach this endpoint.
      const response = await POST(createRequest(id), {
        params: Promise.resolve({ id }),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        code: "VALIDATION_FAILED",
        status: 400,
        outcome: "NOT_APPLIED",
        error: "Invalid message trigger job id",
      }));
      expect(mockPost).not.toHaveBeenCalled();
    },
  );

  it("forwards an authenticated resend request for a valid job id", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { id: JOB_UUID, status: "needs_setup", reason: "연락처가 연결되지 않았어요." },
    });

    const response = await POST(createRequest(JOB_UUID), {
      params: Promise.resolve({ id: JOB_UUID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: JOB_UUID,
      status: "needs_setup",
      reason: "연락처가 연결되지 않았어요.",
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/message-trigger-jobs/${JOB_UUID}/resend`,
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("keeps the 409 status when the job is not resendable and omits diagnostics", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message: "추가 정보 필요 상태가 아니에요.",
          diagnostics: { authorization: "Bearer upstream-secret" },
        },
      },
    });

    const response = await POST(createRequest(JOB_UUID), {
      params: Promise.resolve({ id: JOB_UUID }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("upstream-secret");
  });
});
