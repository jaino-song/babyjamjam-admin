import { NextResponse } from "next/server";

export function GET() {
    return NextResponse.json(
        { error: "Legacy token callback is disabled" },
        { status: 410 },
    );
}
