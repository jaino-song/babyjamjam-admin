import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: 'access' | 'refresh';
    iat: number;
    exp: number;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refreshToken");
    const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

    if (token) {
        const cookieStore = await cookies();

        try {
            const decoded = jwtDecode<TokenPayload>(token);
            const role = decoded.role || "user";

            // Calculate maxAge based on role
            // owner: 30 days (30 * 24 * 60 * 60)
            // others: 3 days (3 * 24 * 60 * 60)
            const maxAge = role === "owner"
                ? 30 * 24 * 60 * 60
                : 3 * 24 * 60 * 60;

            cookieStore.set("auth_token", token, {
                httpOnly: true,
                secure: isSecureCookie,
                // 'lax' is sufficient because we use a Next.js Rewrite proxy (/api/...)
                // to forward client-side requests. This treats API calls as same-site,
                // allowing the cookie to be sent securely.
                sameSite: "lax",
                path: "/",
                maxAge: maxAge,
            });

            if (refreshToken) {
                cookieStore.set("refresh_token", refreshToken, {
                    httpOnly: true,
                    secure: isSecureCookie,
                    sameSite: "lax",
                    path: "/",
                    maxAge: 7 * 24 * 60 * 60, // 7 days
                });
            }
        } catch (error) {
            console.error("Failed to decode token:", error);
            // Fallback to default 3 days if decoding fails
            cookieStore.set("auth_token", token, {
                httpOnly: true,
                secure: isSecureCookie,
                // 'lax' is sufficient because we use a Next.js Rewrite proxy (/api/...)
                // to forward client-side requests. This treats API calls as same-site,
                // allowing the cookie to be sent securely.
                sameSite: "lax",
                path: "/",
                maxAge: 3 * 24 * 60 * 60,
            });

            if (refreshToken) {
                cookieStore.set("refresh_token", refreshToken, {
                    httpOnly: true,
                    secure: isSecureCookie,
                    sameSite: "lax",
                    path: "/",
                    maxAge: 7 * 24 * 60 * 60,
                });
            }
        }
    }

    redirect("/dashboard");
}
