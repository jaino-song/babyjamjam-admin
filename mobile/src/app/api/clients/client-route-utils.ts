import { NextResponse } from "next/server";

export function isValidClientId(id: string): boolean {
    return /^[1-9]\d*$/.test(id);
}

export function invalidClientIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
}
