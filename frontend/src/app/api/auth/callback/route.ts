import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setAuthAccessCookie, setAuthSessionCookies } from "@/lib/auth/session-cookies";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refreshToken");

    if (token) {
        const cookieStore = await cookies();

        if (refreshToken) {
            setAuthSessionCookies(cookieStore, {
                accessToken: token,
                refreshToken,
            });
        } else {
            setAuthAccessCookie(cookieStore, token);
        }
    }

    redirect("/dashboard");
}
