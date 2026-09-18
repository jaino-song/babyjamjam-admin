import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../../../_proxy";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/agent/tasks/${id}/commands`, "POST", await request.json());
}
