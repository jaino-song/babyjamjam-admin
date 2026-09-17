/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(email: string | null = "user@example.com") {
  const url = email
    ? `http://localhost/api/auth/check-email?email=${encodeURIComponent(email)}`
    : "http://localhost/api/auth/check-email";
  return new NextRequest(url);
}

describe("GET /api/auth/check-email", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("forwards the existence answer on success", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { exists: true } });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exists: true });
    expect(mockGet).toHaveBeenCalledWith("/auth/check-email", {
      params: { email: "user@example.com" },
    });
  });

  it("converts an upstream failure instead of answering exists:false (no false negative)", async () => {
    mockGet.mockRejectedValue(
      new AxiosError("Internal Server Error", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: {} as never,
        data: { message: "db down" },
      }),
    );

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    // The pre-conversion catch could have fallen through to a false
    // "email does not exist" answer; the conversion must never do that.
    expect(body).not.toEqual({ exists: false });
    expect(body).not.toHaveProperty("exists");
    expect(body.error).toMatch(/[가-힣]/);
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
