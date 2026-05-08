const DEFAULT_DEVELOPMENT_API_URL = "http://localhost:3001";

function normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.replace(/\/+$/, "");
}

export function resolveServerApiUrl(): string | undefined {
    const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

    if (isProduction) {
        return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
    }

    return (
        normalizeBaseUrl(process.env.DEVELOPMENT_API_BASE_URL) ??
        normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ??
        DEFAULT_DEVELOPMENT_API_URL
    );
}

export function createServerApiUrl(pathname: string): string {
    const baseUrl = resolveServerApiUrl();
    if (!baseUrl) {
        throw new Error("Server API URL is not configured");
    }

    return new URL(pathname, `${baseUrl}/`).toString();
}
