"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";
import { eformsignApi, withEformsignReauth } from "@/services/api";

const DEFAULT_MAX_SYNC_COUNT = 10;
// Module-level gate: a per-instance ref reset on every mount, so each
// dashboard visit re-fired the full pending-document sync burst. Documents
// are retried at most once per interval for the lifetime of the tab.
const SYNC_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const lastSyncAttemptAtByDocumentId = new Map<string, number>();

export function __resetEformsignSyncGateForTests(): void {
  lastSyncAttemptAtByDocumentId.clear();
}

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
  const enabled = options.enabled ?? true;
  const maxSyncCount = options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT;
  const documentIds = useMemo(
    () => pendingEformsignDocumentIds(clients, maxSyncCount),
    [clients, maxSyncCount],
  );

  useEffect(() => {
    if (!enabled || documentIds.length === 0) return;

    const now = Date.now();
    const documentIdsToSync = documentIds.filter((documentId) => {
      const lastAttemptAt = lastSyncAttemptAtByDocumentId.get(documentId);
      return lastAttemptAt === undefined || now - lastAttemptAt >= SYNC_RETRY_INTERVAL_MS;
    });
    if (documentIdsToSync.length === 0) return;

    for (const documentId of documentIdsToSync) {
      lastSyncAttemptAtByDocumentId.set(documentId, now);
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
