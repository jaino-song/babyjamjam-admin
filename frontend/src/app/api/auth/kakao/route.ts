import { redirect } from "next/navigation";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const DEFAULT_DEVELOPMENT_API_URL = "http://localhost:3001";

function normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "undefined") {
        return undefined;
    }

    return trimmed.replace(/\/+$/, "");
}

function resolveKakaoAuthBaseUrl(): string {
    if (isProduction) {
        return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ?? DEFAULT_DEVELOPMENT_API_URL;
    }

    return (
        normalizeBaseUrl(process.env.DEVELOPMENT_API_BASE_URL) ??
        normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) ??
        DEFAULT_DEVELOPMENT_API_URL
    );
}

export async function GET() {
    redirect(`${resolveKakaoAuthBaseUrl()}/auth/kakao`);
}
