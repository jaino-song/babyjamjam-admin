import {
    AUTH_COOKIE_NAMES,
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    decodeRoleFromAccessToken,
    getSessionMaxAgeSeconds,
    isSecureAuthCookie,
} from "@/lib/auth/session-policy";

type SameSite = "lax" | "strict" | "none";

interface CookieOptions {
    httpOnly: boolean;
    secure: boolean;
    sameSite: SameSite;
    path: string;
    maxAge?: number;
}

interface AuthCookieStore {
    set(name: string, value: string, options: CookieOptions): void;
    delete(name: string): void;
}

interface AuthSessionInput {
    accessToken: string;
    refreshToken: string;
    autoLogin?: boolean;
}

function getBaseAuthCookieOptions(): Omit<CookieOptions, "maxAge"> {
    return {
        httpOnly: true,
        secure: isSecureAuthCookie(),
        sameSite: "lax",
        path: "/",
    };
}

export function setAuthSessionCookies(
    cookieStore: AuthCookieStore,
    { accessToken, refreshToken, autoLogin = true }: AuthSessionInput,
): void {
    const role = decodeRoleFromAccessToken(accessToken);
    const maxAge = getSessionMaxAgeSeconds(role);
    const baseOptions = getBaseAuthCookieOptions();

    if (autoLogin) {
        cookieStore.set(AUTH_COOKIE_NAMES.accessToken, accessToken, {
            ...baseOptions,
            maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
        });
        cookieStore.set(AUTH_COOKIE_NAMES.refreshToken, refreshToken, {
            ...baseOptions,
            maxAge,
        });
        cookieStore.set(AUTH_COOKIE_NAMES.autoLogin, "1", {
            ...baseOptions,
            maxAge,
        });
        return;
    }

    cookieStore.set(AUTH_COOKIE_NAMES.accessToken, accessToken, baseOptions);
    cookieStore.set(AUTH_COOKIE_NAMES.refreshToken, refreshToken, baseOptions);
    cookieStore.set(AUTH_COOKIE_NAMES.autoLogin, "0", baseOptions);
}

export function setAuthAccessCookie(
    cookieStore: AuthCookieStore,
    accessToken: string,
    autoLogin = true,
): void {
    const baseOptions = getBaseAuthCookieOptions();

    cookieStore.set(
        AUTH_COOKIE_NAMES.accessToken,
        accessToken,
        autoLogin
            ? { ...baseOptions, maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS }
            : baseOptions,
    );
}

export function clearAuthSessionCookies(cookieStore: AuthCookieStore): void {
    cookieStore.delete(AUTH_COOKIE_NAMES.accessToken);
    cookieStore.delete(AUTH_COOKIE_NAMES.refreshToken);
    cookieStore.delete(AUTH_COOKIE_NAMES.autoLogin);
}
