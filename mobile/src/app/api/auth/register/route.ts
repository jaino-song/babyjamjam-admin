import { NextResponse, NextRequest } from "next/server";
import { ACCOUNT_LINK_VERSION, ACCOUNT_LINK_VERSION_HEADER, registerRequestSchema } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    const { data, response } = await parseBody(registerRequestSchema, request);
    if (response) return response;

    try {
        const capability = request.headers.get(ACCOUNT_LINK_VERSION_HEADER) === ACCOUNT_LINK_VERSION
            ? { headers: { [ACCOUNT_LINK_VERSION_HEADER]: ACCOUNT_LINK_VERSION } }
            : undefined;
        const { data: responseData, status } = await serverAPIClient.post("/auth/register", data, capability);

        return NextResponse.json(responseData, { status });
    } catch (error) {
        return errorResponse(error, "register account");
    }
}
