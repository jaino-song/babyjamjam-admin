import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { getAuthToken } from "@/lib/api/route-utils";

type AuthErrorResponse = {
    message?: string;
};

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        
        return NextResponse.json(response.data);
    } catch (error) {
        const axiosError = error as AxiosError<AuthErrorResponse>;
        console.error("[API] Error fetching current user:", axiosError.message);
        const status = axiosError.response?.status || 500;
        const message = axiosError.response?.data?.message || "Failed to fetch user";
        return NextResponse.json({ error: message }, { status });
    }
}
