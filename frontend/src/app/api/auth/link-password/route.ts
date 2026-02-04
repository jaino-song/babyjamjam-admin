import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { getAuthToken } from "@/app/lib/api/route-utils";
import { AxiosError } from "axios";

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/link-password", body, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        return NextResponse.json(data, { status });
    } catch (error) {
        console.error("[Auth Link Password] Error:", error);

        if (error instanceof AxiosError) {
            const status = error.response?.status || 500;
            const responseData = error.response?.data;

            if (responseData) {
                return NextResponse.json(responseData, { status });
            }

            return NextResponse.json(
                { error: error.message || "Request failed" },
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
