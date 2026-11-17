"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  MESSAGE_EVENT_LABELS,
  formatMessageDateTimeCompact,
  type MessageRecordStatusFilter,
} from "@babyjamjam/shared";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { useAllClients } from "@/features/clients/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import {
  useCancelUpcomingMessageTriggerJob,
  useMessageHistory,
  useResendMessageTriggerJob,
  useRetryMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { isHistoryRecordInChannel, isUpcomingJobInChannel } from "@/features/message-triggers/channel";
import type { UpcomingMessageTriggerJob } from "@/features/message-triggers/types";
import {
  getMessageHistoryTemplateLabel as getHistoryTemplateLabel,
  getScheduledRecipientBadge,
  matchesMessageHistoryQuery as matchesHistoryQuery,
  normalizeMessageHistoryRecord as normalizeHistoryRecord,
  type MessageHistoryFilter,
} from "./MessageHistoryDetailPanel";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { findMessageHistoryClient } from "@/lib/message-history/client-match";
import { getMessageRecordStatusCounts } from "@/lib/message-record-status-counts";

export type MessageHistoryRelativeDateFilter = "all" | "1d" | "7d" | "30d";

function matchesHistoryDateParts(sentAt: string, yearFilter: string, monthFilter: string) {
  if (!yearFilter && !monthFilter) return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const matchesYear = !yearFilter || String(targetDate.getFullYear()) === yearFilter;
  const matchesMonth = !monthFilter || String(targetDate.getMonth() + 1).padStart(2, "0") === monthFilter;

  return matchesYear && matchesMonth;
}

function normalizeDatePart(value: string, emptyValue: string) {
  return value === emptyValue ? "" : value;
}

function matchesHistoryRelativeDate(sentAt: string, relativeDateFilter: MessageHistoryRelativeDateFilter) {
  if (relativeDateFilter === "all") return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const days = relativeDateFilter === "1d" ? 1 : relativeDateFilter === "7d" ? 7 : 30;
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - days);

  return targetDate >= threshold;
}

function matchesScheduledJobQuery(job: UpcomingMessageTriggerJob, query: string) {
  return matchesSearchQuery(query, [
    job.ruleName,
    job.payload.recipientName,
    job.payload.clientName ?? "",
    job.payload.employeeName ?? "",
    job.recipientPhone ?? job.payload.recipientPhone ?? "",
    getScheduledRecipientBadge(job.recipientType),
    getHistoryTemplateLabel(job.templateKey),
    (job.eventType ? MESSAGE_EVENT_LABELS[job.eventType] : "기타 이벤트"),
    formatMessageDateTimeCompact(job.scheduledFor),
  ]);
}

const MESSAGE_RECORD_QUERY_LIMIT = 200;

