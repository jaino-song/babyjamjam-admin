import type { MessageRecordStatusFilter } from "@babyjamjam/shared";

interface MessageRecordCountInput {
  history: readonly { status: string }[];
  upcomingCount: number;
  historyUnknown: boolean;
  upcomingUnknown: boolean;
  historyLimited: boolean;
  upcomingLimited: boolean;
}

/** Count search/date-filtered rows before applying the active status tab. */
export function getMessageRecordStatusCounts(input: MessageRecordCountInput): Record<MessageRecordStatusFilter, string | number> {
  const format = (count: number, unknown: boolean, limited: boolean) =>
    unknown ? "—" : limited ? `${count}+` : count;
  return {
    all: format(input.upcomingCount + input.history.length, input.historyUnknown || input.upcomingUnknown, input.historyLimited || input.upcomingLimited),
    upcoming: format(input.upcomingCount, input.upcomingUnknown, input.upcomingLimited),
    sent: format(input.history.filter((record) => record.status === "sent").length, input.historyUnknown, input.historyLimited),
    failed: format(input.history.filter((record) => record.status === "failed").length, input.historyUnknown, input.historyLimited),
    canceled: format(input.history.filter((record) => record.status === "canceled").length, input.historyUnknown, input.historyLimited),
  };
}
