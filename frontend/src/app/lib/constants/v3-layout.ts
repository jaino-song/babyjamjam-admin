import { isPublicAuthPath } from "@/app/lib/auth/routes";

export const LAYOUT_EXCLUDED_ROUTES = ["/", "/logout", "/chat", "/select-organization"];
export const LAYOUT_EXCLUDED_PREFIXES = ["/admin/"];

export const isLayoutExcluded = (pathname: string) =>
  LAYOUT_EXCLUDED_ROUTES.includes(pathname) ||
  isPublicAuthPath(pathname) ||
  LAYOUT_EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
