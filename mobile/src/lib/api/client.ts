import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";

import { refreshApplicationSession } from "@/lib/auth/session-refresh";
import { getServerRuntimeConfig } from "@/lib/env";
import { captureServiceRecordError } from "@/lib/observability/capture-service-record-error";

const API_BASE_URL = typeof window === 'undefined'
    ? getServerRuntimeConfig().backendBaseUrl
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
});

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

            // Don't retry auth refresh endpoint itself
            if (url.includes('/auth/refresh')) {
                return Promise.reject(err);
            }

            // Don't retry token refresh endpoints themselves
            if (url.includes('access-token') || url.includes('refresh-access-token')) {
                return Promise.reject(err);
            }

            if (typeof window === 'undefined') {
                return Promise.reject(err);
            }

            if (originalRequest._appAuthRetry) {
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
