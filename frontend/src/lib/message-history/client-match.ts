import { normalizeKoreanPhoneLookupKey } from "@/lib/phone";

export interface MessageHistoryClientTarget {
  id?: number | null;
  name?: string | null;
  phone?: string | null;
}

export interface MessageHistoryClientRecord {
  clientId?: number | null;
  receiver: string;
  recipientPhone?: string | null;
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
  // A record already owned by another client never matches by phone: phone numbers are
  // reassigned, so the fallback is only for records that carry no client id at all.
  if (record.clientId != null) {
    return false;
  }

  const clientPhoneKey = normalizeKoreanPhoneLookupKey(client.phone ?? "");
  return (
    clientPhoneKey.length > 0 &&
    normalizeKoreanPhoneLookupKey(record.recipientPhone ?? record.receiver) === clientPhoneKey
  );
}

export function findMessageHistoryClient<TClient extends MessageHistoryClientTarget>(
  record: MessageHistoryClientRecord,
  clients: readonly TClient[],
) {
  return clients.find((client) => matchesMessageHistoryClient(record, client)) ?? null;
}
