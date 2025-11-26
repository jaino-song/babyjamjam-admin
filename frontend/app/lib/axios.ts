import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { parse } from "cookie";

const API_BASE_URL =
    process.env.RAILWAY_PUBLIC_API_BASE_URL ||
    process.env.DEVELOPMENT_API_BASE_URL;

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
    withCredentials: true,
});

api.interceptors.request.use(
    (config) => {
        // If the request is made from the server, get the token from the headers
        if (typeof document === "undefined" && config.headers?.cookie) {
            const cookieMap = parse(config.headers.cookie);
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

        if (err.message === "Network Error" && originalRequest && !originalRequest._retry) {
            originalRequest._retry = true;
            return axios(originalRequest);
        }

        if (err.response?.status === 401 && originalRequest && !originalRequest._retry) {
            originalRequest._retry = true;
            if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
                window.location.href = "/login";
            }
        }

        return Promise.reject(err);
    }
);