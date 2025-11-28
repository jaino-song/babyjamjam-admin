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
    error: string;
}

const isProduction = process.env.NODE_ENV === "production";
const API_URL = isProduction ? process.env.NEXT_PUBLIC_API_URL : process.env.DEVELOPMENT_API_URL;

export async function POST(request: NextRequest) {
    try {
        const { code } = await request.json();

        if (!code) {
            return NextResponse.json({ error: "Authorization Code Required" }, { status: 400 });
        }

        const { data } = await serverAPIClient.post("/auth/token", { code });

        const cookieStore = await cookies();

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        }
        catch {
            console.error("Failed to decode token");
        }

        cookieStore.set("access_token", data.accessToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
            path: "/",
            maxAge: data.token.role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60, // 7 days
        })

        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60, // 7 days
        })
        return NextResponse.json({ message: "Success" }, { status: 200 });
    } catch (error) {
        console.error("Token Exchange Error: ", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            const status = axiosError.response?.status || 500;
            const message = axiosError.response?.data?.error || "Token Exchange Failed";
            return NextResponse.json({ error: message }, { status });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}