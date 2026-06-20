import { getMobileGatewayRedirectUrl, isMobileUserAgent } from "@/lib/gateway/mobile-redirect";

const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("admin gateway proxy", () => {
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
});
