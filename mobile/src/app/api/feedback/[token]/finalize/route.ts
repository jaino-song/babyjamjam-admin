import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    const authorization = request.headers.get("authorization") ?? "";
    try {
        const response = await serverAPIClient.post("/service-feedback/finalize", {}, {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "finalize feedback");
    }
}
