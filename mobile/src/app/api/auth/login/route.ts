import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
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
        const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("Failed to decode token");
        }

        const isPrivileged = ["owner", "admin", "manager"].includes(role);

        const baseCookieOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax" as const,
            path: "/",
        };

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...baseCookieOptions,
                maxAge: isPrivileged ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
            });
            cookieStore.set("refresh_token", data.refreshToken, {
                ...baseCookieOptions,
                maxAge: isPrivileged ? 7 * 24 * 60 * 60 : 1 * 24 * 60 * 60,
            });
            cookieStore.set("auto_login", "1", {
                ...baseCookieOptions,
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.set("auth_token", data.accessToken, baseCookieOptions);
            cookieStore.set("refresh_token", data.refreshToken, baseCookieOptions);
            cookieStore.set("auto_login", "0", baseCookieOptions);
        }

        return NextResponse.json({
            success: true,
            message: "로그인 성공",
            requiresBranchSelection: data.requiresBranchSelection,
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
