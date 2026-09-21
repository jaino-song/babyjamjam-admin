import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";

import { isPublicAuthPath } from "@/lib/auth/routes";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { captureApiError } from "@/lib/observability/capture-api-error";
import { safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

const API_BASE_URL = typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL)
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
});

// Keep eformsign token refresh and application-session refresh single-flight independently.
let isRefreshing = false;
let isRedirectingToLogin = false;
let appAuthRefreshPromise: Promise<void> | null = null;
let failedQueue: Array<{
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}> = [];

const EFORMSIGN_REFRESH_PATHS = [
    "/access-token",
    "/refresh-access-token",
] as const;

const EFORMSIGN_REQUEST_PATHS = [
    "/eformsign/",
    "/api/eformsign/",
    "/generate-document",
    "/api/generate-document",
    "/generate-staff-document",
    "/api/generate-staff-document",
    "/generate-signature",
    "/api/generate-signature",
] as const;

const APP_AUTH_NON_RETRY_PATHS = [
    "/auth/login",
    "/auth/token",
    "/auth/refresh",
    "/auth/logout",
] as const;

const EFORMSIGN_CREDENTIAL_REAUTH_STATUSES = new Set([400, 401, 403]);

const processQueue = (error: unknown = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve();
        }
    });
    failedQueue = [];
};

function isTransportFailure(error: AxiosError): boolean {
    // No response means the request never received a server reply (network
    // drop, DNS, CORS, timeout). Compare transport state — never the raw
    // "Network Error" message text — so any axios wording change cannot
    // silently disable the single safe-method retry.
    if (!error.response) return true;
    return typeof error.code === "string" && TRANSPORT_RETRY_CODES.has(error.code);
}

const TRANSPORT_RETRY_CODES = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EAI_AGAIN",
]);

function getRequestPath(config: AxiosRequestConfig | undefined): string {
    const url = config?.url ?? "";
    if (!url) return "";

    try {
        return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname;
    } catch {
        return url;
    }
}

function isEformsignRefreshPath(pathname: string): boolean {
    return EFORMSIGN_REFRESH_PATHS.some((path) => pathname === path || pathname.endsWith(path));
}

function isEformsignRequestPath(pathname: string): boolean {
    return EFORMSIGN_REQUEST_PATHS.some((path) => pathname === path || pathname.startsWith(path));
}

function isAppAuthNonRetryPath(pathname: string): boolean {
    return APP_AUTH_NON_RETRY_PATHS.some((path) => pathname === path || pathname.endsWith(path));
}

export function refreshAppAuthSession(): Promise<void> {
    if (!appAuthRefreshPromise) {
        appAuthRefreshPromise = axios
            .post("/api/auth/refresh", undefined, { withCredentials: true })
            .then(() => undefined)
            .finally(() => {
                appAuthRefreshPromise = null;
            });
    }
    return appAuthRefreshPromise;
}

function readProblemCode(data: unknown): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
}

function readErrorText(data: unknown): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const record = data as { error?: unknown; message?: unknown };
    const message = record.error ?? record.message;
    return typeof message === "string" && message.length > 0 ? message : undefined;
}

function isAppAuthRequiredError(error: AxiosError): boolean {
    const data = error.response?.data;
    const code = readProblemCode(data);
    if (code !== undefined) {
        // Problem-contract bodies carry the registered code; compare it
        // instead of matching the legacy English message text.
        return code === "AUTH_REQUIRED";
    }
    // GAP (BJJ-319 6.1f): legacy BFF 401 bodies (`unauthorizedResponse`) carry
    // no registered code, so the message prefix remains as a fallback until a
    // BFF unit authors `{code: "AUTH_REQUIRED"}` into those bodies. BFF routes
    // and packages/shared are out of scope for this unit.
    const message = readErrorText(data);
    return message !== undefined && message.startsWith("Authentication required.");
}

function shouldAuthenticateEformsignFromCredentials(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const status = (error as { response?: { status?: unknown } }).response?.status;
    return typeof status === "number" && EFORMSIGN_CREDENTIAL_REAUTH_STATUSES.has(status);
}

