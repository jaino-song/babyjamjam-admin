/**
 * @jest-environment node
 */
import { AxiosError } from "axios";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAPIClient } from "@/lib/api/server";
import { AuthServiceUnavailableError } from "@/lib/auth/cookies";

import DashboardLayout from "./layout";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: { get: jest.fn() },
}));

jest.mock("@/lib/e2e", () => ({
  E2E_ROLE_COOKIE: "e2e_role",
  getE2EAuthUser: jest.fn(),
  isE2ETest: jest.fn(() => false),
}));

const mockCookies = cookies as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockRedirect = redirect as unknown as jest.Mock;

function axiosErrorWithStatus(status: number): AxiosError {
  return new AxiosError("request failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: {} as never,
    data: {},
  } as never);
}

describe("mobile DashboardLayout auth gate", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRedirect.mockClear();
    mockGet.mockReset();
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === "auth_token" ? { value: "access-token" } : undefined,
      ),
    });
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("does not send the user to /login when the backend times out; the error reaches the boundary", async () => {
    mockGet.mockRejectedValue(new AxiosError("timeout of 60000ms exceeded", "ECONNABORTED"));

    await expect(DashboardLayout({ children: null })).rejects.toBeInstanceOf(
      AuthServiceUnavailableError,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does not send the user to /login when /auth/me answers 5xx", async () => {
    mockGet.mockRejectedValue(axiosErrorWithStatus(503));

    await expect(DashboardLayout({ children: null })).rejects.toBeInstanceOf(
      AuthServiceUnavailableError,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when /auth/me answers 401", async () => {
    mockGet.mockRejectedValue(axiosErrorWithStatus(401));

    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
