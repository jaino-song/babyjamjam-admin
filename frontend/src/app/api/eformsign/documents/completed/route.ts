import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    return proxyGetRequest(request, "/api/documents/completed", "fetch completed documents");
}
