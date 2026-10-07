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

        // A resolved failure body goes through the same sanitized boundary as a
        // thrown upstream error: problem bodies keep their code, plain business
        // messages survive, diagnostic text is replaced. A failure must never be
        // an HTTP 2xx/3xx, so a non-error status (e.g. 200 {success:false}) is 401.
        if (!data.success || !data.accessToken) {
            const failureStatus = status >= 400 ? status : 401;
            return errorResponse({ response: { status: failureStatus, data } }, "log in");
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
