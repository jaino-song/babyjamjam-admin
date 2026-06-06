import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

export async function GET() {
    const results = {
        timestamp: new Date().toISOString(),
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
        console.info("[Health Check] Checking backend reachability");
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
                responseTime: `${duration}ms`,
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[Health Check] Backend unreachable:", message);

        return NextResponse.json({
            ...results,
            status: "error",
            message: "Backend unreachable",
            backend: {
                reachable: false,
            }
        }, { status: 503 });
    }
}
