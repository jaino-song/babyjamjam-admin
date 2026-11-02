/**
 * @jest-environment node
 */
import { AxiosError } from "axios";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { PwaDashboardRedirect } from "@/components/app/root/pwa-dashboard-redirect";

import Home from "./page";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: { get: jest.fn() },
}));

jest.mock("@/lib/e2e", () => ({
  E2E_ROLE_COOKIE: "e2e_role",
  getE2EAuthUser: jest.fn(),
  isE2ETest: jest.fn(() => false),
}));

jest.mock("@/app/actions/locale", () => ({
  getLocale: jest.fn().mockResolvedValue("ko"),
}));

jest.mock("@/components/app/root/pwa-dashboard-redirect", () => ({
  PwaDashboardRedirect: () => null,
}));

const mockCookies = cookies as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;

describe("mobile home page already-signed-in check", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
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

  it("renders the signed-out landing page instead of crashing when the backend is unavailable", async () => {
    mockGet.mockRejectedValue(new AxiosError("timeout of 60000ms exceeded", "ECONNABORTED"));

    const page = await Home();

    expect(page.type).not.toBe(PwaDashboardRedirect);
    expect(page.props["data-component"]).toBe("mobile_home_page");
  });

  it("redirects a signed-in user to the dashboard", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { id: "user-1" } });

    const page = await Home();

    expect(page.type).toBe(PwaDashboardRedirect);
  });
});
