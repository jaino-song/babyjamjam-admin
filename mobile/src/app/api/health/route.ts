import { NextResponse } from "next/server";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";

export async function GET() {
    const results = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        backendURL: serverAPIClient.defaults.baseURL,
        hasBackendURL: !!serverAPIClient.defaults.baseURL,
    };

    // Test 1: Check if backend URL is configured
    if (!serverAPIClient.defaults.baseURL) {
        return NextResponse.json({
            ...results,
            status: "error",
            message: "Backend URL not configured",
        }, { status: 500 });
    }

    // Test 2: Try to reach backend health endpoint
    try {
        console.info("[Health Check] Trying to reach backend at:", serverAPIClient.defaults.baseURL);
        const startTime = Date.now();

        const response = await serverAPIClient.get("/", {
            timeout: 10000, // 10 second timeout for health check
        });

        const duration = Date.now() - startTime;

        return NextResponse.json({
            ...results,
            status: "success",
            backend: {
                reachable: true,
                status: response.status,
                statusText: response.statusText,
                data: response.data,
                responseTime: `${duration}ms`,
            }
        });
    } catch (error) {
        const axiosError = error instanceof AxiosError ? error : null;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[Health Check] Backend unreachable:", message);

        return NextResponse.json({
            ...results,
            status: "error",
            message: "Backend unreachable",
            backend: {
                reachable: false,
                error: message,
                code: axiosError?.code,
            }
        }, { status: 503 });
    }
}
