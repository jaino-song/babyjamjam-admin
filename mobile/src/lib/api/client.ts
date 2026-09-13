import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";

import { refreshApplicationSession } from "@/lib/auth/session-refresh";
import { getServerRuntimeConfig } from "@/lib/env";
import { captureServiceRecordError } from "@/lib/observability/capture-service-record-error";
import { safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

const API_BASE_URL = typeof window === 'undefined'
    ? getServerRuntimeConfig().backendBaseUrl
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
});

type QueueItem = {
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
};

const EFORMSIGN_TOKEN_ENDPOINT_PREFIXES = [
    "/access-token",
    "/refresh-access-token",
    "/generate-document",
    "/generate-staff-document",
    "/generate-signature",
    "/eformsign",
    "/eformsign-docs",
];

export function isEformsignTokenEndpoint(url?: string): boolean {
    if (!url) return false;

    return EFORMSIGN_TOKEN_ENDPOINT_PREFIXES.some((prefix) => (
        url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)
    ));
}

function isAppAuthRefreshRequiredError(error: AxiosError): boolean {
    const data = error.response?.data;
    return Boolean(
        data
        && typeof data === "object"
        && (data as { code?: string }).code === "AUTH_REFRESH_REQUIRED",
    );
}

// Token refresh state management
let isEformsignRefreshing = false;
const eformsignFailedQueue: QueueItem[] = [];

const processQueue = (queue: QueueItem[], error: AxiosError | null = null) => {
    queue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve();
        }
    });
    queue.length = 0;
};

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
    (err: AxiosError) => Promise.reject(err),
);

api.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
        const originalRequest = err.config as AxiosRequestConfig & {
            _networkRetry?: boolean;
            _appAuthRetry?: boolean;
            _eformsignRetry?: boolean;
        };
        const originalRequestMethod = (originalRequest?.method ?? "get").toLowerCase();

        // Network error - single retry
        if (
            err.message === "Network Error" &&
            originalRequest &&
            !originalRequest._networkRetry &&
            (originalRequestMethod === "get" || originalRequestMethod === "head")
        ) {
            originalRequest._networkRetry = true;
            return api(originalRequest);
        }

        // 401 Unauthorized
        if (err.response?.status === 401 && originalRequest) {
            const url = originalRequest.url || '';
            const isAppAuthFailure = isAppAuthRefreshRequiredError(err);

            // Don't retry auth refresh endpoint itself
            if (url.includes('/auth/refresh')) {
                return Promise.reject(err);
            }

            // Don't retry token refresh endpoints themselves
            if (url.includes('access-token') || url.includes('refresh-access-token')) {
                return Promise.reject(err);
            }

            // For eformsign endpoints, try token refresh
            if (isEformsignTokenEndpoint(url) && !isAppAuthFailure && !originalRequest._eformsignRetry) {
                originalRequest._eformsignRetry = true;
                if (isEformsignRefreshing) {
                    return new Promise((resolve, reject) => {
                        eformsignFailedQueue.push({ resolve, reject });
                    }).then(() => axios(originalRequest));
                }

                isEformsignRefreshing = true;

                try {
                    const executionTime = Date.now();
                    await api.post('/refresh-access-token', { executionTime });
                    
                    if (typeof window !== 'undefined') {
                        safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
                    }

                    processQueue(eformsignFailedQueue);
                    return axios(originalRequest);
                } catch (refreshError) {
                    processQueue(eformsignFailedQueue, refreshError as AxiosError);
                    if (typeof window !== 'undefined') {
                        safeStorageRemoveItem("session", "eformsign_auth_time");
                    }
                    // Don't redirect to login for eformsign auth failures
                    return Promise.reject(refreshError);
                } finally {
                    isEformsignRefreshing = false;
                }
            }

            if (typeof window === 'undefined') {
                return Promise.reject(err);
            }

            const shouldAttemptAppRefresh = isAppAuthFailure || !isEformsignTokenEndpoint(url);
            if (!shouldAttemptAppRefresh || originalRequest._appAuthRetry) {
                return Promise.reject(err);
            }

            originalRequest._appAuthRetry = true;

            try {
                await refreshApplicationSession();
                return api(originalRequest);
            } catch (refreshError) {
                return Promise.reject(refreshError);
            }
        }

        captureServiceRecordError(err);
        return Promise.reject(err);
    }
);
