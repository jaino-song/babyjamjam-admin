import axios from "axios";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const DEFAULT_DEVELOPMENT_API_URL = "http://localhost:3001";

function normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.replace(/\/+$/, "");
}

function resolveServerApiUrl(): string | undefined {
    if (isProduction) {
        return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
    }

    return (
        normalizeBaseUrl(process.env.DEVELOPMENT_API_BASE_URL) ??
        normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ??
        DEFAULT_DEVELOPMENT_API_URL
    );
}

const API_URL = resolveServerApiUrl();

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    timeout: 60000,
    validateStatus: (status) => status < 600,
    headers: {
        "Content-Type": "application/json",
    },
});
