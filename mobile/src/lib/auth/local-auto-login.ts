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

        const selection = await selectLocalAutoLoginBranch(backend, session.accessToken);
        if (selection.kind === "selected") {
            return selection.session;
        }
        if (selection.kind === "unknown") {
            // select-branch may have committed and revoked this login's refresh token; drop the
            // session so the next navigation signs in again instead of storing a dead token.
            return null;
        }
        return {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            requiresBranchSelection: session.requiresBranchSelection === true,
        };
    } catch {
        // Do not log fetch errors: they can contain the credential-bearing request.
        return null;
    }
}

type BranchSelection =
    | { kind: "selected"; session: LocalAutoLoginSession }
    /** Nothing was sent that could change the login session. */
    | { kind: "unchanged" }
    /** select-branch may have committed (and revoked the login refresh token) without a usable reply. */
    | { kind: "unknown" };

/**
 * Optional LOCAL_AUTO_LOGIN_BRANCH_NAME: select that branch (exact name) right after the
 * automatic login, so the session skips /select-branch. Never throws.
 */
async function selectLocalAutoLoginBranch(
    backend: URL,
    accessToken: string,
): Promise<BranchSelection> {
    const branchName = process.env.LOCAL_AUTO_LOGIN_BRANCH_NAME?.trim();
    if (!branchName) {
        return { kind: "unchanged" };
    }

    const headers = { Authorization: `Bearer ${accessToken}` };
    let branchId: string | undefined;
    try {
        const branchesResponse = await fetch(new URL("/auth/branches", backend), {
            headers,
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        });
        if (!branchesResponse.ok) {
            return { kind: "unchanged" };
        }
        const { branches } = await branchesResponse.json() as {
            branches?: Array<{ id?: string; name?: string }>;
        };
        branchId = branches?.find((branch) => branch.name === branchName)?.id;
    } catch {
        return { kind: "unchanged" };
    }
    if (!branchId) {
        return { kind: "unchanged" };
    }

    try {
        const selectResponse = await fetch(new URL("/auth/select-branch", backend), {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ branchId }),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        });
        if (!selectResponse.ok) {
            // A 4xx refusal changes nothing; a 5xx may follow a committed change.
            return selectResponse.status < 500 ? { kind: "unchanged" } : { kind: "unknown" };
        }
        const selected = await selectResponse.json() as { accessToken?: string; refreshToken?: string };
        if (
            typeof selected.accessToken !== "string"
            || !selected.accessToken
            || typeof selected.refreshToken !== "string"
            || !selected.refreshToken
        ) {
            return { kind: "unknown" };
        }
        return {
            kind: "selected",
            session: {
                accessToken: selected.accessToken,
                refreshToken: selected.refreshToken,
                requiresBranchSelection: false,
            },
        };
    } catch {
        return { kind: "unknown" };
    }
}
