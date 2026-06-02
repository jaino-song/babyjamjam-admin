import axios from "axios";

type BackendUrlEnv = Partial<Record<
    "NODE_ENV" | "VERCEL_ENV" | "NEXT_PUBLIC_API_BASE_URL" | "DEVELOPMENT_API_BASE_URL",
    string
>>;

const LOCAL_BACKEND_BASE_URL = "http://localhost:3001";

export class BackendBaseUrlConfigError extends Error {
    constructor() {
        super("Backend API base URL is not configured");
        this.name = "BackendBaseUrlConfigError";
    }
}

function isProductionLike(env: BackendUrlEnv): boolean {
    return env.NODE_ENV === "production" || env.VERCEL_ENV === "preview";
}

function normalizeBackendBaseUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        return url.toString().replace(/\/$/, "");
    } catch {
        return null;
    }
}

export function resolveBackendBaseUrl(env: BackendUrlEnv = process.env): string | null {
    const envUrl = isProductionLike(env)
        ? env.NEXT_PUBLIC_API_BASE_URL
        : env.DEVELOPMENT_API_BASE_URL || env.NEXT_PUBLIC_API_BASE_URL || LOCAL_BACKEND_BASE_URL;

    return normalizeBackendBaseUrl(envUrl);
}

export const BACKEND_BASE_URL = resolveBackendBaseUrl() ?? "";

export function requireBackendBaseUrl(): string {
    if (!BACKEND_BASE_URL) {
        throw new BackendBaseUrlConfigError();
    }
    return BACKEND_BASE_URL;
}

export const serverAPIClient = axios.create({
    baseURL: BACKEND_BASE_URL,
    timeout: 60000,
    validateStatus: (status) => status < 400,
    headers: {
        "Content-Type": "application/json",
    },
});

serverAPIClient.interceptors.request.use((config) => {
    config.baseURL = requireBackendBaseUrl();
    return config;
});
