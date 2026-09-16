const DESKTOP_GATEWAY_ORIGIN = "https://admin.babyjamjam.com";
const DEVELOPMENT_DESKTOP_ORIGIN = "http://127.0.0.1:3000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface LocationLike {
  hostname: string;
  port?: string;
}

interface DesktopFrontendOriginOptions {
  nodeEnv?: string;
  location?: LocationLike | null;
}

/**
 * Resolve the authenticated desktop app origin used by cross-app links.
 *
 * Production follows the same canonical desktop gateway as the mobile redirect
 * (`admin.babyjamjam.com`). Development uses the documented desktop loopback
 * origin explicitly; it does not infer a port from whichever mobile server is
 * currently serving the page.
 */
export function resolveDesktopFrontendOrigin(
  options: DesktopFrontendOriginOptions = {},
): string {
  const location = options.location
    ?? (typeof window === "undefined" ? null : window.location);
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  if (nodeEnv === "development" && location && LOOPBACK_HOSTS.has(location.hostname)) {
    return DEVELOPMENT_DESKTOP_ORIGIN;
  }

  return DESKTOP_GATEWAY_ORIGIN;
}

export function getServiceRecordAdminHref(
  clientId: number,
  options?: DesktopFrontendOriginOptions,
): string {
  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new Error("clientId must be a positive integer");
  }

  return `${resolveDesktopFrontendOrigin(options)}/service-record-admin/${encodeURIComponent(String(clientId))}`;
}
