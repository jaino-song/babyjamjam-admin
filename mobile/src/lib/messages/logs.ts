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

interface ClientMessageLogsPage<TLog> {
  items?: TLog[];
  page?: { nextCursor?: string | null };
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
    const { data } = await api.get<ClientMessageLogsPage<TLog>>(
      `/message-logs/client/${encodeURIComponent(clientId)}`,
      {
        params: {
          limit: CLIENT_MESSAGE_LOG_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
    );
    logs.push(...(Array.isArray(data?.items) ? data.items : []));

    const nextCursor: unknown = data?.page?.nextCursor;
    cursor = typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : null;
    if (!cursor) break;
  }

  return { logs, hasMore: cursor !== null };
}
