import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { autoLogin = true, ...loginPayload } = body as {
            email: string;
            password: string;
            autoLogin?: boolean;
        };
        const { data, status } = await serverAPIClient.post("/auth/login", loginPayload);

        // If login failed, return the response
        if (!data.success || !data.accessToken) {
            return NextResponse.json(data, { status: status || 401 });
        }

        // Set auth cookies on successful login
        const cookieStore = await cookies();
        setAuthSessionCookies(cookieStore, {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            autoLogin,
        });

        return NextResponse.json({
            success: true,
            message: "로그인 성공",
            requiresBranchSelection: Boolean(data.requiresBranchSelection || data.requiresOrgSelection),
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
