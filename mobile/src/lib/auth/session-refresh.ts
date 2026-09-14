import { isPublicAuthPath } from "@/lib/auth/routes";
import { resetAuthorityState } from "@/lib/auth/authority-state";

type RefreshErrorBody = {
    code?: string;
    error?: string;
    message?: string;
};

class ApplicationSessionRefreshError extends Error {
    constructor(
        readonly status: number,
        readonly code?: string,
    ) {
        super("Application session refresh failed");
        this.name = "ApplicationSessionRefreshError";
    }
}

let refreshPromise: Promise<void> | null = null;
let isRedirectingToLogin = false;

function retryAfterMilliseconds(response: Response): number {
    const seconds = Number(response.headers.get("Retry-After"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

async function redirectToLoginOnce(): Promise<void> {
    if (typeof window === "undefined" || isRedirectingToLogin) return;

    const currentPath = window.location.pathname;
    if (isPublicAuthPath(currentPath) || currentPath.startsWith("/service-record")) return;

    isRedirectingToLogin = true;
    await resetAuthorityState(undefined, { waitForCancellation: false });
    window.location.href = "/login";
}

async function performApplicationSessionRefresh(): Promise<void> {
    const response = await fetch("/api/auth/refresh", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
    });
    if (response.ok) return;

    const body = await response.json().catch(() => null) as RefreshErrorBody | null;
    if (
        response.status === 409
        && body?.code === "AUTH_REFRESH_REPLAY_CONCURRENT"
    ) {
        await new Promise((resolve) => {
            setTimeout(resolve, retryAfterMilliseconds(response));
        });
        return;
    }

    throw new ApplicationSessionRefreshError(response.status, body?.code);
}

export function refreshApplicationSession(): Promise<void> {
    if (!refreshPromise) {
        refreshPromise = performApplicationSessionRefresh()
            .catch(async (error) => {
                await redirectToLoginOnce();
                throw error;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
}