async function redirectToLoginOnce() {
    if (typeof window === "undefined" || isRedirectingToLogin) return;
    const currentPath = window.location.pathname;
    const isAuthPage = isPublicAuthPath(currentPath);
    if (isAuthPage) return;

    isRedirectingToLogin = true;
    await resetAuthorityState(undefined, { waitForCancellation: false });
    window.location.href = "/login";
}

api.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        // If the request is made from the server, get the token from the headers
        if (typeof document === "undefined" && config.headers?.cookie) {
            const cookieMap = parse(config.headers.cookie as string);
            const token = cookieMap.auth_token;
            if (token) {
                config.headers = config.headers ?? {};
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (err: AxiosError) => {
        captureApiError(err);
        return Promise.reject(err);
    },
);

api.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
        const originalRequest = err.config as AxiosRequestConfig & {
            _retry?: boolean;
            _appAuthRetry?: boolean;
        };
        const originalRequestMethod = (originalRequest?.method ?? "get").toLowerCase();

        // Network error - single retry
        if (
            isTransportFailure(err) &&
            originalRequest &&
            !originalRequest._retry &&
            (originalRequestMethod === "get" || originalRequestMethod === "head")
        ) {
            originalRequest._retry = true;
            try {
                return await axios(originalRequest);
            } catch (retryError) {
                captureApiError(retryError);
                return Promise.reject(retryError);
            }
        }

        // 401 Unauthorized - refresh the relevant session once, then replay the request.
        if (err.response?.status === 401 && originalRequest && !originalRequest._retry) {
            const requestPath = getRequestPath(originalRequest);
            const isEformsignEndpoint = isEformsignRequestPath(requestPath);
            const isAppAuthFailure = isAppAuthRequiredError(err);
            
            // Don't retry an eformsign refresh failure unless the actual failure
            // is the application's expired login session.
            if (isEformsignRefreshPath(requestPath) && !isAppAuthFailure) {
                return Promise.reject(err);
            }

            // For eformsign endpoints, try token refresh
            if (isEformsignEndpoint && !isAppAuthFailure) {
                if (isRefreshing) {
                    return new Promise((resolve, reject) => {
                        failedQueue.push({ resolve, reject });
                    }).then(() => axios(originalRequest));
                }

                originalRequest._retry = true;
                isRefreshing = true;

                try {
                    const executionTime = Date.now();
                    await api.post('/refresh-access-token', { executionTime });
                    
                    if (typeof window !== 'undefined') {
                        safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
                    }

                    processQueue();
                    return axios(originalRequest);
                } catch (refreshError) {
                    captureApiError(refreshError);

                    if (shouldAuthenticateEformsignFromCredentials(refreshError)) {
                        try {
                            const authenticationTime = Date.now();
                            await api.post('/access-token', { executionTime: authenticationTime });

                            if (typeof window !== 'undefined') {
                                safeStorageSetItem(
                                    "session",
                                    "eformsign_auth_time",
                                    authenticationTime.toString(),
                                );
                            }

                            processQueue();
                            return axios(originalRequest);
                        } catch (authenticationError) {
                            processQueue(authenticationError);
                            captureApiError(authenticationError);
                            if (typeof window !== 'undefined') {
                                safeStorageRemoveItem("session", "eformsign_auth_time");
                            }
                            return Promise.reject(authenticationError);
                        }
                    }

                    processQueue(refreshError);
                    if (typeof window !== 'undefined') {
                        safeStorageRemoveItem("session", "eformsign_auth_time");
                    }
                    // Don't redirect to login for eformsign auth failures
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            }

            if (originalRequest._appAuthRetry || isAppAuthNonRetryPath(requestPath)) {
                await redirectToLoginOnce();
                return Promise.reject(err);
            }

            originalRequest._appAuthRetry = true;
            try {
                await refreshAppAuthSession();
                return axios(originalRequest);
            } catch (refreshError) {
                captureApiError(refreshError);
                if ((refreshError as AxiosError | undefined)?.response?.status === 401) {
                    await redirectToLoginOnce();
                    return Promise.reject(refreshError);
                }
                // The refresh failed for a transient reason (upstream 502, network drop),
                // so the session may well still be valid — don't force a logout. But reject
                // with the caller's own 401 instead of an unrelated refresh status, so the
                // query sees the error for the endpoint it actually requested.
                return Promise.reject(err);
            }
        }

        captureApiError(err);
        return Promise.reject(err);
    }
);
