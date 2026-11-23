import { createHash } from "node:crypto";
import type { cookies } from "next/headers";

export const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_KAKAO_SIGNUP_COOKIE = "pending_kakao_signup";
const PENDING_AUTO_LOGIN_COOKIE = "pending_account_onboarding_auto_login";
const PENDING_MAX_AGE_SECONDS = 30 * 60;

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type PendingCookieOptions = { secure: boolean; sameSite?: "lax" | "none" };

function pendingCookieOptions({ secure, sameSite = "lax" }: PendingCookieOptions) {
    return { httpOnly: true, secure, sameSite, path: "/", maxAge: PENDING_MAX_AGE_SECONDS };
}

function pendingTokenDigest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function replacePendingAccountOnboarding(
    store: Pick<CookieStore, "set" | "delete">,
    token: string,
    options: PendingCookieOptions & { autoLogin?: boolean },
): void {
    const preference = options.autoLogin === undefined
        ? undefined
        : (options.autoLogin ? "1." : "0.") + pendingTokenDigest(token);
    store.set(PENDING_ACCOUNT_ONBOARDING_COOKIE, token, pendingCookieOptions(options));
    store.delete(PENDING_KAKAO_SIGNUP_COOKIE);
    if (preference === undefined) {
        store.delete(PENDING_AUTO_LOGIN_COOKIE);
    } else {
        store.set(PENDING_AUTO_LOGIN_COOKIE, preference, pendingCookieOptions({ secure: options.secure }));
    }
}

export function replacePendingKakaoSignup(
    store: Pick<CookieStore, "set" | "delete">,
    token: string,
    options: PendingCookieOptions,
): void {
    store.set(PENDING_KAKAO_SIGNUP_COOKIE, token, pendingCookieOptions(options));
    clearPendingAccountOnboarding(store);
}

export function readPendingAccountAutoLogin(store: Pick<CookieStore, "get">, token: string): boolean {
    const preference = store.get(PENDING_AUTO_LOGIN_COOKIE)?.value;
    // A matching, explicit opt-out is the only value that overrides the persistent default.
    return !preference || preference !== "0." + pendingTokenDigest(token);
}

export function clearPendingAccountOnboarding(store: Pick<CookieStore, "delete">): void {
    store.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);
    store.delete(PENDING_AUTO_LOGIN_COOKIE);
}

export function clearPendingOnboarding(store: Pick<CookieStore, "delete">): void {
    clearPendingAccountOnboarding(store);
    store.delete(PENDING_KAKAO_SIGNUP_COOKIE);
}
