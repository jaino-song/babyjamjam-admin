import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: "access" | "refresh";
}

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data, status } = await serverAPIClient.post("/auth/login", body);

        // If login failed, return the response
        if (!data.success || !data.accessToken) {
            return NextResponse.json(data, { status: status || 401 });
        }

        // Set auth cookies on successful login
        const cookieStore = await cookies();

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("Failed to decode token");
        }

        const isPrivileged = ["owner", "admin", "manager"].includes(role);

        cookieStore.set("auth_token", data.accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: isPrivileged ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        });

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: isPrivileged ? 7 * 24 * 60 * 60 : 1 * 24 * 60 * 60,
        });

        return NextResponse.json({
            success: true,
            message: "로그인 성공",
            requiresOrgSelection: data.requiresOrgSelection,
        }, { status: 200 });
    } catch (error) {
        console.error("[Auth Login] Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = axiosError.response?.status || 500;
            const responseData = axiosError.response?.data;

            if (responseData) {
                return NextResponse.json(responseData, { status });
            }

            return NextResponse.json(
                { error: axiosError.message || "Login failed" },
                { status }
            );
        }

        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
