import { getSafeReturnPathFromSearchParams, getSafeServiceRecordAdminReturnPath } from "@/lib/auth/safe-return-path";

const DESKTOP_GATEWAY_HOST = "admin.babyjamjam.com";
const MOBILE_GATEWAY_ORIGIN = "https://m.admin.babyjamjam.com";
const MOBILE_USER_AGENT_PATTERN =
  /\b(Android|BlackBerry|IEMobile|iPad|iPhone|iPod|Mobile|Opera Mini|webOS)\b/i;

function isApiRoute(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isMobileUserAgent(userAgent: string | null): boolean {
  return Boolean(userAgent && MOBILE_USER_AGENT_PATTERN.test(userAgent));
}

function keepsDesktopGatewayRoute(requestUrl: URL): boolean {
  if (getSafeServiceRecordAdminReturnPath(requestUrl.pathname)) {
    return true;
  }

  // OAuth callback must remain on the desktop origin so the same-tab session
  // storage written by the login page is available when the callback runs.
  if (requestUrl.pathname === "/callback") {
    return true;
  }

  if (requestUrl.pathname !== "/login" && requestUrl.pathname !== "/select-branch") {
    return false;
  }

  return getSafeReturnPathFromSearchParams(requestUrl.searchParams) !== null;
}

export function getMobileGatewayRedirectUrl(requestUrl: URL, userAgent: string | null): URL | null {
  if (requestUrl.hostname.toLowerCase() !== DESKTOP_GATEWAY_HOST) {
    return null;
  }

  if (
    !isMobileUserAgent(userAgent) ||
    isApiRoute(requestUrl.pathname) ||
    keepsDesktopGatewayRoute(requestUrl)
  ) {
    return null;
  }

  return new URL(`${requestUrl.pathname}${requestUrl.search}`, MOBILE_GATEWAY_ORIGIN);
}
