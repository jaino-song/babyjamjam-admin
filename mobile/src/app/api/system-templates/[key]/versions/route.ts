import { NextRequest } from "next/server";

import { proxySystemTemplateGet } from "@/lib/api/system-template-routes";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
) {
    const { key } = await params;
    return proxySystemTemplateGet(request, key, "/versions", "fetch system template versions");
}
