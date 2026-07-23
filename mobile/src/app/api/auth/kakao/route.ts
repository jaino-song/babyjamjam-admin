import { NextResponse } from "next/server";

import { BACKEND_BASE_URL } from "@/lib/api/server";

export async function GET() {
    const url = new URL("/auth/kakao", BACKEND_BASE_URL);
    url.searchParams.set("client", "mobile");
    return NextResponse.redirect(url);
}
