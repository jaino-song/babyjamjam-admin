import { NextResponse } from "next/server";

// Mirrors the mobile/clients pattern: only positive integers count as route ids.
export function isValidEmployeeId(id: string | null): id is string {
    return Boolean(id && /^[1-9]\d*$/.test(id));
}

export function invalidEmployeeIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
}
