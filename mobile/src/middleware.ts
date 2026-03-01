import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
  sub: string;
  role: string | null;
  organizationId?: string;
  orgRole?: string;
  type: "access" | "refresh";
  exp?: number;
}

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
}

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const API_URL = isProduction
  ? process.env.NEXT_PUBLIC_API_BASE_URL
  : process.env.DEVELOPMENT_API_BASE_URL;

function isAutoLoginEnabled(value: string | undefined): boolean {
  return value !== "0" && value !== "false";
}

function getAuthTokenMaxAge(role: string): number {
  return role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60;
}

function decodeRole(token: string): string {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.role || "user";
  } catch {
    return "user";
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    if (!decoded.exp) {
      return false;
    }
    return decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete("auth_token");
  response.cookies.delete("refresh_token");
}

function setSessionCookies(
  response: NextResponse,
  params: { accessToken: string; refreshToken: string; role: string; autoLogin: boolean }
): void {
  const baseCookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
  };

  if (params.autoLogin) {
    response.cookies.set("auth_token", params.accessToken, {
      ...baseCookieOptions,
      maxAge: getAuthTokenMaxAge(params.role),
    });
    response.cookies.set("refresh_token", params.refreshToken, {
      ...baseCookieOptions,
      maxAge: 7 * 24 * 60 * 60,
    });
    response.cookies.set("auto_login", "1", {
      ...baseCookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    });
    return;
  }

  response.cookies.set("auth_token", params.accessToken, baseCookieOptions);
  response.cookies.set("refresh_token", params.refreshToken, baseCookieOptions);
  response.cookies.set("auto_login", "0", baseCookieOptions);
}

async function tryRefreshAuthSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  role: string;
} | null> {
  if (!API_URL) {
    return null;
  }

  try {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (!refreshResponse.ok) {
      return null;
    }

    const data = await refreshResponse.json() as RefreshResponse;
    if (!data.accessToken || isTokenExpired(data.accessToken)) {
      return null;
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      role: decodeRole(data.accessToken),
    };
  } catch {
    return null;
  }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/callback",
  "/logout",
  "/auth",
  "/api",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
];

// Routes that require auth but NOT organization selection
const AUTH_ONLY_ROUTES = [
  "/select-organization",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Get auth token
  let authToken = request.cookies.get("auth_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const autoLogin = isAutoLoginEnabled(request.cookies.get("auto_login")?.value);
  let refreshedSession: {
    accessToken: string;
    refreshToken: string;
    role: string;
  } | null = null;

  const needsRefresh = !authToken || isTokenExpired(authToken);

  if (needsRefresh && refreshToken) {
    refreshedSession = await tryRefreshAuthSession(refreshToken);
    if (refreshedSession) {
      authToken = refreshedSession.accessToken;
      if (request.method === "GET" || request.method === "HEAD") {
        const response = NextResponse.redirect(request.nextUrl);
        setSessionCookies(response, {
          accessToken: refreshedSession.accessToken,
          refreshToken: refreshedSession.refreshToken,
          role: refreshedSession.role,
          autoLogin,
        });
        return response;
      }

    }
  }

  // No auth token - redirect to login
  if (!authToken || isTokenExpired(authToken)) {
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    clearAuthCookies(response);
    return response;
  }

  // Check if route only requires auth (not organization)
  if (AUTH_ONLY_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next();
    if (refreshedSession) {
      setSessionCookies(response, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        role: refreshedSession.role,
        autoLogin,
      });
    }
    return response;
  }

  // For all other routes, check if organization is selected
  try {
    const decoded = jwtDecode<TokenPayload>(authToken);

    // No organization selected - redirect to select-organization
    if (!decoded.organizationId) {
      const selectOrgUrl = new URL("/select-organization", request.url);
      const response = NextResponse.redirect(selectOrgUrl);
      if (refreshedSession) {
        setSessionCookies(response, {
          accessToken: refreshedSession.accessToken,
          refreshToken: refreshedSession.refreshToken,
          role: refreshedSession.role,
          autoLogin,
        });
      }
      return response;
    }

    const response = NextResponse.next();
    if (refreshedSession) {
      setSessionCookies(response, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        role: refreshedSession.role,
        autoLogin,
      });
    }
    return response;
  } catch {
    // Invalid token - redirect to login
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    // Clear invalid cookies
    response.cookies.delete("auth_token");
    response.cookies.delete("refresh_token");
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
