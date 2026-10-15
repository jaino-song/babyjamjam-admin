import type { NextRequest } from "next/server";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface LocalAutoLoginSession {
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection: boolean;
}

// Credentials stay in the server environment; this module is only used by middleware.ts.
export async function tryLocalAutoLogin(
    request: NextRequest,
    backendBaseUrl: string,
): Promise<LocalAutoLoginSession | null> {
    if (
        process.env.NODE_ENV !== "development"
        || process.env.VERCEL
        || process.env.VERCEL_ENV
        || process.env.RAILWAY_ENVIRONMENT_ID
        || process.env.RAILWAY_ENVIRONMENT_NAME
        || request.method !== "GET"
        || request.headers.get("sec-fetch-site") === "cross-site"
        || request.cookies.has("auth_token")
        || request.cookies.has("refresh_token")
    ) {
        return null;
    }

    const email = process.env.LOCAL_AUTO_LOGIN_EMAIL;
    const password = process.env.LOCAL_AUTO_LOGIN_PASSWORD;
    if (!email || !password) {
        return null;
    }

    try {
        const frontend = new URL(request.url);
        const backend = new URL(backendBaseUrl);
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

        const response = await fetch(new URL("/auth/login", backend), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            return null;
        }

        const session = await response.json() as {
            success?: boolean;
            accessToken?: string;
            refreshToken?: string;
            requiresBranchSelection?: boolean;
        };
        if (
            session.success !== true
            || typeof session.accessToken !== "string"
            || !session.accessToken
            || typeof session.refreshToken !== "string"
            || !session.refreshToken
        ) {
            return null;
        }

        const branchSession = await selectLocalAutoLoginBranch(backend, session.accessToken)
            .catch(() => null);
        return branchSession ?? {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            requiresBranchSelection: session.requiresBranchSelection === true,
        };
    } catch {
        // Do not log fetch errors: they can contain the credential-bearing request.
        return null;
    }
}

/**
 * Optional LOCAL_AUTO_LOGIN_BRANCH_NAME: select that branch (exact name) right after the
 * automatic login, so the session skips /select-branch. Any failure keeps the plain session.
 */
async function selectLocalAutoLoginBranch(
    backend: URL,
    accessToken: string,
): Promise<LocalAutoLoginSession | null> {
    const branchName = process.env.LOCAL_AUTO_LOGIN_BRANCH_NAME?.trim();
    if (!branchName) {
        return null;
    }

    const headers = { Authorization: `Bearer ${accessToken}` };
    const branchesResponse = await fetch(new URL("/auth/branches", backend), {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
    });
    if (!branchesResponse.ok) {
        return null;
    }
    const { branches } = await branchesResponse.json() as {
        branches?: Array<{ id?: string; name?: string }>;
    };
    const branchId = branches?.find((branch) => branch.name === branchName)?.id;
    if (!branchId) {
        return null;
    }

    const selectResponse = await fetch(new URL("/auth/select-branch", backend), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
    });
    if (!selectResponse.ok) {
        return null;
    }
    const selected = await selectResponse.json() as { accessToken?: string; refreshToken?: string };
    if (
        typeof selected.accessToken !== "string"
        || !selected.accessToken
        || typeof selected.refreshToken !== "string"
        || !selected.refreshToken
    ) {
        return null;
    }

    return {
        accessToken: selected.accessToken,
        refreshToken: selected.refreshToken,
        requiresBranchSelection: false,
    };
}
