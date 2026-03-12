import { EventEmitter } from "node:events";
import type { EformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

type WebhookListener = (event: EformsignWebhookDocumentUpdate) => void;

class EformsignWebhookEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: EformsignWebhookDocumentUpdate) {
    this.emitter.emit("document-status", event);
  }

  subscribe(listener: WebhookListener) {
    this.emitter.on("document-status", listener);
    return () => {
      this.emitter.off("document-status", listener);
    };
  }
}

const globalForWebhookBus = globalThis as typeof globalThis & {
  __eformsignWebhookEventBus?: EformsignWebhookEventBus;
};

export function getEformsignWebhookEventBus() {
  if (!globalForWebhookBus.__eformsignWebhookEventBus) {
    globalForWebhookBus.__eformsignWebhookEventBus = new EformsignWebhookEventBus();
  }

  return globalForWebhookBus.__eformsignWebhookEventBus;
}
