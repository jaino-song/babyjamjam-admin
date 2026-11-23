/** @jest-environment node */
import { createHash } from "node:crypto";
import { AxiosError } from "axios";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as tokenRoute } from "@/app/api/auth/token/route";
import { serverAPIClient } from "@/lib/api/server";

import { exchangeToken } from "../callback/actions";
import { loginWithEmail } from "../login/actions";
import { logout } from "@/app/logout/actions";
import { completeAccountOnboarding } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));

const accountCookie = "pending_account_onboarding";
const signupCookie = "pending_kakao_signup";
const preferenceCookie = "pending_account_onboarding_auto_login";
const pendingToken = "synthetic-pending-token";
const otherToken = "different-synthetic-token";
const tokens = {
  success: true,
  accessToken: "fixture." + Buffer.from(JSON.stringify({ role: "admin" })).toString("base64url") + ".test",
  refreshToken: "synthetic-refresh",
  requiresBranchSelection: true,
};
const jar = new Map<string, { value: string; options?: object }>();
const store = {
  get: (name: string) => jar.get(name),
  set: (name: string, value: string, options?: object) => jar.set(name, { value, options }),
  delete: (name: string) => jar.delete(name),
};
const post = jest.mocked(serverAPIClient.post);

beforeEach(() => {
  jar.clear();
  post.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.mocked(cookies).mockResolvedValue(store as never);
});

afterEach(() => jest.restoreAllMocks());

function accountResponse(token = pendingToken) {
  return { status: 200, data: {
    success: true, onboardingRequired: true, onboardingRoute: "/onboarding",
    pendingAccountOnboardingToken: token,
  } };
}

const signupResponse = { status: 200, data: {
  success: true, onboardingRequired: true, onboardingRoute: "/kakao/onboarding",
  pendingSignupToken: "synthetic-signup-token",
} };

async function startEmailOnboarding(autoLogin: boolean, token = pendingToken) {
  post.mockResolvedValueOnce(accountResponse(token));
  expect(await loginWithEmail("test@example.invalid", "fixture", autoLogin)).toEqual({
    success: true, onboardingRequired: true, onboardingRoute: "/onboarding",
  });
}

function authCookies() {
  return ["auth_token", "refresh_token", "auto_login"].map(name => jar.get(name));
}

