import { NextRequest } from "next/server";

import { proxySystemTemplatePost } from "@/lib/api/system-template-routes";
import { validateSystemTemplateSchema } from "@babyjamjam/shared/types/system-template";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
) {
    const { key } = await params;
    return proxySystemTemplatePost(
        request,
        key,
        "/validate",
        "validate system template",
        validateSystemTemplateSchema,
    );
}
