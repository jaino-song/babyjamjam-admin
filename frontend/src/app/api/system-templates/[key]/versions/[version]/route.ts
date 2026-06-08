import { NextRequest } from "next/server";

import { proxySystemTemplateGet } from "@/lib/api/system-template-routes";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string; version: string }> },
) {
    const { key, version } = await params;
    return proxySystemTemplateGet(
        request,
        key,
        `/versions/${encodeURIComponent(version)}`,
        "fetch system template version",
    );
}
