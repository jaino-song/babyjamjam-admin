/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { middleware } from "../middleware";

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

const mockJwtDecode = jwtDecode as jest.Mock;

function createRequest(pathname: string, cookie?: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: {
      host: "localhost",
      ...(cookie ? { cookie } : {}),
    },
    method,
  });
}

describe("middleware API route protection", () => {
  beforeEach(() => {
    mockJwtDecode.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "test",
      configurable: true,
    });
    delete process.env.LOCAL_AUTO_LOGIN_EMAIL;
    delete process.env.LOCAL_AUTO_LOGIN_PASSWORD;
    jest.restoreAllMocks();
  });

  it("creates a local development session before rendering the login page", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      branchId: "branch-1",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accessToken: "local-access-token",
      refreshToken: "local-refresh-token",
      requiresBranchSelection: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await middleware(createRequest("/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.cookies.get("auth_token")).toMatchObject({
      value: "local-access-token",
      httpOnly: true,
    });
    expect(response.cookies.get("refresh_token")).toMatchObject({
      value: "local-refresh-token",
      httpOnly: true,
    });
    expect(response.cookies.get("auto_login")?.value).toBe("1");
    expect(response.cookies.get("selected_branch_id")?.value).toBe("branch-1");
  });

  it("replaces a stale branch cookie with the branch authorized by the local session", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      branchId: "branch-new",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accessToken: "local-access-token",
      refreshToken: "local-refresh-token",
      requiresBranchSelection: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await middleware(createRequest(
      "/login",
      "selected_branch_id=branch-stale",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.cookies.get("selected_branch_id")?.value).toBe("branch-new");
  });

  it("clears a stale branch cookie when the local session requires branch selection", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accessToken: "local-access-token",
      refreshToken: "local-refresh-token",
      requiresBranchSelection: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await middleware(createRequest(
      "/clients",
      "selected_branch_id=branch-stale",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/select-branch");
    expect(response.cookies.get("selected_branch_id")?.value).toBe("");
  });

  it("never creates a local session for protected API requests", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    const fetchMock = jest.spyOn(global, "fetch");

    const response = await middleware(createRequest("/api/clients"));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the regular login page in production", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    const fetchMock = jest.spyOn(global, "fetch");

    const response = await middleware(createRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects the login page to home when a valid access token exists", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest("/login", "auth_token=session-token"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("allows an authenticated login POST to complete its server action response", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(
      createRequest("/login", "auth_token=session-token", "POST"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated login HEAD request to home", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(
      createRequest("/login", "auth_token=session-token", "HEAD"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("allows the login page without a valid access token", async () => {
    const response = await middleware(createRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows explicitly public auth API routes without a session", async () => {
    const response = await middleware(createRequest("/api/auth/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the receipt status BFF route without a session", async () => {
    const response = await middleware(createRequest("/api/receipt/efr_x/status"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the public receipt page without a session", async () => {
    const response = await middleware(createRequest("/receipt/efr_x"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not treat the receipt-links send route as public — it requires a session", async () => {
    // Regression guard for a mutant that simplifies isRouteMatch() to a bare
    // `pathname.startsWith(route)`: "/api/receipt-links/send".startsWith("/api/receipt")
    // is true, which would wrongly make this protected admin route public. The real
    // isRouteMatch() requires an exact match or a "/" boundary after the route prefix.
    const response = await middleware(createRequest("/api/receipt-links/send"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "AUTH_REQUIRED", error: "Authentication required" });
  });

  it("does not allow the legacy token callback as a public API route", async () => {
    const response = await middleware(createRequest("/api/auth/callback"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "AUTH_REQUIRED", error: "Authentication required" });
  });

  it("rejects protected API routes without a session", async () => {
    const response = await middleware(createRequest("/api/clients"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "AUTH_REQUIRED", error: "Authentication required" });
  });

  it("rejects protected API routes when the session has no selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest("/api/clients", "auth_token=session-token"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "BRANCH_SELECTION_REQUIRED", error: "Branch selection required" });
  });

  it("allows protected API routes with auth and selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest(
      "/api/clients",
      "auth_token=session-token; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("delegates an expired protected API session to the client refresh coordinator", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const fetchMock = jest.spyOn(global, "fetch");

    const response = await middleware(createRequest(
      "/api/clients",
      "auth_token=expired; refresh_token=current; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "AUTH_REFRESH_REQUIRED",
      error: "Session refresh required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("does not clear cookies when another request is already rotating refresh", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        code: "AUTH_REFRESH_REPLAY_CONCURRENT",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await middleware(createRequest(
      "/clients",
      "auth_token=expired; refresh_token=current; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/clients");
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();
    fetchMock.mockRestore();
  });

  it("recovers a stale access cookie on the login navigation without a second reload", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockImplementation((token: string) => {
      if (token === "stale") throw new Error("invalid token");
      return {
        sub: "user-1",
        sid: "session-1",
        role: "manager",
        branchId: "branch-1",
        type: "access",
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      accessToken: "local-access-token",
      refreshToken: "local-refresh-token",
      requiresBranchSelection: false,
    }), { status: 200 }));

    const response = await middleware(createRequest("/login", "auth_token=stale"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.cookies.get("auth_token")?.value).toBe("local-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries refresh before credential recovery when only a stale refresh cookie remains", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      branchId: "branch-1",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/refresh-token")) {
        return new Response(JSON.stringify({ code: "AUTH_REFRESH_INVALID" }), { status: 401 });
      }
      return new Response(JSON.stringify({
        success: true,
        accessToken: "local-access-token",
        refreshToken: "local-refresh-token",
        requiresBranchSelection: false,
      }), { status: 200 });
    });

    const response = await middleware(createRequest("/login", "refresh_token=stale"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3001/auth/refresh-token");
  });

  it("preserves cookies when the local refresh backend is temporarily unavailable", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockImplementation((token: string) => {
      if (token === "stale") throw new Error("invalid token");
      return {
        sub: "user-1",
        sid: "session-1",
        role: "manager",
        branchId: "branch-1",
        type: "access",
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 }),
    );

    const response = await middleware(createRequest(
      "/login",
      "auth_token=stale; refresh_token=current",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a revoked-looking access cookie after an authoritative local 401", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    const accessToken = "revoked-looking";
    mockJwtDecode.mockImplementation((token: string) => token === accessToken
      ? {
        sub: "user-1",
        sid: "revoked-session",
        role: "manager",
        type: "access",
        exp: 4_000_000_000,
      }
      : {
        sub: "user-1",
        sid: "session-2",
        role: "manager",
        branchId: "branch-2",
        type: "access",
        exp: 4_000_000_000,
      });
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/me")) {
        return new Response(JSON.stringify({ code: "AUTH_INVALID_TOKEN" }), { status: 401 });
      }
      return new Response(JSON.stringify({
        success: true,
        accessToken: "local-access-token",
        refreshToken: "local-refresh-token",
        requiresBranchSelection: false,
      }), { status: 200 });
    });

    const response = await middleware(createRequest("/login", `auth_token=${accessToken}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.cookies.get("selected_branch_id")?.value).toBe("branch-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 503, body: JSON.stringify({ error: "temporarily unavailable" }) },
    { status: 200, body: "malformed" },
  ])("does not replace a valid-looking session when auth probing is uncertain ($status)", async ({ status, body }) => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });
    process.env.LOCAL_AUTO_LOGIN_EMAIL = "developer@example.test";
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = "test-fixture";
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "uncertain-session",
      role: "manager",
      type: "access",
      exp: 4_000_000_000,
    });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(body, { status }));

    const response = await middleware(createRequest("/login", "auth_token=uncertain"));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
