import { NextRequest } from "next/server";

import { proxySystemTemplatePost } from "@/lib/api/system-template-routes";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ key: string; version: string }> },
) {
    const { key, version } = await params;
    return proxySystemTemplatePost(
        request,
        key,
        `/rollback/${encodeURIComponent(version)}`,
        "rollback system template",
    );
}
