"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import {
  applyEformsignDocumentToCaches,
  applyWebhookUpdateToDocument,
  findEformsignDocumentInCache,
} from "@/lib/eformsign/live-updates";
import type { EformsignWebhookDocumentUpdate } from "@/lib/eformsign/webhook";

function parseWebhookEvent(data: string): EformsignWebhookDocumentUpdate | null {
  try {
    const parsed = JSON.parse(data) as EformsignWebhookDocumentUpdate;
    return parsed.documentId ? parsed : null;
  } catch {
    return null;
  }
}

export function useEformsignWebhookUpdates(enabled: boolean) {
  const queryClient = useQueryClient();
  const [pendingDocumentIds, setPendingDocumentIds] = useState<Set<string>>(new Set());
  const inFlightRefreshesRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource("/api/eformsign/webhook/stream");

    const markPending = (documentId: string, nextPending: boolean) => {
      setPendingDocumentIds((current) => {
        const hasDocument = current.has(documentId);

        if (nextPending === hasDocument) {
          return current;
        }

        const next = new Set(current);

        if (nextPending) {
          next.add(documentId);
        } else {
          next.delete(documentId);
        }

        return next;
      });
    };

    const handleDocumentStatus = (event: MessageEvent<string>) => {
      const update = parseWebhookEvent(event.data);

      if (!update) {
        return;
      }

      markPending(update.documentId, true);

      const cachedDocument = findEformsignDocumentInCache(queryClient, update.documentId);
      if (cachedDocument) {
        applyEformsignDocumentToCaches(
          queryClient,
          applyWebhookUpdateToDocument(cachedDocument, update)
        );
      }

      if (inFlightRefreshesRef.current.has(update.documentId)) {
        return;
      }

      const refreshPromise = eformsignApi
        .getDocument(update.documentId)
        .then((document) => {
          applyEformsignDocumentToCaches(queryClient, document);
        })
        .catch(() => {
          queryClient.invalidateQueries({
            queryKey: ["eformsign-documents", "detail", update.documentId],
          });
          queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
        })
        .finally(() => {
          inFlightRefreshesRef.current.delete(update.documentId);
          markPending(update.documentId, false);
        });

      inFlightRefreshesRef.current.set(update.documentId, refreshPromise);
    };

    eventSource.addEventListener("document-status", handleDocumentStatus as EventListener);

    return () => {
      eventSource.removeEventListener("document-status", handleDocumentStatus as EventListener);
      eventSource.close();
    };
  }, [enabled, queryClient]);

  return {
    pendingDocumentIds,
  };
}
