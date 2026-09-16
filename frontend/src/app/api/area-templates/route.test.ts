/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/area-templates", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("rejects an unauthenticated read with a registered 401 problem body", async () => {
    const response = await GET(new NextRequest("http://localhost/api/area-templates"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("keeps the shared error contract for upstream failures", async () => {
    mockGet.mockRejectedValue(new Error("upstream socket closed"));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(
      new NextRequest("http://localhost/api/area-templates", {
        headers: { cookie: "auth_token=auth-token" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain("upstream socket closed");
    consoleErrorSpy.mockRestore();
  });
});
