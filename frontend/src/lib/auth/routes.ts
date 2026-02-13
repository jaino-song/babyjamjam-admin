// Auth routes live under the `(auth)` route group, so the folder name is hidden from the URL.
// Keep all "public auth pages" in one place to avoid scattering hard-coded paths.

export const AUTH_ROUTES = {
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  callback: "/callback",
} as const;

export const PUBLIC_AUTH_PATHS = new Set<string>(Object.values(AUTH_ROUTES));

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Normalize trailing slash
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_AUTH_PATHS.has(normalized);
}

