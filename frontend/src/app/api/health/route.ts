import { NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { logUpstreamError, upstreamStatusProblemResponse } from "@/lib/api/route-utils";

export async function GET() {
    // Test 1: Check if backend URL is configured
    if (!serverAPIClient.defaults.baseURL) {
        return upstreamStatusProblemResponse(500, "backend health check");
    }

    // Test 2: Try to reach backend health endpoint
    try {
        const startTime = Date.now();

        const response = await serverAPIClient.get("/", {
            timeout: 10000, // 10 second timeout for health check
        });

        const duration = Date.now() - startTime;

        return NextResponse.json({
            status: "success",
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            backendURL: serverAPIClient.defaults.baseURL,
            hasBackendURL: !!serverAPIClient.defaults.baseURL,
            backend: {
                reachable: true,
                status: response.status,
                statusText: response.statusText,
                data: response.data,
                responseTime: `${duration}ms`,
            }
        });
    } catch (error) {
        // The raw upstream failure (message, code, stack) never reaches the
        // client: the registered DEPENDENCY_UNAVAILABLE problem body keeps the
        // 503 status while the diagnostics stay in the server log.
        logUpstreamError("backend health check", error);
        return upstreamStatusProblemResponse(503, "backend health check");
    }
}
