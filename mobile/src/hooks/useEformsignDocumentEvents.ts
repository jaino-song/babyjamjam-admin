"use client";

import { useEffect, useRef } from "react";

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
    let disposed = false;

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
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const handleDocsChanged = (event: Event) => {
      const payload = parseDocsChangedEvent(event);
      clearInvalidateTimer();
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = null;
        onDocsChangedRef.current(payload);
      }, INVALIDATE_DEBOUNCE_MS);
    };

    function connect() {
      if (disposed || source || document.visibilityState === "hidden") return;

      try {
        source = new EventSource(EFORM_DOC_EVENTS_URL);
      } catch {
        source = null;
        scheduleReconnect();
        return;
      }

      source.addEventListener("docs-changed", handleDocsChanged);
      source.addEventListener("error", () => {
        closeSource();
        scheduleReconnect();
      });
    }

    const handleVisibilityChange = () => {
      clearReconnectTimer();

      if (document.visibilityState === "hidden") {
        closeSource();
        return;
      }

      connect();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      clearInvalidateTimer();
      closeSource();
    };
  }, [enabled]);
}
