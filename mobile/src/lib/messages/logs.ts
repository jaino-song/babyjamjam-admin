import { api } from "@/lib/api/client";

export const MESSAGE_LOG_PAGE_SIZE = 500;
const MAX_MESSAGE_LOG_PAGES = 20;

export async function fetchAllMessageLogs<TLog>(): Promise<TLog[]> {
  const logs: TLog[] = [];

  for (let page = 0; page < MAX_MESSAGE_LOG_PAGES; page += 1) {
    const skip = page * MESSAGE_LOG_PAGE_SIZE;
    const { data } = await api.get<TLog[]>("/message-logs", {
      params: { limit: MESSAGE_LOG_PAGE_SIZE, skip },
    });
    const pageLogs = Array.isArray(data) ? data : [];
    logs.push(...pageLogs);

    if (pageLogs.length < MESSAGE_LOG_PAGE_SIZE) {
      break;
    }
  }

  return logs;
}

export const CLIENT_MESSAGE_LOG_PAGE_SIZE = 100;
// 20 pages x 100 = 2,000 records for ONE client; a real client history is a few dozen.
const MAX_CLIENT_MESSAGE_LOG_PAGES = 20;

const CLIENT_MESSAGE_LOGS_CONTRACT_MESSAGE = "메시지 발송 기록 서버 응답 형식이 올바르지 않습니다.";

interface ClientMessageLogsPage<TLog> {
  items: TLog[];
  nextCursor: string | null;
}

/**
 * Validates one page of a client's history. A missing envelope (null data, no
 * `items`, no `page`, `hasMore` without a cursor) is a broken contract, not an
 * empty history, so it is rejected and the screen shows its error state
 * instead of "발송 내역이 없습니다".
 */
function parseClientMessageLogsPage<TLog>(payload: unknown): ClientMessageLogsPage<TLog> {
  if (payload === null || typeof payload !== "object") {
    throw new Error(CLIENT_MESSAGE_LOGS_CONTRACT_MESSAGE);
  }

  const envelope = payload as { items?: unknown; page?: unknown };
  if (!Array.isArray(envelope.items) || envelope.page === null || typeof envelope.page !== "object") {
    throw new Error(CLIENT_MESSAGE_LOGS_CONTRACT_MESSAGE);
  }

  const page = envelope.page as { nextCursor?: unknown; hasMore?: unknown };
  const hasNextCursor = typeof page.nextCursor === "string" && page.nextCursor.length > 0;
  if (
    typeof page.hasMore !== "boolean"
    || (page.nextCursor !== null && page.nextCursor !== undefined && !hasNextCursor)
    || (page.hasMore && !hasNextCursor)
    || (!page.hasMore && hasNextCursor)
  ) {
    throw new Error(CLIENT_MESSAGE_LOGS_CONTRACT_MESSAGE);
  }

  return {
    items: envelope.items as TLog[],
    nextCursor: hasNextCursor ? (page.nextCursor as string) : null,
  };
}

export interface ClientMessageLogs<TLog> {
  logs: TLog[];
  /**
   * True only when the server still holds older records than the ones returned
   * (the page cap was reached). Callers must say only recent records are shown
   * instead of presenting the list as the complete history.
   */
  hasMore: boolean;
}

/**
 * One client's message history, read by client id from the server (newest
 * first, scoped to the caller's branch). Replaces filtering the branch-wide
 * log window in the browser, which loses any client older than that window.
 */
export async function fetchClientMessageLogs<TLog>(clientId: number): Promise<ClientMessageLogs<TLog>> {
  const logs: TLog[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_CLIENT_MESSAGE_LOG_PAGES; page += 1) {
    const response: { data: unknown } = await api.get<unknown>(
      `/message-logs/client/${encodeURIComponent(clientId)}`,
      {
        params: {
          limit: CLIENT_MESSAGE_LOG_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
    );
    const parsed: ClientMessageLogsPage<TLog> = parseClientMessageLogsPage<TLog>(response.data);
    logs.push(...parsed.items);

    cursor = parsed.nextCursor;
    if (!cursor) break;
  }

  return { logs, hasMore: cursor !== null };
}
