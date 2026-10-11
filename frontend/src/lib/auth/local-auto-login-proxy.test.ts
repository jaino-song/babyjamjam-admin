/** @jest-environment node */
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

jest.mock("@/lib/gateway/mobile-redirect", () => ({ getMobileGatewayRedirectUrl: () => null }));
const originalEnv = process.env;
const originalFetch = global.fetch;
const token = `e30.${Buffer.from(JSON.stringify({ type: "access", sid: "test-session", role: "admin", exp: 4_000_000_000 })).toString("base64url")}.test`;
beforeEach(() => {
  process.env = { NODE_ENV: "development", LOCAL_AUTO_LOGIN_EMAIL: "developer@example.test",
    LOCAL_AUTO_LOGIN_PASSWORD: "fixture", DEVELOPMENT_API_BASE_URL: "http://localhost:3001" };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, accessToken: token, refreshToken: "refresh" }) });
});
afterAll(() => { process.env = originalEnv; global.fetch = originalFetch; });
it.each(["/", "/login", "/dashboard"])("sets normal httpOnly session cookies on %s", async (path) => {
  const response = await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`http://localhost:3000${path === "/login" ? "/" : path}`);
  expect(response.cookies.get("auth_token")).toMatchObject({ value: token, httpOnly: true });
  expect(response.cookies.get("refresh_token")).toMatchObject({ value: "refresh", httpOnly: true });
});
it.each(["/api/auth/login", "/logout", "/register", "/login-extra", "/_next/asset"])("never auto logs in on %s", async (path) => {
  await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
  expect(global.fetch).not.toHaveBeenCalled();
});

it("recovers a stale access cookie on the login navigation without a second reload", async () => {
  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: { host: "localhost:3000", cookie: "auth_token=stale" },
  }));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost:3000/");
  expect(response.cookies.get("auth_token")?.value).toBe(token);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("tries refresh before credential recovery when only a stale refresh cookie remains", async () => {
  (global.fetch as jest.Mock).mockImplementation(async (input: URL | string) => {
    if (String(input).endsWith("/auth/refresh-token")) {
      return new Response(JSON.stringify({ code: "AUTH_REFRESH_INVALID" }), { status: 401 });
    }
    return new Response(JSON.stringify({
      success: true,
      accessToken: token,
      refreshToken: "refresh",
    }), { status: 200 });
  });

  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: { host: "localhost:3000", cookie: "refresh_token=stale" },
  }));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost:3000/");
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("http://localhost:3001/auth/refresh-token");
});

it("preserves cookies when the local refresh backend is temporarily unavailable", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 }),
  );

  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: {
      host: "localhost:3000",
      cookie: "auth_token=stale; refresh_token=current",
    },
  }));

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("preserves a safe editor return path after stale-cookie recovery", async () => {
  const response = await proxy(new NextRequest(
    "http://localhost:3000/login?returnTo=%2Fservice-record-admin%2Fclient-1",
    { headers: { host: "localhost:3000", cookie: "auth_token=stale" } },
  ));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/service-record-admin/client-1",
  );
});

it("recovers a revoked-looking access cookie after an authoritative local 401", async () => {
  const accessToken = `e30.${Buffer.from(JSON.stringify({
    type: "access",
    sid: "revoked-session",
    role: "admin",
    exp: 4_000_000_000,
  })).toString("base64url")}.signature`;
  (global.fetch as jest.Mock).mockImplementation(async (input: URL | string) => {
    if (String(input).endsWith("/auth/me")) {
      return new Response(JSON.stringify({ code: "AUTH_INVALID_TOKEN" }), { status: 401 });
    }
    return new Response(JSON.stringify({
      success: true,
      accessToken: token,
      refreshToken: "refresh",
    }), { status: 200 });
  });

  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: {
      host: "localhost:3000",
      cookie: `auth_token=${accessToken}`,
    },
  }));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost:3000/");
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it.each([
  { status: 503, body: JSON.stringify({ error: "temporarily unavailable" }) },
  { status: 200, body: "malformed" },
])("does not replace a valid-looking session when auth probing is uncertain ($status)", async ({ status, body }) => {
  const accessToken = `e30.${Buffer.from(JSON.stringify({
    type: "access",
    sid: "uncertain-session",
    role: "admin",
    exp: 4_000_000_000,
  })).toString("base64url")}.signature`;
  (global.fetch as jest.Mock).mockResolvedValue(new Response(body, { status }));

  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: {
      host: "localhost:3000",
      cookie: `auth_token=${accessToken}`,
    },
  }));

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("does not probe or replace a valid-looking session outside local development", async () => {
  process.env = { ...process.env, NODE_ENV: "production" };
  const accessToken = `e30.${Buffer.from(JSON.stringify({
    type: "access",
    sid: "production-session",
    role: "admin",
    exp: 4_000_000_000,
  })).toString("base64url")}.signature`;

  const response = await proxy(new NextRequest("http://localhost:3000/login", {
    headers: { host: "localhost:3000", cookie: `auth_token=${accessToken}` },
  }));

  expect(response.status).toBe(200);
  expect(global.fetch).not.toHaveBeenCalled();
});

it("retains the regular login gate in production", async () => {
  process.env = { ...process.env, NODE_ENV: "production" };
  const response = await proxy(new NextRequest("http://localhost:3000/dashboard", { headers: { host: "localhost:3000" } }));
  expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  expect(global.fetch).not.toHaveBeenCalled();
});
