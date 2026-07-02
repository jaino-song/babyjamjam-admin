import { NextRequest } from "next/server";

import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return proxyPostRequest(
        request,
        `/schedule-change-requests/${id}/approve`,
        "approve schedule change request",
    );
}
