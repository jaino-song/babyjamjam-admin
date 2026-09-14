"use client";

import { useEffect, useRef } from "react";

import { openAuthenticatedEventSource } from "@/lib/api/authenticated-fetch";

export interface EformsignDocsChangedEvent {
  branchId?: string;
  documentId?: string;
  reason?: string;
}

interface UseEformsignDocumentEventsOptions {
  enabled: boolean;
  onDocsChanged: (event: EformsignDocsChangedEvent) => void;
}

const EFORM_DOC_EVENTS_URL = "/api/eformsign-docs/events";
const RECONNECT_DELAY_MS = 30 * 1000;
const INVALIDATE_DEBOUNCE_MS = 300;
const DUPLICATE_EVENT_SUPPRESSION_MS = 2 * 1000;

function parseDocsChangedEvent(event: Event): EformsignDocsChangedEvent {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return {};
  }

  try {
    const data = JSON.parse(event.data) as EformsignDocsChangedEvent;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function getDocsChangedEventKey(event: EformsignDocsChangedEvent): string {
  return [
    event.branchId ?? "",
    event.documentId ?? "",
    event.reason ?? "",
  ].join("\u001f");
}

function isDocumentHidden(): boolean {
  return document.visibilityState === "hidden";
}

export function useEformsignDocumentEvents({
  enabled,
  onDocsChanged,
}: UseEformsignDocumentEventsOptions) {
  const onDocsChangedRef = useRef(onDocsChanged);

  useEffect(() => {
    onDocsChangedRef.current = onDocsChanged;
  }, [onDocsChanged]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let invalidateTimer: number | null = null;
    let lastDeliveredEventKey: string | null = null;
    let lastDeliveredAt = 0;
    let disposed = false;
    let connecting = false;
    let bootstrapController: AbortController | null = null;

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const clearInvalidateTimer = () => {
      if (!invalidateTimer) return;
      window.clearTimeout(invalidateTimer);
      invalidateTimer = null;
    };

    const closeSource = () => {
      source?.close();
      source = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer || document.visibilityState === "hidden") return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, RECONNECT_DELAY_MS);
    };

    const handleDocsChanged = (event: Event) => {
      const payload = parseDocsChangedEvent(event);
      clearInvalidateTimer();
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = null;
        const eventKey = getDocsChangedEventKey(payload);
        const now = Date.now();
        if (
          lastDeliveredEventKey === eventKey &&
          now - lastDeliveredAt < DUPLICATE_EVENT_SUPPRESSION_MS
        ) {
          lastDeliveredAt = now;
          return;
        }

        lastDeliveredEventKey = eventKey;
        lastDeliveredAt = now;
        onDocsChangedRef.current(payload);
      }, INVALIDATE_DEBOUNCE_MS);
    };

    async function connect() {
      if (disposed || source || connecting || isDocumentHidden()) return;

      connecting = true;
      const controller = new AbortController();
      bootstrapController = controller;

      try {
        source = await openAuthenticatedEventSource(EFORM_DOC_EVENTS_URL, {
          signal: controller.signal,
        });
        if (disposed || controller.signal.aborted || isDocumentHidden()) {
          closeSource();
          return;
        }
        source.addEventListener("docs-changed", handleDocsChanged);
        source.addEventListener("error", () => {
          closeSource();
          scheduleReconnect();
        });
      } catch {
        source = null;
        if (!disposed && !controller.signal.aborted) {
          scheduleReconnect();
        }
      } finally {
        connecting = false;
        if (bootstrapController === controller) {
          bootstrapController = null;
        }
      }
    }

    const handleVisibilityChange = () => {
      clearReconnectTimer();

      if (document.visibilityState === "hidden") {
        bootstrapController?.abort();
        closeSource();
        return;
      }

      void connect();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void connect();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      clearInvalidateTimer();
      bootstrapController?.abort();
      closeSource();
    };
  }, [enabled]);
}
