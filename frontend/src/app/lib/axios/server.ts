import axios from "axios";
import { cookies } from "next/headers";

const isProduction = process.env.NODE_ENV === "production";
const API_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

console.log("[Server API Client] Environment:", process.env.NODE_ENV);
console.log("[Server API Client] API URL:", API_URL);

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 60000, // 60 seconds - Railway apps can take time to wake up
    validateStatus: (status) => status < 600, // Accept any status code for better error visibility
});

serverAPIClient.interceptors.request.use(async (config) => {
    if (process.env.LEGACY_DEMO_MODE === "true") {
        return Promise.reject(new Error("Backend access is disabled in legacy demo mode."));
    }

    if (!/^https?:\/\//.test(config.url ?? "") && !config.headers.has("Authorization")) {
        try {
            const token = (await cookies()).get("auth_token")?.value;
            if (token) {
                config.headers.set("Authorization", `Bearer ${token}`);
            }
        } catch {
            // cookies() is unavailable outside a request scope.
        }
    }

    return config;
});
