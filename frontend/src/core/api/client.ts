import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";

const API_BASE_URL = typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL)
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
    withCredentials: true,
});

// Token refresh state management
let isRefreshing = false;
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

        // 401 Unauthorized - try token refresh
        if (err.response?.status === 401 && originalRequest && !originalRequest._retry) {
            // Don't retry token refresh endpoints
            if (originalRequest.url?.includes('access-token') || 
                originalRequest.url?.includes('refresh-access-token')) {
                return Promise.reject(err);
            }

            if (isRefreshing) {
                // If already refreshing, queue this request
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                }).then(() => axios(originalRequest));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                // Attempt to refresh the token
                const executionTime = Date.now();
                await api.post('/refresh-access-token', { executionTime });
                
                // Update sessionStorage auth time
                if (typeof window !== 'undefined') {
                    sessionStorage.setItem("eformsign_auth_time", executionTime.toString());
                }

                processQueue();
                return axios(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError as AxiosError);
                
                // Clear auth state and redirect to login
                if (typeof window !== "undefined") {
                    sessionStorage.removeItem("eformsign_auth_time");
                    if (!window.location.pathname.includes("/login")) {
                        window.location.href = "/login";
                    }
                }
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(err);
    }
);
