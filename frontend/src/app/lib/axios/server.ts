import axios from "axios";

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
    validateStatus: (status) => status < 400,
});

serverAPIClient.interceptors.request.use((config) => {
    if (process.env.LEGACY_DEMO_MODE === "true") {
        return Promise.reject(new Error("Backend access is disabled in legacy demo mode."));
    }

    return config;
});
