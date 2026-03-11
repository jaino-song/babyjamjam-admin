import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, getAuthToken, getRefreshToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    return NextResponse.json({
        hasAppAuthToken: Boolean(getAuthToken(request)),
        hasAccessToken: Boolean(getAccessToken(request)),
        hasRefreshToken: Boolean(getRefreshToken(request)),
    });
}
