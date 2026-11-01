/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import KakaoOnboardingPage from "./page";

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

jest.mock("@/lib/api/server-base-url", () => ({
  createServerApiUrl: (path: string) => `https://api.test${path}`,
}));

jest.mock("./OnboardingForm", () => ({
  OnboardingForm: () => null,
}));

const mockCookies = cookies as jest.Mock;

function mockCookieStore(values: Record<string, string>) {
  mockCookies.mockResolvedValue({
    get: jest.fn((name: string) =>
      name in values ? { value: values[name] } : undefined,
    ),
  });
}

describe("KakaoOnboardingPage already-signed-in check", () => {
  let fetchMock: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch");
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("treats an unavailable backend as signed out instead of crashing", async () => {
    mockCookieStore({ auth_token: "access-token" });
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    // Signed-out branch: no pending signup cookie -> back to /login.
    await expect(
      KakaoOnboardingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("still sends a signed-in user to the dashboard", async () => {
    mockCookieStore({ auth_token: "access-token" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "user-1" }), { status: 200 }));

    await expect(
      KakaoOnboardingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});
