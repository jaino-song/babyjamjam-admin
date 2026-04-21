import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { SESSION_MAX_AGE_SECONDS_BY_ROLE } from "@/lib/auth/session-policy";

interface RecordedCookie {
  name: string;
  value: string;
  options: {
    maxAge?: number;
  };
}

function createAccessToken(role: string | null): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.`;
}

function createCookieStore() {
  const cookies: RecordedCookie[] = [];

  return {
    cookies,
    set(name: string, value: string, options: RecordedCookie["options"]) {
      cookies.push({ name, value, options });
    },
    delete() {},
  };
}

describe("setAuthSessionCookies", () => {
  it.each([
    { role: "owner", maxAge: SESSION_MAX_AGE_SECONDS_BY_ROLE.owner },
    { role: "admin", maxAge: SESSION_MAX_AGE_SECONDS_BY_ROLE.admin },
    { role: "manager", maxAge: SESSION_MAX_AGE_SECONDS_BY_ROLE.manager },
    { role: "user", maxAge: SESSION_MAX_AGE_SECONDS_BY_ROLE.default },
  ])("sets auth and refresh cookies for $role with maxAge $maxAge", ({ role, maxAge }) => {
    const store = createCookieStore();

    setAuthSessionCookies(store, {
      accessToken: createAccessToken(role),
      refreshToken: "refresh-token",
      autoLogin: true,
    });

    expect(store.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "auth_token", options: expect.objectContaining({ maxAge }) }),
        expect.objectContaining({ name: "refresh_token", options: expect.objectContaining({ maxAge }) }),
        expect.objectContaining({ name: "auto_login", value: "1", options: expect.objectContaining({ maxAge }) }),
      ]),
    );
  });

  it("keeps browser-session cookies when auto-login is disabled", () => {
    const store = createCookieStore();

    setAuthSessionCookies(store, {
      accessToken: createAccessToken("owner"),
      refreshToken: "refresh-token",
      autoLogin: false,
    });

    expect(store.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "auth_token", options: expect.not.objectContaining({ maxAge: expect.any(Number) }) }),
        expect.objectContaining({ name: "refresh_token", options: expect.not.objectContaining({ maxAge: expect.any(Number) }) }),
        expect.objectContaining({ name: "auto_login", value: "0", options: expect.not.objectContaining({ maxAge: expect.any(Number) }) }),
      ]),
    );
  });
});
