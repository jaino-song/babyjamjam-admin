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

const mockGet = serverAPIClient.get as jest.Mock;

describe("out-of-pocket price info API route", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("requires authentication", async () => {
    const response = await GET(new NextRequest("http://localhost/api/out-of-pocket-price-infos"));

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("proxies the DB price list with the auth token", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: [{ id: 1, duration: 5, fullPrice: "815000" }],
    });
    const request = new NextRequest("http://localhost/api/out-of-pocket-price-infos", {
      headers: { cookie: "auth_token=auth-token" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: 1, duration: 5, fullPrice: "815000" },
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      "/out-of-pocket-price-infos",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
      }),
    );
  });
});
