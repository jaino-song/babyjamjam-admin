"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ClientNotificationLogRecord } from "@/components/app/clients/client-detail";
import type { Client } from "@/lib/client/types";
import { fetchClientMessageLogs, type ClientMessageLogs } from "@/lib/messages/logs";

export function useClientMessageHistory(client: Client | null) {
  const clientId = client?.id ?? null;
  const query = useQuery<ClientMessageLogs<ClientNotificationLogRecord>>({
    queryKey: ["messages", "logs", "client", clientId],
    // The server returns this client's own records (plus unowned records sent to
    // the client's current phone) newest first, so no client-side matching of a
    // branch-wide window is needed — or safe, since that window drops old history.
    queryFn: () => fetchClientMessageLogs<ClientNotificationLogRecord>(clientId as number),
    enabled: clientId !== null,
    staleTime: 0,
    retry: false,
  });

  const notificationLogs = useMemo(() => {
    if (!Array.isArray(query.data?.logs)) return [];

    return [...query.data.logs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [query.data]);

  return {
    notificationLogs,
    /** The server holds older records than the ones in `notificationLogs`. */
    hasMore: query.data?.hasMore === true,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
