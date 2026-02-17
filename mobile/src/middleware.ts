import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
  sub: string;
  role: string | null;
  organizationId?: string;
  orgRole?: string;
  type: "access" | "refresh";
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Get auth token
  const authToken = request.cookies.get("auth_token")?.value;

  // No auth token - redirect to login
  if (!authToken) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Check if route only requires auth (not organization)
  if (AUTH_ONLY_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // For all other routes, check if organization is selected
  try {
    const decoded = jwtDecode<TokenPayload>(authToken);

    // No organization selected - redirect to select-organization
    if (!decoded.organizationId) {
      const selectOrgUrl = new URL("/select-organization", request.url);
      return NextResponse.redirect(selectOrgUrl);
    }

    return NextResponse.next();
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
