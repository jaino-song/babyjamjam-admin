import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email")?.trim();

    if (!email) {
      return NextResponse.json({ exists: false });
    }

    const { data, status } = await serverAPIClient.get("/auth/check-email", {
      params: { email },
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    console.error("[API] Error checking auth email:", error);
    return NextResponse.json({ exists: false });
  }
}
