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
