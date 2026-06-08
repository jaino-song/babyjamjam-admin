import { api } from "@/lib/api/client";

export const ALIMTALK_LOG_PAGE_SIZE = 500;
const MAX_ALIMTALK_LOG_PAGES = 20;

export async function fetchAllAlimtalkLogs<TLog>(): Promise<TLog[]> {
  const logs: TLog[] = [];

  for (let page = 0; page < MAX_ALIMTALK_LOG_PAGES; page += 1) {
    const skip = page * ALIMTALK_LOG_PAGE_SIZE;
    const { data } = await api.get<TLog[]>("/alimtalk-logs", {
      params: { limit: ALIMTALK_LOG_PAGE_SIZE, skip },
    });
    const pageLogs = Array.isArray(data) ? data : [];
    logs.push(...pageLogs);

    if (pageLogs.length < ALIMTALK_LOG_PAGE_SIZE) {
      break;
    }
  }

  return logs;
}
