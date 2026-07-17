"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ClientNotificationLogRecord } from "@/components/app/clients/client-detail";
import type { Client } from "@/lib/client/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";
import { normalizeKoreanPhoneDigits } from "@/lib/phone";

export function useClientMessageHistory(client: Client | null) {
  const query = useQuery<ClientNotificationLogRecord[]>({
    queryKey: ["messages", "logs", "all"],
    queryFn: () => fetchAllMessageLogs<ClientNotificationLogRecord>(),
    enabled: Boolean(client),
    staleTime: 0,
    retry: false,
  });

  const notificationLogs = useMemo(() => {
    if (!client || !Array.isArray(query.data)) return [];

    const clientPhone = normalizeKoreanPhoneDigits(client.phone);
    return query.data
      .filter((log) => {
        if (log.clientId === client.id) return true;
        if (!clientPhone) return false;

        const logPhones = [
          log.recipientPhone,
          ...(log.receiver ?? "").split(/[,\n;]/),
        ];
        return logPhones.some((phone) => normalizeKoreanPhoneDigits(phone) === clientPhone);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [client, query.data]);

  return {
    notificationLogs,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
