import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/app/lib/api/route-utils";

export async function GET(request: NextRequest) {
    return proxyGetRequest(request, "/api/documents/rejected", "fetch rejected documents");
}
