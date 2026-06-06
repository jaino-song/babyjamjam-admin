import { NextResponse } from "next/server";

import { resolveBackendBaseUrl } from "@/lib/api/server";

export async function GET() {
    const backendBaseUrl = resolveBackendBaseUrl();
    if (!backendBaseUrl) {
        return NextResponse.json(
            { error: "Backend API base URL is not configured" },
            { status: 500 },
        );
    }

    return NextResponse.redirect(new URL("/auth/kakao", backendBaseUrl));
}
