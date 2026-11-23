import { NextResponse, NextRequest } from "next/server";
import { ACCOUNT_LINK_VERSION, ACCOUNT_LINK_VERSION_HEADER } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const capability = request.headers.get(ACCOUNT_LINK_VERSION_HEADER) === ACCOUNT_LINK_VERSION
            ? { headers: { [ACCOUNT_LINK_VERSION_HEADER]: ACCOUNT_LINK_VERSION } }
            : undefined;
        const { data, status } = await serverAPIClient.post("/auth/register", body, capability);

        return NextResponse.json(data, { status });
    } catch (error) {
        return errorResponse(error, "register account");
    }
}
