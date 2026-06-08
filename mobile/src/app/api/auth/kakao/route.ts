import { NextResponse } from "next/server";

import { BACKEND_BASE_URL } from "@/lib/api/server";

export async function GET() {
    return NextResponse.redirect(new URL("/auth/kakao", BACKEND_BASE_URL));
}
