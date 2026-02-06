export const LAYOUT_EXCLUDED_ROUTES = ["/", "/login", "/logout", "/chat", "/select-organization"];
export const LAYOUT_EXCLUDED_PREFIXES = ["/auth/", "/admin/"];
export const isLayoutExcluded = (pathname: string) =>
  LAYOUT_EXCLUDED_ROUTES.includes(pathname) ||
  LAYOUT_EXCLUDED_PREFIXES.some(prefix => pathname.startsWith(prefix));
