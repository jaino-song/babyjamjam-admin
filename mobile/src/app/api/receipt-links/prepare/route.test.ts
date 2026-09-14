/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown = { clientId: 7 }, authenticated = true) {
  return new NextRequest("http://localhost/api/receipt-links/prepare", {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    body: JSON.stringify(body),
  });
}

describe("POST /api/receipt-links/prepare", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("forwards the authenticated client selection and returns the prepared payload", async () => {
    const prepared = {
      clientId: 7,
      clientName: "김산모",
      recipientPhone: "01012345678",
      documentId: "doc-1",
      receiptUrl: "https://m.admin.babyjamjam.com/receipt/efr_abc",
      expiresAt: "2026-09-24T00:00:00.000Z",
    };
    mockPost.mockResolvedValue({ status: 200, data: prepared });

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(prepared);
    expect(mockPost).toHaveBeenCalledWith(
      "/receipt-links/prepare",
      { clientId: 7 },
      { headers: { Authorization: "Bearer token-1" } },
    );
  });

  it("rejects an invalid client selection before forwarding", async () => {
    const response = await POST(createRequest({ clientId: 0 }));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before forwarding", async () => {
    const response = await POST(createRequest({ clientId: 7 }, false));

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("passes a known business rejection through untouched", async () => {
    mockPost.mockRejectedValue(
      new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" },
      }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      reason: "not_voucher_client",
      message: "바우처 이용 산모가 아닙니다",
    });
  });
});
