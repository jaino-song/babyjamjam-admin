import { NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { E2E_VAPID_PUBLIC_KEY, isE2ETest } from "@/lib/e2e";

/**
 * GET /api/notifications/vapid-key
 * Public endpoint - no auth required
 * Returns the VAPID public key needed for push notification subscription
 */
export async function GET() {
    try {
        if (isE2ETest()) {
            return NextResponse.json({ publicKey: E2E_VAPID_PUBLIC_KEY });
        }

        const response = await serverAPIClient.get("/notifications/vapid-key");
        return NextResponse.json(response.data);
    } catch (error: unknown) {
        const err = error as { message?: string; response?: { status?: number } };
        console.error("[API] Error fetching vapid key:", err.message);
        return NextResponse.json(
            { error: "Failed to fetch vapid key" },
            { status: err.response?.status || 500 }
        );
    }
}
