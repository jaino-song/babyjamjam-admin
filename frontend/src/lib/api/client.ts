import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";
import { isPublicAuthPath } from "@/lib/auth/routes";
import { safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

const API_BASE_URL = typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL)
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
});

// Token refresh state management
let isRefreshing = false;
let isRedirectingToLogin = false;
let failedQueue: Array<{
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: AxiosError | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve();
        }
    });
    failedQueue = [];
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
        const originalRequest = err.config as AxiosRequestConfig & { _retry?: boolean };

        // Network error - single retry
        if (err.message === "Network Error" && originalRequest && !originalRequest._retry) {
            originalRequest._retry = true;
            return axios(originalRequest);
        }

        // 401 Unauthorized - handle eformsign token refresh only for eformsign-related endpoints
        if (err.response?.status === 401 && originalRequest && !originalRequest._retry) {
            const url = originalRequest.url || '';
            
            // Only handle eformsign-related endpoints with token refresh
            const isEformsignEndpoint = url.includes('/documents') || 
                url.includes('/access-token') || 
                url.includes('/refresh-access-token') ||
                url.includes('/generate-document') ||
                url.includes('/generate-staff-document') ||
                url.includes('/generate-signature');
            
            // Don't retry token refresh endpoints themselves
            if (url.includes('access-token') || url.includes('refresh-access-token')) {
                return Promise.reject(err);
            }

            // For eformsign endpoints, try token refresh
            if (isEformsignEndpoint) {
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
                    processQueue(refreshError as AxiosError);
                    if (typeof window !== 'undefined') {
                        safeStorageRemoveItem("session", "eformsign_auth_time");
                    }
                    // Don't redirect to login for eformsign auth failures
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            }
            
            // For non-eformsign 401 errors (main auth failure), redirect to login
            // But don't redirect if already on an auth page (login, register, etc.)
            if (typeof window !== 'undefined' && !isRedirectingToLogin) {
                const currentPath = window.location.pathname;
                const isAuthPage = isPublicAuthPath(currentPath);
                if (!isAuthPage) {
                    isRedirectingToLogin = true;
                    window.location.href = '/login';
                }
            }
            return Promise.reject(err);
        }

        return Promise.reject(err);
    }
);
