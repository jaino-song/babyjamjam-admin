import { NextRequest } from "next/server";

import { proxySystemTemplatePost } from "@/lib/api/system-template-routes";
import { previewSystemTemplateSchema } from "@babyjamjam/shared/types/system-template";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
) {
    const { key } = await params;
    return proxySystemTemplatePost(
        request,
        key,
        "/preview",
        "preview system template",
        previewSystemTemplateSchema,
    );
}
