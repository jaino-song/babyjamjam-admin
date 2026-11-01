/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthServiceUnavailableError } from "@/lib/auth/cookies";

import ProtectedLayout from "./layout";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

jest.mock("@/lib/api/server-base-url", () => ({
  createServerApiUrl: (path: string) => `https://api.test${path}`,
}));

// The shell pieces are irrelevant to the auth gate and pull in app-wide hooks.
jest.mock("@/components/app/v3/V3MainContent", () => ({ V3MainContent: () => null }));
jest.mock("@/components/app/v3/V3MobileHeader", () => ({ V3MobileHeader: () => null }));
jest.mock("@/components/app/v3/V3Sidebar", () => ({ V3Sidebar: () => null }));
jest.mock("@/components/app/notification-permission-prompt", () => ({ NotificationPermissionPrompt: () => null }));
jest.mock("@/components/app/realtime/RealtimeInvalidation", () => ({ RealtimeInvalidation: () => null }));
jest.mock("@/components/app/root/mobile-bottom-nav", () => ({ MobileBottomNav: () => null }));
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  DocumentJobsProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/providers/UserProvider", () => ({
  UserProvider: ({ children }: { children: unknown }) => children,
}));

const mockCookies = cookies as jest.Mock;
const mockRedirect = redirect as unknown as jest.Mock;

describe("ProtectedLayout auth gate", () => {
  let fetchMock: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRedirect.mockClear();
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === "auth_token" ? { value: "access-token" } : undefined,
      ),
    });
    fetchMock = jest.spyOn(global, "fetch");
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("does not send the user to /login when the backend times out; the error reaches the boundary", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );

    await expect(ProtectedLayout({ children: null })).rejects.toBeInstanceOf(
      AuthServiceUnavailableError,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does not send the user to /login when /auth/me answers 5xx", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    await expect(ProtectedLayout({ children: null })).rejects.toBeInstanceOf(
      AuthServiceUnavailableError,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when /auth/me answers 401", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    await expect(ProtectedLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when there is no auth_token cookie", async () => {
    mockCookies.mockResolvedValue({ get: jest.fn(() => undefined) });

    await expect(ProtectedLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
