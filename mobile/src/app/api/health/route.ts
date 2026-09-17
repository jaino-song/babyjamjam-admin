import { NextResponse } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { NO_STORE_CACHE_CONTROL } from "@babyjamjam/shared/api";

import { serverAPIClient } from "@/lib/api/server";

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function createLocalRequestId(): string {
    try {
        const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
        if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
            const requestId = cryptoObject.randomUUID();
            if (SAFE_REQUEST_ID_PATTERN.test(requestId)) {
                return requestId;
            }
        }
    } catch {
        // Runtime crypto can be unavailable in older Next.js test environments.
    }

    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Health-specific problem response: the registered problem contract is the
 * body's error identity (code/status/type/requestId), while the endpoint's
 * operational diagnostics (timestamp, backend reachability) ride along as
 * extension members so monitoring keeps its payload. The RFC 9457 `status`
 * member supersedes the legacy `status: "error"` string.
 */
function diagnosticProblemResponse(
    code: "INTERNAL_ERROR" | "DEPENDENCY_UNAVAILABLE",
    diagnostics: Record<string, unknown>,
): NextResponse {
    const problem = createProblemDetails({
        code,
        requestId: createLocalRequestId(),
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    const response = NextResponse.json(
        { ...problem, error: problem.detail, ...diagnostics },
        { status: problem.status },
    );
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    response.headers.set("Content-Type", "application/problem+json");
    response.headers.set("Content-Language", "ko-KR");
    response.headers.set("X-Request-Id", problem.requestId);
    return response;
}

export async function GET() {
    // Test 1: Check if backend URL is configured
    if (!serverAPIClient.defaults.baseURL) {
        return diagnosticProblemResponse("INTERNAL_ERROR", {
            timestamp: new Date().toISOString(),
            message: "Backend URL not configured",
        });
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
            timestamp: new Date().toISOString(),
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

        return diagnosticProblemResponse("DEPENDENCY_UNAVAILABLE", {
            timestamp: new Date().toISOString(),
            message: "Backend unreachable",
            backend: {
                reachable: false,
            },
        });
    }
}
