import axios from "axios";
import { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const API_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    timeout: 60000,
    validateStatus: (status) => status < 600,
    headers: {
        "Content-Type": "application/json",
    },
});

/**
 * Helper to extract auth token from request cookies
 */
export function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}
