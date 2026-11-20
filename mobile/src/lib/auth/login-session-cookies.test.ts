/** @jest-environment node */
import { cookies } from "next/headers";
import { jwtDecode } from "jwt-decode";
import { writeLoginSessionCookies } from "./login-session-cookies";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("jwt-decode", () => ({ jwtDecode: jest.fn() }));
jest.mock("@/lib/env", () => ({ getServerRuntimeConfig: () => ({ isSecureCookieEnv: true }) }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const store = { set: jest.fn(), delete: jest.fn() };
const tokens = { accessToken: "access", refreshToken: "refresh", requiresBranchSelection: false };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  jest.mocked(jwtDecode).mockReturnValue({ role: "manager", branchId: "branch" });
});
it("persists auto-login cookies with unchanged ages and flags and the authorized branch", async () => {
  await writeLoginSessionCookies(tokens, true);
  const base = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
  expect(store.set).toHaveBeenCalledWith("auth_token", "access", { ...base, maxAge: 900 });
  expect(store.set).toHaveBeenCalledWith("refresh_token", "refresh", { ...base, maxAge: 7 * 86400 });
  expect(store.set).toHaveBeenCalledWith("auto_login", "1", { ...base, maxAge: 30 * 86400 });
  expect(store.set).toHaveBeenCalledWith("selected_branch_id", "branch", { ...base, httpOnly: false, maxAge: 30 * 86400 });
});
it("writes session cookies with auto-login off and clears an unauthorized branch", async () => {
  await writeLoginSessionCookies({ ...tokens, requiresBranchSelection: true }, false);
  const base = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
  expect(store.set).toHaveBeenCalledWith("auth_token", "access", base);
  expect(store.set).toHaveBeenCalledWith("refresh_token", "refresh", base);
  expect(store.set).toHaveBeenCalledWith("auto_login", "0", base);
  expect(store.delete).toHaveBeenCalledWith("selected_branch_id");
});
it("clears the branch when the token has none", async () => {
  jest.mocked(jwtDecode).mockReturnValue({ role: "user" });
  await writeLoginSessionCookies(tokens, true);
  expect(store.delete).toHaveBeenCalledWith("selected_branch_id");
});
