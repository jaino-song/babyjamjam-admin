/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getVoucherPriceInfosByType } from "../type/route";
import { GET as getVoucherPriceYears } from "../years/route";
import { POST as bulkUpdateVoucherPrices } from "../bulk-update/route";

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockJwtDecode = jwtDecode as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("voucher price info API routes", () => {
  beforeEach(() => {
    mockJwtDecode.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("preserves backend status and payload when fetching voucher price infos by type", async () => {
    mockGet.mockResolvedValue({
      status: 409,
      data: { error: "voucher type conflict" },
    });

    const response = await getVoucherPriceInfosByType(
      createRequest("/api/voucher-price-infos/type?type=income&year=2026"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "voucher type conflict" });
  });

  it("preserves backend status and payload when fetching voucher price years", async () => {
    mockGet.mockResolvedValue({
      status: 503,
      data: { error: "years unavailable" },
    });

    const response = await getVoucherPriceYears(createRequest("/api/voucher-price-infos/years"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "years unavailable" });
  });

  it("rejects malformed bulk update JSON before proxying", async () => {
    mockJwtDecode.mockReturnValue({ role: "owner" });

    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
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
});
