import { NextRequest, NextResponse } from "next/server";

import {
    proxySystemTemplateGet,
    proxySystemTemplatePut,
} from "@/lib/api/system-template-routes";
import { updateSystemTemplateSchema } from "@babyjamjam/shared/types/system-template";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
    const { key } = await params;
    return proxySystemTemplateGet(request, key, "", "fetch system template");
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
    const { key } = await params;
    return proxySystemTemplatePut(
        request,
        key,
        "update system template",
        updateSystemTemplateSchema,
    );
}
