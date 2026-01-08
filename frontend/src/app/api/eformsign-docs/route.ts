import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { errorResponse } from "@/app/lib/api/route-utils";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const response = await serverAPIClient.post("/eformsign-docs", body);

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "create eformsign doc record");
    }
}
