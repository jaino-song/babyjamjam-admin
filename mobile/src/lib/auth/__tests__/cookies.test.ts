/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { AuthServiceUnavailableError, getCurrentUser, getOptionalCurrentUser } from "../cookies";

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

function createAxiosError(status = 500): AxiosError {
  return new AxiosError(
    "request failed against https://internal-api.local",
    "ERR_BAD_RESPONSE",
    { url: "/auth/me", baseURL: "https://internal-api.local" } as never,
    undefined,
    {
      status,
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

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("https://internal-api.local");
    expect(logged).not.toContain("/auth/me");
    expect(logged).not.toContain("auth.internal");
  });
  it("returns null without calling the backend when there is no auth_token cookie", async () => {
    mockCookies.mockResolvedValue({ get: jest.fn(() => undefined) });

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each([401, 403])("returns null when /auth/me answers %i (not authenticated)", async (status) => {
    mockGet.mockRejectedValue(createAxiosError(status));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it.each([500, 502, 503, 504])(
    "throws AuthServiceUnavailableError when /auth/me answers %i",
    async (status) => {
      mockGet.mockRejectedValue(createAxiosError(status));

      await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    },
  );

  it("throws AuthServiceUnavailableError when the request times out", async () => {
    mockGet.mockRejectedValue(
      new AxiosError("timeout of 60000ms exceeded", "ECONNABORTED"),
    );

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError when the network request fails", async () => {
    mockGet.mockRejectedValue(new AxiosError("socket hang up", "ECONNRESET"));

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError for a 3xx answer that validateStatus lets through", async () => {
    mockGet.mockResolvedValue({ status: 302, data: "" });

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError when a 200 response body is not a user object", async () => {
    mockGet.mockResolvedValue({ status: 200, data: "<html>gateway</html>" });

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError when a 200 response body is null", async () => {
    mockGet.mockResolvedValue({ status: 200, data: null });

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("propagates an unexpected error thrown by cookies() instead of returning null", async () => {
    const failure = new Error("cookies exploded");
    mockCookies.mockRejectedValue(failure);

    await expect(getCurrentUser()).rejects.toBe(failure);
  });

  it("returns the user when /auth/me answers 200", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { id: "user-1", name: "Kim" } });

    await expect(getCurrentUser()).resolves.toEqual({ id: "user-1", name: "Kim" });
  });

  it("getOptionalCurrentUser behaves like signed out when the backend is unavailable", async () => {
    mockGet.mockRejectedValue(createAxiosError(503));

    await expect(getOptionalCurrentUser()).resolves.toBeNull();
  });
});