function request(path: string, body: object): NextRequest {
  return new NextRequest("http://localhost/api/auth/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectPendingCleared() {
  expect(jar.has(accountCookie)).toBe(false);
  expect(jar.has(signupCookie)).toBe(false);
  expect(jar.has(preferenceCookie)).toBe(false);
}

it.each([false, true])("completes email onboarding with the direct login cookie policy (autoLogin=%s)", async autoLogin => {
  post.mockResolvedValueOnce({ status: 200, data: tokens });
  expect((await loginWithEmail("test@example.invalid", "fixture", autoLogin)).success).toBe(true);
  const directCookies = authCookies();
  const sessionFlags = { httpOnly: true, secure: false, sameSite: "lax", path: "/" };
  const lifetimes = [900, 7 * 86400, 7 * 86400];
  expect(directCookies).toEqual([tokens.accessToken, tokens.refreshToken, autoLogin ? "1" : "0"].map((value, index) => ({
    value,
    options: autoLogin ? { ...sessionFlags, maxAge: lifetimes[index] } : sessionFlags,
  })));

  store.set(signupCookie, "abandoned-signup");
  await startEmailOnboarding(autoLogin);
  expect(jar.has(signupCookie)).toBe(false);
  expect(authCookies()).toEqual([undefined, undefined, undefined]);
  const pendingOptions = { ...sessionFlags, maxAge: 1800 };
  expect(jar.get(accountCookie)?.options).toEqual(pendingOptions);
  expect(jar.get(preferenceCookie)?.options).toEqual(pendingOptions);
  const digest = createHash("sha256").update(pendingToken).digest("hex");
  expect(jar.get(preferenceCookie)?.value === (autoLogin ? "1." : "0.") + digest).toBe(true);

  post.mockResolvedValueOnce({ status: 201, data: tokens });
  expect(await completeAccountOnboarding({})).toEqual({ success: true, requiresBranchSelection: true });
  expect(authCookies()).toEqual(directCookies);
  expectPendingCleared();
});

it("replaces the earlier email preference with the latest attempt's choice", async () => {
  await startEmailOnboarding(true);
  await startEmailOnboarding(false, otherToken);

  post.mockResolvedValueOnce({ status: 201, data: tokens });
  expect((await completeAccountOnboarding({})).success).toBe(true);
  expect(jar.get("auto_login")?.value).toBe("0");
  expect(jar.get("auto_login")?.options).not.toHaveProperty("maxAge");
  expectPendingCleared();
});

it.each(["missing", "malformed flag", "malformed digest", "trailing data", "another token"])("uses persistent defaults when the preference is %s", async kind => {
  store.set(accountCookie, pendingToken);
  const digest = createHash("sha256").update(kind === "another token" ? otherToken : pendingToken).digest("hex");
  if (kind === "malformed flag") store.set(preferenceCookie, "00." + digest);
  if (kind === "trailing data") store.set(preferenceCookie, "0." + digest + ".extra");
  if (kind === "another token") store.set(preferenceCookie, "0." + digest);
  if (kind === "malformed digest") store.set(preferenceCookie, "0.invalid");

  post.mockResolvedValueOnce({ status: 201, data: tokens });
  expect((await completeAccountOnboarding({})).success).toBe(true);
  expect(jar.get("auto_login")).toMatchObject({ value: "1", options: { maxAge: 7 * 86400 } });
  expectPendingCleared();
});

it.each([400, 403, 429])("keeps the matching preference for a retry after %s", async status => {
  await startEmailOnboarding(false);
  const pending = jar.get(accountCookie);
  const preference = jar.get(preferenceCookie);
  post.mockRejectedValueOnce(new AxiosError("fixture", undefined, undefined, undefined, { status } as never));

  expect((await completeAccountOnboarding({})).success).toBe(false);
  expect(jar.get(accountCookie)).toBe(pending);
  expect(jar.get(preferenceCookie)).toBe(preference);
  expect(authCookies()).toEqual([undefined, undefined, undefined]);

  post.mockResolvedValueOnce({ status: 201, data: tokens });
  expect((await completeAccountOnboarding({})).success).toBe(true);
  expect(jar.get("auto_login")?.value).toBe("0");
  expectPendingCleared();
});

it.each(["unauthorized", "token already expired"])("cleans up a pending preference when %s", async reason => {
  await startEmailOnboarding(false);
  if (reason === "unauthorized") {
    post.mockRejectedValueOnce(new AxiosError("fixture", undefined, undefined, undefined, { status: 401 } as never));
  } else {
    jar.delete(accountCookie);
  }
  post.mockClear();

  expect(await completeAccountOnboarding({})).toEqual({
    success: false, error: "로그인 세션이 만료됐어요. 다시 로그인해 주세요.",
  });
  if (reason === "token already expired") expect(post).not.toHaveBeenCalled();
  expectPendingCleared();
});

it.each([
  ["Kakao callback", () => exchangeToken("fixture")],
  ["token API", () => tokenRoute(request("token", { code: "fixture" }))],
] as const)("clears the preference on %s pending replacement", async (_label, run) => {
  await startEmailOnboarding(false);
  post.mockResolvedValueOnce(accountResponse(otherToken));
  await run();
  expect(jar.get(accountCookie)?.value).toBe(otherToken);
  expect(jar.has(preferenceCookie)).toBe(false);

  post.mockResolvedValueOnce({ status: 201, data: tokens });
  expect((await completeAccountOnboarding({})).success).toBe(true);
  expect(jar.get("auto_login")?.value).toBe("1");

  await startEmailOnboarding(false);
  post.mockResolvedValueOnce(signupResponse);
  await run();
  expect(jar.get(signupCookie)?.value).toBe(signupResponse.data.pendingSignupToken);
  expect(jar.has(accountCookie)).toBe(false);
  expect(jar.has(preferenceCookie)).toBe(false);
});

it.each([
  ["email action", () => loginWithEmail("test@example.invalid", "fixture")],
  ["email API", () => loginRoute(request("login", { email: "test@example.invalid", password: "fixture" }))],
  ["Kakao callback", () => exchangeToken("fixture")],
  ["token API", () => tokenRoute(request("token", { code: "fixture" }))],
] as const)("cleans up stale pending flows after a successful %s login", async (_label, run) => {
  await startEmailOnboarding(false);
  store.set(signupCookie, "abandoned-signup");
  post.mockResolvedValueOnce({ status: 200, data: tokens });

  await run();
  expect(jar.get("auth_token")?.value).toBe(tokens.accessToken);
  expectPendingCleared();
});

it("leaves the active pending flow available when the login API does not issue a session", async () => {
  await startEmailOnboarding(false);
  const before = [...jar];
  post.mockResolvedValueOnce(accountResponse(otherToken));
  jest.spyOn(console, "error").mockImplementation(() => undefined);

  await loginRoute(request("login", { email: "test@example.invalid", password: "fixture" }));
  expect([...jar]).toEqual(before);
});

it("clears pending onboarding on logout", async () => {
  await startEmailOnboarding(false);
  store.set(signupCookie, "abandoned-signup");
  expect(await logout()).toEqual({ success: true });
  expectPendingCleared();
});
