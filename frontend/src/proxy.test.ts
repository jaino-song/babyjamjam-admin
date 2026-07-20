/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { getMobileGatewayRedirectUrl, isMobileUserAgent } from "@/lib/gateway/mobile-redirect";
import { proxy } from "@/proxy";

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

const mockJwtDecode = jwtDecode as jest.Mock;

const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("admin gateway proxy", () => {
  beforeEach(() => {
    mockJwtDecode.mockReset();
  });

  it("detects mobile browser user agents", () => {
    expect(isMobileUserAgent(IPHONE_USER_AGENT)).toBe(true);
    expect(isMobileUserAgent(DESKTOP_USER_AGENT)).toBe(false);
    expect(isMobileUserAgent(null)).toBe(false);
  });

  it("redirects mobile admin traffic to the mobile host while preserving route state", () => {
    const redirectUrl = getMobileGatewayRedirectUrl(
      new URL("https://admin.babyjamjam.com/dashboard?tab=messages"),
      IPHONE_USER_AGENT
    );

    expect(redirectUrl?.href).toBe("https://m.admin.babyjamjam.com/dashboard?tab=messages");
  });

  it("does not redirect desktop browser traffic", () => {
    const redirectUrl = getMobileGatewayRedirectUrl(
      new URL("https://admin.babyjamjam.com/dashboard"),
      DESKTOP_USER_AGENT
    );

    expect(redirectUrl).toBeNull();
  });

  it("does not redirect non-gateway hosts", () => {
    const redirectUrl = getMobileGatewayRedirectUrl(
      new URL("https://babyjamjam-admin-git-dev-jaino-songs-projects.vercel.app/dashboard"),
      IPHONE_USER_AGENT
    );

    expect(redirectUrl).toBeNull();
  });

  it("does not redirect API routes", () => {
    const redirectUrl = getMobileGatewayRedirectUrl(
      new URL("https://admin.babyjamjam.com/api/auth/login"),
      IPHONE_USER_AGENT
    );

    expect(redirectUrl).toBeNull();
  });

  it("rotates an expired desktop auth session instead of forcing login", async () => {
    mockJwtDecode.mockImplementation((token: string) => token === "new-access"
      ? {
        sub: "user-1",
        sid: "session-1",
        role: "admin",
        branchId: "branch-1",
        type: "access",
        exp: Math.floor(Date.now() / 1000) + 60,
      }
      : {
        sub: "user-1",
        sid: "session-1",
        role: "admin",
        type: "access",
        exp: Math.floor(Date.now() / 1000) - 60,
      });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        accessToken: "new-access",
        refreshToken: "next-refresh",
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await proxy(new NextRequest("http://localhost/dashboard", {
      headers: {
        cookie: "auth_token=expired; refresh_token=current; selected_branch_id=branch-1",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
    expect(response.headers.get("set-cookie")).toContain("auth_token=new-access");
    expect(response.headers.get("set-cookie")).toContain("refresh_token=next-refresh");
    fetchMock.mockRestore();
  });

  it("refreshes an expired session when navigating to login", async () => {
    mockJwtDecode.mockImplementation((token: string) => token === "new-access"
      ? {
        sub: "user-1",
        sid: "session-1",
        role: "admin",
        branchId: "branch-1",
        type: "access",
        exp: Math.floor(Date.now() / 1000) + 60,
      }
      : {
        sub: "user-1",
        sid: "session-1",
        role: "admin",
        type: "access",
        exp: Math.floor(Date.now() / 1000) - 60,
      });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        accessToken: "new-access",
        refreshToken: "next-refresh",
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await proxy(new NextRequest("http://localhost/login", {
      method: "GET",
      headers: {
        cookie: "auth_token=expired; refresh_token=current",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("set-cookie")).toContain("auth_token=new-access");
    fetchMock.mockRestore();
  });

  it("allows login Server Action posts through without refreshing the previous session", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "admin",
      type: "access",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const fetchMock = jest.spyOn(global, "fetch");

    const response = await proxy(new NextRequest("http://localhost/login", {
      method: "POST",
      headers: {
        cookie: "auth_token=expired; refresh_token=current",
        "next-action": "login-action",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
