/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";

import { POST as forgotPassword } from "../forgot-password/route";
import { POST as linkPassword } from "../link-password/route";
import { POST as login } from "../login/route";
import { GET as me } from "../me/route";
import { POST as refresh } from "../refresh/route";
import { POST as register } from "../register/route";
import { POST as resendVerification } from "../resend-verification/route";
import { POST as resetPassword } from "../reset-password/route";
import { POST as verifyEmail } from "../verify-email/route";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockCookies = cookies as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

type Handler = (request: NextRequest) => Promise<Response>;

function createRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body: JSON.stringify({ email: "user@example.com", password: "password", token: "token" }),
  });
}

function createAxiosError(): AxiosError {
  return new AxiosError(
    "auth service returned internal details /tmp/auth-handler",
    "ERR_BAD_RESPONSE",
    { url: "/auth/internal", baseURL: "https://internal-api.local" } as never,
    undefined,
    {
      status: 409,
      statusText: "Conflict",
      headers: {},
      config: {} as never,
      data: {
        error: "internal auth path /tmp/auth-handler",
        message: "database shard auth-primary rejected request",
        code: "EMAIL_EXISTS",
        hasKakaoAccount: true,
        stack: "stack trace",
        diagnostics: { host: "auth-primary.internal" },
      },
    } as never,
  );
}

describe("auth API error sanitization", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCookies.mockResolvedValue({ set: jest.fn(), get: jest.fn() });
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ["register", register, "/api/auth/register", "Registration failed"],
    ["login", login, "/api/auth/login", "Login failed"],
    ["verify email", verifyEmail, "/api/auth/verify-email", "Verification failed"],
    ["forgot password", forgotPassword, "/api/auth/forgot-password", "Request failed"],
    ["reset password", resetPassword, "/api/auth/reset-password", "Reset failed"],
    ["resend verification", resendVerification, "/api/auth/resend-verification", "Request failed"],
    ["link password", linkPassword, "/api/auth/link-password", "Request failed"],
  ])("does not return or log raw upstream details for %s failures", async (_name, handler: Handler, path, fallback) => {
    mockPost.mockRejectedValue(createAxiosError());

    const response = await handler(createRequest(path));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: fallback,
      code: "EMAIL_EXISTS",
      hasKakaoAccount: true,
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/auth-handler");
    expect(logged).not.toContain("https://internal-api.local");
    expect(logged).not.toContain("auth-primary.internal");
  });

  it("does not return or log raw upstream details for current-user failures", async () => {
    mockGet.mockRejectedValue(createAxiosError());

    const response = await me(new NextRequest("http://localhost/api/auth/me", {
      headers: { cookie: "auth_token=auth-token" },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch user",
      code: "EMAIL_EXISTS",
      hasKakaoAccount: true,
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/auth-handler");
    expect(logged).not.toContain("https://internal-api.local");
    expect(logged).not.toContain("auth-primary.internal");
  });

  it("does not return or log raw upstream details for refresh failures", async () => {
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === "refresh_token") return { value: "refresh-token" };
        if (name === "auto_login") return { value: "1" };
        return undefined;
      }),
    });
    mockPost.mockRejectedValue(createAxiosError());

    const response = await refresh();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to refresh authentication",
      code: "EMAIL_EXISTS",
      hasKakaoAccount: true,
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/auth-handler");
    expect(logged).not.toContain("https://internal-api.local");
    expect(logged).not.toContain("auth-primary.internal");
  });
});
