import { NextRequest } from "next/server";
import { getEformsignWebhookEventBus } from "@/lib/eformsign/webhook-events.server";
import type { EformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

export const runtime = "nodejs";

function encodeSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, payload)));
      };

      const unsubscribe = getEformsignWebhookEventBus().subscribe(
        (payload: EformsignWebhookDocumentUpdate) => {
          send("document-status", payload);
        }
      );

      const keepAliveTimer = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);

      send("connected", { ok: true, timestamp: Date.now() });

      const abort = () => {
        clearInterval(keepAliveTimer);
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener("abort", abort, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
