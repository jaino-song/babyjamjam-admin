import { NextRequest, NextResponse } from "next/server";
import { getEformsignWebhookEventBus } from "@/lib/eformsign/webhook-events.server";
import { extractEformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.EFORMSIGN_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return true;
  }

  const tokenFromQuery = request.nextUrl.searchParams.get("token");
  const tokenFromHeader = request.headers.get("x-webhook-secret");
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return [tokenFromQuery, tokenFromHeader, bearerToken].some((value) => value === secret);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const update = extractEformsignWebhookDocumentUpdate(payload);

  if (!update) {
    return NextResponse.json(
      {
        ok: false,
        message: "Document update could not be extracted from payload",
      },
      { status: 202 }
    );
  }

  getEformsignWebhookEventBus().emit(update);

  return NextResponse.json({
    ok: true,
    documentId: update.documentId,
    statusType: update.statusType,
  });
}
