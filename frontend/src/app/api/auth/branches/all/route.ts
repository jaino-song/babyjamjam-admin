import { NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";

export async function GET() {
    try {
        const { data, status } = await serverAPIClient.get("/auth/branches/all");

        return NextResponse.json(data, { status });
    } catch (error) {
        if (error instanceof AxiosError) {
            const status = error.response?.status || 500;
            const responseData = error.response?.data;

            if (responseData) {
                return NextResponse.json(responseData, { status });
            }

            return NextResponse.json(
                { error: error.message || "Failed to fetch branches" },
                { status },
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
}
