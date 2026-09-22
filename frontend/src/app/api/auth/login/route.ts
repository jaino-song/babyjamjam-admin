import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

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
        return errorResponse(error, "log in");
    }
}
