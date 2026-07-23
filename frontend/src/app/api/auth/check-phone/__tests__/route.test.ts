/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;

function createRequest(phone: string): NextRequest {
  return new NextRequest(`http://localhost/api/auth/check-phone?phone=${phone}`);
}

describe("GET /api/auth/check-phone", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockServerGet.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("proxies a normalized phone to the public auth duplicate check", async () => {
    mockServerGet.mockResolvedValue({ data: { exists: true }, status: 200 });

    const response = await GET(createRequest("010-6621-1878"));

    expect(mockServerGet).toHaveBeenCalledWith("/auth/check-phone", {
      params: { phone: "01066211878" },
    });
    await expect(response.json()).resolves.toEqual({ exists: true });
    expect(response.status).toBe(200);
  });

  it("returns an error when the backend lookup fails", async () => {
    mockServerGet.mockRejectedValue(new Error("backend unavailable"));

    const response = await GET(createRequest("01066211878"));

    await expect(response.json()).resolves.toEqual({ error: "전화번호 중복 확인에 실패했습니다." });
    expect(response.status).toBe(503);
  });
});
