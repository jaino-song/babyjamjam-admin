import { normalizeKoreanPhoneLookupKey } from "@/lib/phone";

export interface MessageHistoryClientTarget {
  id?: number | null;
  name?: string | null;
  phone?: string | null;
}

export interface MessageHistoryClientRecord {
  clientId?: number | null;
  receiver: string;
}

export function matchesMessageHistoryClient(
  record: MessageHistoryClientRecord,
  client: MessageHistoryClientTarget | null | undefined,
) {
  if (!client) return false;

  const clientId = client.id ?? null;
  if (clientId !== null && record.clientId === clientId) {
    return true;
  }

  const clientPhoneKey = normalizeKoreanPhoneLookupKey(client.phone ?? "");
  return (
    clientPhoneKey.length > 0 &&
    normalizeKoreanPhoneLookupKey(record.receiver) === clientPhoneKey
  );
}

export function findMessageHistoryClient<TClient extends MessageHistoryClientTarget>(
  record: MessageHistoryClientRecord,
  clients: readonly TClient[],
) {
  return clients.find((client) => matchesMessageHistoryClient(record, client)) ?? null;
}
