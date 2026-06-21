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

export function getMobileGatewayRedirectUrl(requestUrl: URL, userAgent: string | null): URL | null {
  if (requestUrl.hostname.toLowerCase() !== DESKTOP_GATEWAY_HOST) {
    return null;
  }

  if (!isMobileUserAgent(userAgent) || isApiRoute(requestUrl.pathname)) {
    return null;
  }

  return new URL(`${requestUrl.pathname}${requestUrl.search}`, MOBILE_GATEWAY_ORIGIN);
}
