import { cookies } from "next/headers";
import { jwtDecode } from "jwt-decode";
import { getServerRuntimeConfig } from "@/lib/env";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, decodeAccessBranchId, getRefreshSessionMaxAgeSeconds } from "@/lib/auth/session-policy";
interface TokenPayload { role: string | null }
function resolveAutoLoginCookieValue(autoLogin: boolean): "1" | "0" {
    return autoLogin ? "1" : "0";
}

function isAutoLoginCookieEnabled(value: string | undefined): boolean {
    return value === "1";
}

export async function writeLoginSessionCookies(data: { accessToken: string; refreshToken: string; requiresBranchSelection?: boolean }, autoLogin: boolean): Promise<void> {
 const cookieStore = await cookies();
 const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;
        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        const authCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...authCookieBaseOptions,
                maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
            });
        } else {
            cookieStore.set("auth_token", data.accessToken, authCookieBaseOptions);
        }

        const refreshCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("refresh_token", data.refreshToken, {
                ...refreshCookieBaseOptions,
                maxAge: getRefreshSessionMaxAgeSeconds(role),
            });
        } else {
            cookieStore.set("refresh_token", data.refreshToken, refreshCookieBaseOptions);
        }

        const autoLoginCookieValue = resolveAutoLoginCookieValue(autoLogin);
        const autoLoginEnabled = isAutoLoginCookieEnabled(autoLoginCookieValue);
        if (autoLoginEnabled) {
            cookieStore.set("auto_login", autoLoginCookieValue, {
                ...authCookieBaseOptions,
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.set("auto_login", autoLoginCookieValue, authCookieBaseOptions);
        }

        // middleware.ts gates every non-auth route on the selected_branch_id
        // cookie. When the backend has already resolved a single accessible
        // branch into the access token (requiresBranchSelection is false),
        // reflect that branch here now — otherwise the user is bounced
        // through /select-branch on the very next navigation.
        //
        // Every other case must CLEAR the cookie: this token carries no
        // authorised branch, and a stale value left by a previous account on
        // this device would otherwise satisfy the middleware gate and wave
        // this login through to /dashboard with someone else's branch.
        const branchId = data.requiresBranchSelection
            ? null
            : decodeAccessBranchId(data.accessToken);
        if (branchId) {
            cookieStore.set("selected_branch_id", branchId, {
                httpOnly: false,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.delete("selected_branch_id");
        }

}
