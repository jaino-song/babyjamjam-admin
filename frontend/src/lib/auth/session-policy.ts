import { jwtDecode } from "jwt-decode";

const DAY_IN_SECONDS = 24 * 60 * 60;

export const AUTH_COOKIE_NAMES = {
    accessToken: "auth_token",
    refreshToken: "refresh_token",
    autoLogin: "auto_login",
} as const;

export const SESSION_MAX_AGE_SECONDS_BY_ROLE = {
    owner: 30 * DAY_IN_SECONDS,
    admin: 7 * DAY_IN_SECONDS,
    manager: 7 * DAY_IN_SECONDS,
    default: 3 * DAY_IN_SECONDS,
} as const;

interface TokenPayload {
    role?: string | null;
}

export function getSessionMaxAgeSeconds(role: string | null | undefined): number {
    if (role === "owner") {
        return SESSION_MAX_AGE_SECONDS_BY_ROLE.owner;
    }

    if (role === "admin" || role === "manager") {
        return SESSION_MAX_AGE_SECONDS_BY_ROLE.admin;
    }

    return SESSION_MAX_AGE_SECONDS_BY_ROLE.default;
}

export function decodeRoleFromAccessToken(accessToken: string): string | null {
    try {
        const decoded = jwtDecode<TokenPayload>(accessToken);
        return decoded.role ?? null;
    } catch {
        return null;
    }
}

export function isSecureAuthCookie(): boolean {
    return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
}
