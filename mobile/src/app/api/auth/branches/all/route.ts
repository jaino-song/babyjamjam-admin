import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

export async function GET() {
    try {
        const { data, status } = await serverAPIClient.get("/auth/branches/all");
        return NextResponse.json(data, { status });
    } catch (error) {
        return errorResponse(error, "load branches", "read");
    }
}
