import { NextRequest, NextResponse } from "next/server";

const CURRENT_API_BASE_URL = process.env.CURRENT_API_BASE_URL?.trim()
    || "https://api.babyjamjam.com";

export async function GET(request: NextRequest) {
    const authToken = request.cookies.get("auth_token")?.value;

    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const response = await fetch(`${CURRENT_API_BASE_URL}/eformsign-docs/client-names`, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${authToken}`,
            },
            cache: "no-store",
        });
        const data: unknown = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch document client names";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
