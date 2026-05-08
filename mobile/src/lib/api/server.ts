import axios from "axios";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

export const BACKEND_BASE_URL = (isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001") ?? "";

export const serverAPIClient = axios.create({
    baseURL: BACKEND_BASE_URL,
    timeout: 60000,
    validateStatus: (status) => status < 600,
    headers: {
        "Content-Type": "application/json",
    },
});
