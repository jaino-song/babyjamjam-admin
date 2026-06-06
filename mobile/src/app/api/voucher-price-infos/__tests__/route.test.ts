/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getVoucherPriceInfosByType } from "../type/route";
import { GET as getVoucherPriceYears } from "../years/route";
import { POST as bulkUpdateVoucherPrices } from "../bulk-update/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
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

  it("rejects bulk update with an empty items array using the items message", async () => {
    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: 2026, items: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "업데이트할 항목이 없습니다",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects bulk update with an out-of-range year using the year message", async () => {
    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: 1999, items: [{ id: 1 }] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "유효한 연도를 입력해주세요 (2000-2100)",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects bulk update with a non-numeric year using the year message", async () => {
    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: 1 }] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "유효한 연도를 입력해주세요 (2000-2100)",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the validated bulk update body to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { updated: [1], created: [], errors: [] } });

    const payload = { year: 2026, items: [{ id: 1 }] };
    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: [1], created: [], errors: [] });
    expect(mockPost).toHaveBeenCalledWith(
      "/voucher-price-infos/bulk-update",
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
      }),
    );
  });

  it("does not return or log raw rejected backend bulk update errors", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: "internal bulk update path /tmp/voucher-prices",
        },
      },
    });

    const response = await bulkUpdateVoucherPrices(
      createRequest("/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: 2026, items: [{ id: 1 }] }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "바우처 가격 정보 업데이트에 실패했습니다",
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/voucher-prices");
  });
});
