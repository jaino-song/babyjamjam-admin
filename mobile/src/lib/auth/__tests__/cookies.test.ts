/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { getCurrentUser } from "../cookies";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

jest.mock("@/lib/e2e", () => ({
  E2E_AUTH_USER: { id: "e2e" },
  isE2ETest: jest.fn(() => false),
}));

const mockCookies = cookies as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;

function createAxiosError(): AxiosError {
  return new AxiosError(
    "request failed against https://internal-api.local",
    "ERR_BAD_RESPONSE",
    { url: "/auth/me", baseURL: "https://internal-api.local" } as never,
    undefined,
    {
      status: 500,
      statusText: "Server Error",
      headers: {},
      config: {} as never,
      data: { diagnostics: { host: "auth.internal" } },
    } as never,
  );
}

describe("getCurrentUser", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => (name === "auth_token" ? { value: "auth-token" } : undefined)),
    });
    mockGet.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("does not log request URLs or backend hosts on Axios failures", async () => {
    mockGet.mockRejectedValue(createAxiosError());

    await expect(getCurrentUser()).resolves.toBeNull();

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("https://internal-api.local");
    expect(logged).not.toContain("/auth/me");
    expect(logged).not.toContain("auth.internal");
  });
});
