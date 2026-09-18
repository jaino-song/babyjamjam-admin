import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

export function jsonResponse(body: unknown, status: number): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export { serverAPIClient };