// Share the list's loaded sources and filters with the page-level status row.
export function useMessageHistoryListState() {
  const [searchValue, setSearchValue] = useState("");
  const [recordStatusFilter, setRecordStatusFilter] = useState<MessageRecordStatusFilter>("all");
  const [relativeDateFilter, setRelativeDateFilter] = useState<MessageHistoryRelativeDateFilter>("all");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const {
    data: historyDataLoaded,
    isLoading,
    isError: isHistoryError,
    isFetching: isFetchingHistory,
    isPaused: isHistoryPaused,
    refetch: refetchHistory,
  } = useMessageHistory(MESSAGE_RECORD_QUERY_LIMIT);
  const {
    data: upcomingJobsLoaded,
    isLoading: isLoadingUpcoming,
    isError: isUpcomingError,
    isFetching: isFetchingUpcoming,
    isPaused: isUpcomingPaused,
    refetch: refetchUpcoming,
  } = useUpcomingMessageTriggerJobs(MESSAGE_RECORD_QUERY_LIMIT);
  // A failed query only counts as "no data" when no earlier successful load is
  // cached; judged from the data itself, never from !isError.
  const historyData = useMemo(() => historyDataLoaded ?? [], [historyDataLoaded]);
  const upcomingJobs = useMemo(() => upcomingJobsLoaded ?? [], [upcomingJobsLoaded]);
  // The history query is often already cached (TemplateSendForm subscribes to
  // the same key), so isLoading can settle before isLoadingUpcoming does. The
  // two zone lists and the three count pills key off this combined flag so the
  // list panel skeletons as one unit; the detail panel is not gated by it.
  const isPanelLoading = isLoading || isLoadingUpcoming;
  const { mutateAsync: retryHistory, isPending: isRetrying } = useRetryMessageHistory();
  const cancelMutation = useCancelUpcomingMessageTriggerJob();
  const resendMutation = useResendMessageTriggerJob();
  // Retry and cancel require BranchManagerGuard on the server; hide them for
  // plain branch users instead of letting them hit a 403.
  const authUserQuery = useGetAuthUser();
  const canManageBranchMessages = canManageBranchFromAuthQuery(authUserQuery);
  const canOpenOwnerAdmin = authUserQuery.data?.role === "owner";
  const { data: clients = [] } = useAllClients();
  const { toast } = useToast();
  const smsHistoryData = useMemo(
    () => historyData.filter((record) => isHistoryRecordInChannel(record, "sms")),
    [historyData],
  );
  const smsUpcomingJobs = useMemo(
    () => upcomingJobs.filter((job) => isUpcomingJobInChannel(job, "sms")),
    [upcomingJobs],
  );
  const historyRecords = useMemo(
    () =>
      // Sorted explicitly here (not left to the backend's createdAt-desc order)
      // so a retried record's most recent attempt sorts to the top — same key
      // and direction as mobile's MessagesDataPages historyRecords sort
      // (lastAttemptAt || createdAt, descending), so the two apps agree.
      [...smsHistoryData]
        .sort(
          (left, right) =>
            new Date(right.lastAttemptAt || right.createdAt).getTime()
            - new Date(left.lastAttemptAt || left.createdAt).getTime(),
        )
        .map((record) => {
          const matchedClient = findMessageHistoryClient(record, clients);
          const matchedClientName = matchedClient?.name.trim() ?? "";
          const normalizedRecord = normalizeHistoryRecord(record, {
            recipientNameFallback: matchedClientName,
            recipientListLabelFallback: matchedClientName,
          });

          const shouldUseMatchedClientName = record.recipientType === null
            || record.recipientType === "CLIENT";
          if (!matchedClientName || !shouldUseMatchedClientName) return normalizedRecord;

          return {
            ...normalizedRecord,
            recipientName: matchedClientName,
            recipientListLabel: matchedClientName,
          };
        }),
    [clients, smsHistoryData]
  );
  const hasDatePartFilter = Boolean(dateYear || dateMonth);
  const historyYearOptions = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();

    historyRecords.forEach((record) => {
      const sentDate = new Date(record.sentAt);
      if (!Number.isNaN(sentDate.getTime())) {
        years.add(sentDate.getFullYear());
      }
    });

    for (let year = currentYear; year >= currentYear - 5; year -= 1) {
      years.add(year);
    }

    return Array.from(years).sort((a, b) => b - a);
  }, [historyRecords]);
  const handleDateYearChange = useCallback((value: string) => {
    setDateYear(normalizeDatePart(value, "year"));
  }, []);
  const handleDateMonthChange = useCallback((value: string) => {
    setDateMonth(normalizeDatePart(value, "month"));
  }, []);

  // "all" and "upcoming" both show every zone-1 row; the remaining three values
  // show only zone 1 (upcoming shows nothing from zone 2 at all).
  const showUpcomingZone = recordStatusFilter === "all" || recordStatusFilter === "upcoming";
  const showPastZone = recordStatusFilter !== "upcoming";
  const pastStatusFilter: MessageHistoryFilter =
    recordStatusFilter === "sent" || recordStatusFilter === "failed" || recordStatusFilter === "canceled"
      ? recordStatusFilter
      : "all";

  // Soonest-first, matching the old scheduled section. No date-range filter here
  // on purpose — upcoming sends are always in the future, so the "지난 발송" date
  // filter below only ever applies to zone 2.
  const matchingUpcomingJobs = useMemo(() => {
    return smsUpcomingJobs
      .filter((job) => matchesScheduledJobQuery(job, deferredSearchValue))
      .sort((left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime());
  }, [deferredSearchValue, smsUpcomingJobs]);

  const matchingHistoryRecords = useMemo(
    () => {
      return historyRecords.filter((record) => {
        const matchesRelativeDate = matchesHistoryRelativeDate(record.sentAt, relativeDateFilter);
        const matchesDate = matchesHistoryDateParts(record.sentAt, dateYear, dateMonth);
        return matchesRelativeDate && matchesDate && matchesHistoryQuery(record, deferredSearchValue);
      });
    },
    [dateMonth, dateYear, deferredSearchValue, historyRecords, relativeDateFilter]
  );

  const filteredUpcomingJobs = useMemo(
    () => showUpcomingZone ? matchingUpcomingJobs : [],
    [matchingUpcomingJobs, showUpcomingZone],
  );
  const filteredHistoryRecords = useMemo(
    () => showPastZone ? matchingHistoryRecords.filter((record) => pastStatusFilter === "all" || record.status === pastStatusFilter) : [],
    [matchingHistoryRecords, pastStatusFilter, showPastZone],
  );
  const statusCounts = getMessageRecordStatusCounts({
    history: matchingHistoryRecords,
    upcomingCount: matchingUpcomingJobs.length,
    historyUnknown: (isHistoryError || isHistoryPaused) && historyDataLoaded === undefined,
    upcomingUnknown: (isUpcomingError || isUpcomingPaused) && upcomingJobsLoaded === undefined,
    historyLimited: historyData.length === MESSAGE_RECORD_QUERY_LIMIT,
    upcomingLimited: upcomingJobs.length === MESSAGE_RECORD_QUERY_LIMIT,
  });

  return {
    searchValue, setSearchValue, recordStatusFilter, setRecordStatusFilter,
    relativeDateFilter, setRelativeDateFilter, dateYear, setDateYear, dateMonth, setDateMonth,
    deferredSearchValue, historyDataLoaded, isLoading, isHistoryError, isFetchingHistory, isHistoryPaused, refetchHistory,
    upcomingJobsLoaded, isLoadingUpcoming, isUpcomingError, isFetchingUpcoming, isUpcomingPaused, refetchUpcoming,
    isPanelLoading, retryHistory, isRetrying, cancelMutation, resendMutation, toast,
    canManageBranchMessages, canOpenOwnerAdmin, hasDatePartFilter, historyYearOptions,
    handleDateYearChange, handleDateMonthChange, showUpcomingZone, showPastZone,
    filteredUpcomingJobs, filteredHistoryRecords, statusCounts,
  };
}
