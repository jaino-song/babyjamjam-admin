import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refreshToken");

    if (token) {
        const cookieStore = await cookies();

        try {
            cookieStore.set("auth_token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                // 'lax' is sufficient because we use a Next.js Rewrite proxy (/api/...)
                // to forward client-side requests. This treats API calls as same-site,
                // allowing the cookie to be sent securely.
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });

            if (refreshToken) {
                cookieStore.set("refresh_token", refreshToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/",
                    maxAge: 7 * 24 * 60 * 60, // 7 days
                });
            }
        } catch (error) {
            console.error("Failed to decode token:", error);
            // Fallback if setting the cookie fails
            cookieStore.set("auth_token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                // 'lax' is sufficient because we use a Next.js Rewrite proxy (/api/...)
                // to forward client-side requests. This treats API calls as same-site,
                // allowing the cookie to be sent securely.
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });

            if (refreshToken) {
                cookieStore.set("refresh_token", refreshToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/",
                    maxAge: 7 * 24 * 60 * 60,
                });
            }
        }
    }

    redirect("/dashboard");
}
