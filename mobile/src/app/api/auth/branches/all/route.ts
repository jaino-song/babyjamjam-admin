import { AxiosError } from "axios";
import { NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    getUpstreamErrorStatus,
    logUpstreamError,
    sanitizeUpstreamClientError,
} from "@/lib/api/route-utils";

interface BranchesErrorResponse {
    statusCode?: number;
    message?: string;
    error?: string;
    code?: string;
}

export async function GET() {
    try {
        const { data, status } = await serverAPIClient.get("/auth/branches/all");
        return NextResponse.json(data, { status });
    } catch (error) {
        logUpstreamError("Auth Branches", error);

        if (error instanceof AxiosError) {
            return NextResponse.json(
                sanitizeUpstreamClientError(
                    (error as AxiosError<BranchesErrorResponse>).response?.data,
                    "Failed to load branches",
                ),
                { status: getUpstreamErrorStatus(error) },
            );
        }

        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
