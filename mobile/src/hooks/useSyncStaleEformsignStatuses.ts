"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";
import { eformsignApi, withEformsignReauth } from "@/services/api";

const DEFAULT_MAX_SYNC_COUNT = 10;

interface UseSyncStaleEformsignStatusesOptions {
  enabled?: boolean;
  maxSyncCount?: number;
}

function pendingEformsignDocumentIds(clients: Client[], maxSyncCount: number): string[] {
  const documentIds = new Set<string>();

  for (const client of clients) {
    if (!client.eDocId) continue;
    if (!client.documentStatus || client.documentStatus === "completed") continue;

    documentIds.add(client.eDocId);
    if (documentIds.size >= maxSyncCount) break;
  }

  return [...documentIds];
}

export function useSyncStaleEformsignStatuses(
  clients: Client[],
  options: UseSyncStaleEformsignStatusesOptions = {},
) {
  const queryClient = useQueryClient();
  const syncedDocumentIdsRef = useRef(new Set<string>());
  const enabled = options.enabled ?? true;
  const maxSyncCount = options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT;
  const documentIds = useMemo(
    () => pendingEformsignDocumentIds(clients, maxSyncCount),
    [clients, maxSyncCount],
  );

  useEffect(() => {
    if (!enabled || documentIds.length === 0) return;

    const documentIdsToSync = documentIds.filter(
      (documentId) => !syncedDocumentIdsRef.current.has(documentId),
    );
    if (documentIdsToSync.length === 0) return;

    for (const documentId of documentIdsToSync) {
      syncedDocumentIdsRef.current.add(documentId);
    }

    let cancelled = false;

    void Promise.allSettled(
      documentIdsToSync.map((documentId) =>
        withEformsignReauth(() => eformsignApi.syncDocumentStatus(documentId)),
      ),
    ).then((results) => {
      if (cancelled) return;

      const hasSyncedDocument = results.some((result) => result.status === "fulfilled");
      if (!hasSyncedDocument) return;

      void queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.analytics() });
    });

    return () => {
      cancelled = true;
    };
  }, [documentIds, enabled, queryClient]);
}
