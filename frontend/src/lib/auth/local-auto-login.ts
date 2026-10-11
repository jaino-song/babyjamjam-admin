import type { NextRequest } from "next/server";

import { resolveServerApiUrl } from "@/lib/api/server-base-url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_LOGIN_PATH = "/login";

export interface LocalAutoLoginOptions {
  /** Existing cookies are allowed only after the caller proves they are stale. */
  allowExistingCookies?: boolean;
}

export type LocalAuthProbeResult = "valid" | "invalid" | "unknown" | null;

interface LocalRequestContext {
  backend: URL;
}

function getLocalRequestContext(
  request: NextRequest,
  backendBaseUrl: string | undefined,
  options: LocalAutoLoginOptions = {},
): LocalRequestContext | null {
  if (
    process.env.NODE_ENV !== "development"
    || process.env.VERCEL
    || process.env.VERCEL_ENV
    || process.env.RAILWAY_ENVIRONMENT_ID
    || process.env.RAILWAY_ENVIRONMENT_NAME
    || request.method !== "GET"
    || request.headers.get("sec-fetch-site") === "cross-site"
    || (!options.allowExistingCookies
      && (request.cookies.has("auth_token") || request.cookies.has("refresh_token")))
  ) {
    return null;
  }

  try {
    const frontend = new URL(request.url);
    const backend = new URL(backendBaseUrl ?? "");
    const host = request.headers.get("host");
    const incoming = new URL(`http://${host ?? ""}`);
    if (
      frontend.protocol !== "http:"
      || backend.protocol !== "http:"
      || !LOOPBACK_HOSTS.has(frontend.hostname)
      || !LOOPBACK_HOSTS.has(backend.hostname)
      || !LOOPBACK_HOSTS.has(incoming.hostname)
      || incoming.port !== frontend.port
      || incoming.host !== host
      || backend.username
      || backend.password
    ) {
      return null;
    }

    const origin = request.headers.get("origin");
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (
      (origin && origin !== incoming.origin)
      || (forwardedHost && forwardedHost !== incoming.host)
    ) {
      return null;
    }

    return { backend };
  } catch {
    return null;
  }
}

function hasValidAuthProbeBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLocalAutoLoginEligible(
  request: NextRequest,
  options: LocalAutoLoginOptions = {},
): boolean {
  if (!process.env.LOCAL_AUTO_LOGIN_EMAIL || !process.env.LOCAL_AUTO_LOGIN_PASSWORD) {
    return false;
  }
  return getLocalRequestContext(request, resolveServerApiUrl(), options) !== null;
}

// Credentials stay in the server environment; this module is only used by proxy.ts.
export async function tryLocalAutoLogin(
  request: NextRequest,
  options: LocalAutoLoginOptions = {},
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const email = process.env.LOCAL_AUTO_LOGIN_EMAIL;
  const password = process.env.LOCAL_AUTO_LOGIN_PASSWORD;
  if (!email || !password) return null;

  const context = getLocalRequestContext(request, resolveServerApiUrl(), options);
  if (!context) return null;

  try {
    const response = await fetch(new URL("/auth/login", context.backend), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const session = await response.json() as {
      success?: boolean;
      accessToken?: string;
      refreshToken?: string;
    };
    if (
      session.success !== true
      || typeof session.accessToken !== "string"
      || !session.accessToken
      || typeof session.refreshToken !== "string"
      || !session.refreshToken
    ) return null;
    return { accessToken: session.accessToken, refreshToken: session.refreshToken };
  } catch {
    // Do not log fetch errors: they can contain the credential-bearing request.
    return null;
  }
}

/** Probe only a guarded local login GET; uncertain responses never switch accounts. */
export async function probeLocalAuthSession(
  request: NextRequest,
  accessToken: string,
): Promise<LocalAuthProbeResult> {
  if (request.nextUrl.pathname !== LOCAL_LOGIN_PATH || !accessToken) return null;
  if (!process.env.LOCAL_AUTO_LOGIN_EMAIL || !process.env.LOCAL_AUTO_LOGIN_PASSWORD) return null;

  const context = getLocalRequestContext(
    request,
    resolveServerApiUrl(),
    { allowExistingCookies: true },
  );
  if (!context) return null;

  try {
    const response = await fetch(new URL("/auth/me", context.backend), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return "invalid";
    if (!response.ok) return "unknown";
    const body = await response.json().catch(() => null) as unknown;
    return hasValidAuthProbeBody(body) ? "valid" : "unknown";
  } catch {
    return "unknown";
  }
}
