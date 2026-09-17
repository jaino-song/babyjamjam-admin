"use client";
import { getUserErrorMessage } from "@babyjamjam/shared";


import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  MessageSquareText,
  RotateCcw,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  MESSAGE_HISTORY_STATUS_LABELS,
  MESSAGE_JOB_CANCEL_COPY,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_RECORD_REASON_LABEL,
  MESSAGE_RECORD_STATUS_FILTER_LABELS,
  MESSAGE_RECORD_ZONE_LABELS,
  formatMessageDateTimeCompact,
  formatMessageFailureReason,
  getMessageTemplateLabel,
  isSmsHistoryRecord,
  isSmsTriggerTemplate,
  normalizeMessageHistoryPresentation,
  type MessageRecordStatusFilter,
  type MessageSectionId,
} from "@babyjamjam/shared";

import {
  useCancelMessageTriggerJob,
  useMessageHistory,
  useRetryMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageLogRecord,
  MessageLogStatus,
  MessageTriggerJobStatus,
  UpcomingMessageTriggerJob,
} from "@/features/message-triggers/types";
import { toast } from "@/hooks/use-toast";
import {
  ClientMessageHistoryDetail,
  type MessageHistoryDetailTone,
} from "@/components/app/clients/client-message-history-detail";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { StatusBadge, StatusPill } from "@/components/app/ui/status-badge";
import {
  InfoCard,
  InfoRow,
} from "@/components/app/mobile-redesign/detail-sheet";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard, ListCountSkeleton } from "@/components/app/mobile-redesign/primitives";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { SearchBox } from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { Skeleton } from "@/components/ui/skeleton";
import "@/components/app/mobile-redesign/redesign.css";

interface StatusMeta {
  label: string;
  icon: LucideIcon;
}

type MessageFilterItem = { label: string; count: React.ReactNode; active?: boolean; skeleton?: boolean };

const MESSAGE_COUNT_UNAVAILABLE_LABEL = "집계 실패";

const STATUS_FILTER_ORDER: MessageRecordStatusFilter[] = ["all", "upcoming", "sent", "failed", "canceled"];

const JOB_STATUS: Record<MessageTriggerJobStatus, StatusMeta> = {
  pending: { label: MESSAGE_JOB_STATUS_LABELS.pending, icon: Clock3 },
  processing: { label: MESSAGE_JOB_STATUS_LABELS.processing, icon: Loader2 },
  sent: { label: MESSAGE_JOB_STATUS_LABELS.sent, icon: CheckCircle2 },
  failed: { label: MESSAGE_JOB_STATUS_LABELS.failed, icon: XCircle },
  canceled: { label: MESSAGE_JOB_STATUS_LABELS.canceled, icon: AlertCircle },
};

const HISTORY_STATUS: Record<MessageLogStatus, StatusMeta> = {
  pending: { label: MESSAGE_HISTORY_STATUS_LABELS.pending, icon: Clock3 },
  sent: { label: MESSAGE_HISTORY_STATUS_LABELS.sent, icon: CheckCircle2 },
  failed: { label: MESSAGE_HISTORY_STATUS_LABELS.failed, icon: XCircle },
  canceled: { label: MESSAGE_HISTORY_STATUS_LABELS.canceled, icon: AlertCircle },
};

const HISTORY_DETAIL_TONE: Record<MessageLogStatus, MessageHistoryDetailTone> = {
  pending: "orange",
  sent: "green",
  failed: "burgundy",
  canceled: "muted",
};

/**
 * Canonical data-component bases for the merged /messages/history route
 * (발송 예정 + 발송 기록 as two zones of one list). `data-slot` carries the
 * CSS/route hooks so the stylesheet never keys off `data-component`.
 * The "history" naming survives the merge because /messages/history is the
 * route that survives it; /messages/scheduled is now a redirect only.
 */
const HISTORY_SHEET_BASE = "mobile_messages_history_detail-sheet";
const HISTORY_SLIDING_CARD_BASE = `${HISTORY_SHEET_BASE}_screen_content_sliding-card`;
const HISTORY_LIST_BASE = `${HISTORY_SLIDING_CARD_BASE}_stage_list-pane_history-list`;
const HISTORY_ROW_BASE = `${HISTORY_LIST_BASE}_content_list-card_body_item`;
const UPCOMING_ROW_BASE = `${HISTORY_LIST_BASE}_content_list-card_body_item-upcoming`;
const HISTORY_DETAIL_BASE = `${HISTORY_SLIDING_CARD_BASE}_stage_detail-pane_body`;

const HISTORY_STATUS_PILL_VARIANT: Record<MessageLogStatus, "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  sent: "success",
  failed: "danger",
  canceled: "neutral",
};

type MessageHistoryRelativeDateFilter = "all" | "1d" | "7d" | "30d";

const MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS: ReadonlyArray<{
  value: MessageHistoryRelativeDateFilter;
  label: string;
}> = [
  { value: "all", label: "전체" },
  { value: "1d", label: "1일 전" },
  { value: "7d", label: "1주일 전" },
  { value: "30d", label: "한 달 전" },
];

const MESSAGE_HISTORY_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, "0");
  return { value, label: `${index + 1}월` };
});

function matchesHistoryDateParts(sentAt: string, yearFilter: string, monthFilter: string): boolean {
  if (!yearFilter && !monthFilter) return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const matchesYear = !yearFilter || String(targetDate.getFullYear()) === yearFilter;
  const matchesMonth = !monthFilter || String(targetDate.getMonth() + 1).padStart(2, "0") === monthFilter;
  return matchesYear && matchesMonth;
}

function matchesHistoryRelativeDate(
  sentAt: string,
  relativeDateFilter: MessageHistoryRelativeDateFilter,
): boolean {
  if (relativeDateFilter === "all") return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const days = relativeDateFilter === "1d" ? 1 : relativeDateFilter === "7d" ? 7 : 30;
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - days);
  return targetDate >= threshold;
}

function normalizeDatePart(value: string, emptyValue: string): string {
  return value === emptyValue ? "" : value;
}

function matchesHistoryQuery(record: MessageLogRecord, query: string): boolean {
  const normalized = normalizeMessageHistoryPresentation(record);
  const recipientBadge = record.recipientType === "CLIENT" ? "고객" : record.recipientType ? "직원" : "";

  return matchesSearchQuery(query, [
    normalized.title,
    normalized.recipientName,
    normalized.recipientPhone,
    normalized.templateLabel,
    normalized.channelLabel,
    normalized.messagePreview,
    normalized.failureReason ?? "",
    recipientBadge,
    HISTORY_STATUS[normalized.status].label,
  ]);
}

function matchesUpcomingQuery(job: UpcomingMessageTriggerJob, query: string): boolean {
  const recipientName = job.payload.recipientName || job.payload.clientName || job.payload.employeeName || "수신자";
  const recipientPhone = job.payload.recipientPhone || job.recipientPhone || "";
  const reasonText = getJobReasonText(job);

  return matchesSearchQuery(query, [
    recipientName,
    recipientPhone,
    getMessageTemplateLabel(job.templateKey),
    reasonText,
    JOB_STATUS[job.status].label,
    job.recipientType === "CLIENT" ? "고객" : "직원",
  ]);
}

function MessageHistoryFilterPanel({
  dataComponent,
  searchValue,
  onSearchChange,
  relativeDateFilter,
  onRelativeDateChange,
  dateYear,
  onDateYearChange,
  dateMonth,
  onDateMonthChange,
  historyYearOptions,
  onReset,
  onClose,
}: {
  dataComponent: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  relativeDateFilter: MessageHistoryRelativeDateFilter;
  onRelativeDateChange: (value: MessageHistoryRelativeDateFilter) => void;
  dateYear: string;
  onDateYearChange: (value: string) => void;
  dateMonth: string;
  onDateMonthChange: (value: string) => void;
  historyYearOptions: number[];
  onReset: () => void;
  onClose: () => void;
}) {
  const isDateFilterActive = Boolean(dateYear || dateMonth || relativeDateFilter !== "all");

  return (
    <div
      className="message-history-filter-panel"
      data-component={dataComponent}
      data-slot="message-history-filters"
    >
      <SearchBox
        data-component={`${dataComponent}_search`}
        placeholder="고객명, 연락처, 템플릿, 내용 검색…"
        value={searchValue}
        onChange={onSearchChange}
      />
      <div className="message-history-filter-controls" data-component={`${dataComponent}_controls`}>
        <Select value={relativeDateFilter} onValueChange={(value) => onRelativeDateChange(value as MessageHistoryRelativeDateFilter)}>
          <SelectTrigger
            size="sm"
            aria-label="발송 기간"
            className="w-full"
            data-component={`${dataComponent}_period-trigger`}
          >
            <SelectValue placeholder="기간" />
          </SelectTrigger>
          <SelectContent data-component={`${dataComponent}_period-content`}>
            {MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateYear || "year"} onValueChange={(value) => onDateYearChange(normalizeDatePart(value, "year"))}>
          <SelectTrigger
            size="sm"
            aria-label="발송 연도"
            className="w-full"
            data-component={`${dataComponent}_year-trigger`}
          >
            <SelectValue placeholder="연도" />
          </SelectTrigger>
          <SelectContent data-component={`${dataComponent}_year-content`}>
            <SelectItem value="year">연</SelectItem>
            {historyYearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateMonth || "month"} onValueChange={(value) => onDateMonthChange(normalizeDatePart(value, "month"))}>
          <SelectTrigger
            size="sm"
            aria-label="발송 월"
            className="w-full"
            data-component={`${dataComponent}_month-trigger`}
          >
            <SelectValue placeholder="월" />
          </SelectTrigger>
          <SelectContent data-component={`${dataComponent}_month-content`}>
            <SelectItem value="month">월</SelectItem>
            {MESSAGE_HISTORY_MONTH_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="message-history-filter-actions" data-component={`${dataComponent}_actions`}>
        <Button
          type="button"
          variant="v3-outline"
          size="sm"
          className="h-10 w-1/2"
          disabled={!isDateFilterActive && !searchValue}
          data-component={`${dataComponent}_reset`}
          onClick={onReset}
        >
          <RotateCcw size={14} aria-hidden="true" />
          필터 초기화
        </Button>
        <Button
          type="button"
          variant="v3-soft"
          size="sm"
          className="h-10 w-1/2"
          data-component={`${dataComponent}_close`}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
          필터 닫기
        </Button>
      </div>
    </div>
  );
}

// UpcomingMessageTriggerJob has no separate "failure reason" field — cancelReason
// is the only reason-shaped field it carries, so it doubles for both statuses.
function getJobReasonText(job: UpcomingMessageTriggerJob): string {
  if (job.status !== "failed" && job.status !== "canceled") return "";
  return formatMessageFailureReason(job.cancelReason);
}

// normalizeMessageHistoryPresentation's failureReason is deliberately
// failed-only (it feeds ClientMessageHistoryDetail's existing "실패 사유" row).
// Canceled records need their own reason lookup straight off errorMessage.
function getRecordReasonText(record: MessageLogRecord): string {
  if (record.status !== "failed" && record.status !== "canceled") return "";
  return formatMessageFailureReason(record.errorMessage);
}

const MANUAL_SCHEDULED_RULE_ID_PREFIX = "manual-sms:";

// Manual scheduled sends ride along in the /upcoming response as message_log
// rows coerced into the UpcomingMessageTriggerJob shape (see backend
// MessageTriggerService.listManualScheduledSmsLogs). They carry a synthetic
// `manual-sms:<logId>` ruleId instead of a real message_trigger_rule id —
// the only signal that distinguishes them from a real trigger job. Only real
// trigger jobs can be canceled through /message-trigger-jobs/:id/cancel.
// Mirrors desktop's isManualScheduledJob (frontend/src/app/(protected)/messages/page.tsx).
function isManualScheduledJob(job: UpcomingMessageTriggerJob): boolean {
  return job.ruleId.startsWith(MANUAL_SCHEDULED_RULE_ID_PREFIX);
}

function MessagePageShell({
  title,
  count,
  activeSection,
  children,
  dataComponent,
  dataSlot = "messages-page",
  filters = [],
  activeFilter,
  onFilterChange,
  beforeCount,
  beforeFilters,
}: {
  title: string;
  count: React.ReactNode;
  activeSection: MessageSectionId;
  children: React.ReactNode;
  dataComponent: string;
  dataSlot?: string;
  filters?: MessageFilterItem[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
  beforeCount?: React.ReactNode;
  beforeFilters?: React.ReactNode;
}) {
  return (
    <div
      data-component={dataComponent}
      data-slot={dataSlot}
      data-section={activeSection}
      className="message-page-shell flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ListCard
        data-component={`${dataComponent}_content_list-card`}
        title={title}
        count={count}
        beforeCount={beforeCount}
        filters={filters}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        beforeFilters={beforeFilters}
        loadMore={false}
        className="min-h-0 flex-1 !overflow-hidden !rounded-none !p-0 !shadow-none"
      >
        {children}
      </ListCard>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="message-data-empty">
      <MessageSquareText size={26} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function getMessageHistoryErrorMessage(error: unknown): string {
  if (error instanceof Error && /[가-힣]/.test(error.message)) {
    return error.message;
  }
  return "발송 기록을 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.";
}

function UnavailableCount({ dataComponent }: { dataComponent?: string }) {
  return (
    <span
      aria-label={MESSAGE_COUNT_UNAVAILABLE_LABEL}
      className="messages-count-unavailable"
      data-count-state="unavailable"
      data-component={dataComponent}
    >
      {MESSAGE_COUNT_UNAVAILABLE_LABEL}
    </span>
  );
}

// Loading placeholder for one row, shaped like the row it stands in for so the
// list does not reflow when the data lands: an upcoming row puts a badge above
// a timestamp in a split trailing column, a past row stacks three copy lines
// with the badge underneath. Mirrors desktop's AnimatedSlotList skeleton slots
// instead of the single centered spinner this replaced.
function RowSkeleton({ dataComponent, variant }: {
  dataComponent: string;
  variant: "upcoming" | "past";
}) {
  const line = "rounded-md bg-v3-dim-white";

  return (
    <div className="message-data-row" data-component={dataComponent} aria-hidden>
      <Skeleton className="h-10 w-10 flex-none rounded-xl bg-v3-dim-white" />
      {variant === "upcoming" ? (
        <div className="message-data-row-copy message-data-row-copy-split">
          <div className="message-data-row-info">
            <Skeleton className={`h-3 w-24 ${line}`} />
            <Skeleton className={`mt-1 h-3 w-32 max-w-full ${line}`} />
          </div>
          <div className="message-data-status-group">
            <Skeleton className="h-5 w-16 rounded-full bg-v3-dim-white" />
            <Skeleton className={`h-3 w-12 ${line}`} />
          </div>
        </div>
      ) : (
        <div className="message-data-row-copy">
          <div className="message-data-row-info">
            <Skeleton className={`h-3 w-28 ${line}`} />
            <Skeleton className={`mt-1 h-3 w-40 max-w-full ${line}`} />
            <Skeleton className={`mt-1 h-3 w-20 ${line}`} />
          </div>
          <Skeleton className="mt-1 h-5 w-16 rounded-full bg-v3-dim-white" />
        </div>
      )}
    </div>
  );
}

function ZoneCount({ dataComponent, isLoading, value }: {
  dataComponent: string;
  isLoading: boolean;
  value: number;
}) {
  if (isLoading) {
    return <ListCountSkeleton data-component={dataComponent} />;
  }

  return <span data-component={dataComponent}>{`${value}건`}</span>;
}

function UpcomingRow({
  job,
  onCancel,
}: {
  job: UpcomingMessageTriggerJob;
  onCancel: (job: UpcomingMessageTriggerJob) => void;
}) {
  const meta = JOB_STATUS[job.status];
  const StatusIcon = meta.icon;
  const variant = MESSAGE_JOB_STATUS_BADGE_VARIANT[job.status];
  const recipientName = job.payload.recipientName || job.payload.clientName || job.payload.employeeName || "수신자";
  const reasonText = getJobReasonText(job);
  // Only trigger-rule-backed jobs are cancellable, and only while still
  // pending — manual scheduled entries carry a synthetic manual-sms: ruleId
  // (see isManualScheduledJob) and get no cancel action; a non-pending job
  // would just fail server-side anyway.
  const isCancelable = job.status === "pending" && !isManualScheduledJob(job);

  return (
    <article className="message-data-row" data-component={UPCOMING_ROW_BASE}>
      <span className="message-navigation-icon message-navigation-icon-orange">
        <Clock3 size={18} aria-hidden="true" />
      </span>
      <div className="message-data-row-copy message-data-row-copy-split">
        <div className="message-data-row-info">
          <strong className="message-data-row-title">{recipientName}</strong>
          <p className="message-data-row-subtitle">{getMessageTemplateLabel(job.templateKey)}</p>
          {reasonText ? (
            <em data-component={`${UPCOMING_ROW_BASE}_reason`}>{`${MESSAGE_RECORD_REASON_LABEL}: ${reasonText}`}</em>
          ) : null}
        </div>
        <div className="message-data-status-group">
          <StatusBadge variant={variant} data-component={`${UPCOMING_ROW_BASE}_status`}>
            <StatusIcon
              aria-hidden="true"
              className={job.status === "processing" ? "message-data-spinner" : undefined}
            />
            {meta.label}
          </StatusBadge>
          <time className="message-data-schedule-time">{formatMessageDateTimeCompact(job.scheduledFor)}</time>
          {isCancelable ? (
            <button
              type="button"
              className="text-[0.68rem] font-bold text-v3-burgundy"
              data-component={`${UPCOMING_ROW_BASE}_cancel-action`}
              onClick={() => onCancel(job)}
            >
              {MESSAGE_JOB_CANCEL_COPY.action}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function HistoryRow({
  record,
  onSelect,
}: {
  record: MessageLogRecord;
  onSelect: (record: MessageLogRecord) => void;
}) {
  const normalized = normalizeMessageHistoryPresentation(record);
  const meta = HISTORY_STATUS[normalized.status];
  const StatusIcon = meta.icon;
  const variant = MESSAGE_LOG_STATUS_BADGE_VARIANT[normalized.status];

  return (
    <button
      type="button"
      className="message-data-row message-data-row-button"
      data-component={HISTORY_ROW_BASE}
      onClick={() => onSelect(record)}
    >
      <span className="message-navigation-icon message-navigation-icon-green">
        <History size={18} aria-hidden="true" />
      </span>
      <div className="message-data-row-copy message-data-row-copy-split">
        <div className="message-data-row-info">
          <strong className="message-data-row-title">{normalized.templateLabel}</strong>
          <div className="message-data-row-meta" data-slot="row-meta">
            <p className="message-data-row-subtitle">{normalized.recipientName}</p>
            <small className="message-data-row-subtitle">
              {formatMessageDateTimeCompact(normalized.sentAt)}
            </small>
          </div>
        </div>
        <div className="message-data-status-group" data-slot="status-group">
          <StatusBadge variant={variant} data-component={`${HISTORY_ROW_BASE}_status`}>
            <StatusIcon aria-hidden="true" />
            {meta.label}
          </StatusBadge>
        </div>
      </div>
    </button>
  );
}

export function MessagesHistoryPage() {
  const [selectedRecord, setSelectedRecord] = useState<MessageLogRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<MessageRecordStatusFilter>("all");
  const [jobPendingCancel, setJobPendingCancel] = useState<UpcomingMessageTriggerJob | null>(null);
  const [retryTarget, setRetryTarget] = useState<MessageLogRecord | null>(null);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [relativeDateFilter, setRelativeDateFilter] = useState<MessageHistoryRelativeDateFilter>("all");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");

  const {
    data: upcomingData = [],
    isLoading: isUpcomingLoading,
    isError: isUpcomingError,
  } = useUpcomingMessageTriggerJobs();
  const {
    data: historyData = [],
    isLoading: isHistoryLoading,
    isError: isHistoryError,
    error: historyError,
  } = useMessageHistory();
  const cancelMutation = useCancelMessageTriggerJob();
  const retryMutation = useRetryMessageHistory();

  const upcomingJobs = useMemo(
    () => upcomingData
      .filter((job) => isSmsTriggerTemplate(job.templateKey))
      .sort(
        (left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
      ),
    [upcomingData],
  );

  const historyRecords = useMemo(
    () => historyData
      .filter(isSmsHistoryRecord)
      .sort(
        (left, right) =>
          new Date(right.lastAttemptAt || right.createdAt).getTime()
          - new Date(left.lastAttemptAt || left.createdAt).getTime(),
      ),
    [historyData],
  );

  const historyYearOptions = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();

    historyRecords.forEach((record) => {
      const sentDate = new Date(record.lastAttemptAt || record.createdAt);
      if (!Number.isNaN(sentDate.getTime())) {
        years.add(sentDate.getFullYear());
      }
    });

    for (let year = currentYear; year >= currentYear - 5; year -= 1) {
      years.add(year);
    }

    return Array.from(years).sort((left, right) => right - left);
  }, [historyRecords]);

  // all = both zones; upcoming = zone 1 only; sent/failed/canceled = matching
  // zone 2 rows only. Same semantics as desktop's merged screen.
  const showUpcomingZone = statusFilter === "all" || statusFilter === "upcoming";
  const showHistoryZone = statusFilter !== "upcoming";
  const visibleUpcomingJobs = showUpcomingZone
    ? upcomingJobs.filter((job) => matchesUpcomingQuery(job, searchValue))
    : [];
  const visibleHistoryRecords = showHistoryZone
    ? (statusFilter === "all" ? historyRecords : historyRecords.filter((record) => record.status === statusFilter))
      .filter((record) => matchesHistoryRelativeDate(
        record.lastAttemptAt || record.createdAt,
        relativeDateFilter,
      ))
      .filter((record) => matchesHistoryDateParts(
        record.lastAttemptAt || record.createdAt,
        dateYear,
        dateMonth,
      ))
      .filter((record) => matchesHistoryQuery(record, searchValue))
    : [];

  // Both queries gate the whole list: they settle at different times, so keying
  // each zone off its own flag would show real rows next to a loading zone.
  // Same rule as desktop, where a cached history query makes that routine.
  const isPanelLoading = isUpcomingLoading || isHistoryLoading;

  const filterCounts: Record<MessageRecordStatusFilter, number> = {
    all: upcomingJobs.length + historyRecords.length,
    upcoming: upcomingJobs.length,
    sent: historyRecords.filter((record) => record.status === "sent").length,
    failed: historyRecords.filter((record) => record.status === "failed").length,
    canceled: historyRecords.filter((record) => record.status === "canceled").length,
  };

  const filterCountAvailability: Record<MessageRecordStatusFilter, boolean> = {
    all: !isUpcomingError && !isHistoryError,
    upcoming: !isUpcomingError,
    sent: !isHistoryError,
    failed: !isHistoryError,
    canceled: !isHistoryError,
  };

  // While either query is in flight every filterCounts entry is the empty-array
  // default standing in for a number nobody has fetched, so the pills would
  // publish confident zeros right beside the skeletoned counts. Skeleton them
  // too, the way the sibling list screens do.
  const filterItems: MessageFilterItem[] = STATUS_FILTER_ORDER.map((filter) => {
    const count = !filterCountAvailability[filter]
      ? <UnavailableCount />
      : filter === "failed"
        ? <span className="messages-filter-count-danger">{filterCounts[filter]}</span>
        : filterCounts[filter];

    return {
      label: MESSAGE_RECORD_STATUS_FILTER_LABELS[filter],
      count: isPanelLoading ? "" : count,
      active: filter === statusFilter,
      skeleton: isPanelLoading,
    };
  });

  const handleFilterChange = (label: string) => {
    const nextFilter = STATUS_FILTER_ORDER.find((filter) => MESSAGE_RECORD_STATUS_FILTER_LABELS[filter] === label);
    if (nextFilter) {
      setStatusFilter(nextFilter);
      setSelectedRecord(null);
    }
  };

  const resetHistoryFilters = () => {
    setSearchValue("");
    setRelativeDateFilter("all");
    setDateYear("");
    setDateMonth("");
    setSelectedRecord(null);
  };

  const handleRequestRetry = () => {
    if (
      selectedRecord
      && typeof selectedRecord.id === "number"
      && selectedRecord.status === "failed"
    ) {
      setRetryTarget(selectedRecord);
    }
  };

  const handleConfirmRetry = async () => {
    if (!retryTarget || typeof retryTarget.id !== "number") return;

    try {
      const retriedRecord = await retryMutation.mutateAsync(retryTarget.id);
      if (retriedRecord.status === "failed") {
        throw new Error(retriedRecord.errorMessage || "메시지를 재발송하지 못했어요");
      }

      toast({ variant: "success", description: "재발송 요청을 접수했어요" });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getUserErrorMessage(
          error,
          error instanceof Error ? error.message : "재발송을 요청하지 못했어요",
        ),
      });
    } finally {
      setRetryTarget(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!jobPendingCancel) return;

    try {
      await cancelMutation.mutateAsync(jobPendingCancel.id);
      setJobPendingCancel(null);
      toast({
        title: MESSAGE_JOB_CANCEL_COPY.action,
        description: MESSAGE_JOB_CANCEL_COPY.success,
        variant: "success",
      });
    } catch {
      setJobPendingCancel(null);
      toast({
        title: MESSAGE_JOB_CANCEL_COPY.action,
        description: getUserErrorMessage(MESSAGE_JOB_CANCEL_COPY.failure),
        variant: "destructive",
      });
    }
  };

  const totalVisibleCount = visibleUpcomingJobs.length + visibleHistoryRecords.length;
  const isVisibleUpcomingCountUnavailable = showUpcomingZone && isUpcomingError;
  const isVisibleHistoryCountUnavailable = showHistoryZone && isHistoryError;
  const isTotalCountUnavailable = isVisibleUpcomingCountUnavailable || isVisibleHistoryCountUnavailable;
  // A zone stays visible at zero so its "예정 0건" label still reads; only a
  // settled, error-free, entirely empty list collapses to the empty state. An
  // error counts only while its own zone is on screen — a filtered-away zone
  // cannot show its message, so letting it suppress the empty state would
  // leave the screen explaining nothing.
  const isOverallEmpty = !isPanelLoading
    && !(showUpcomingZone && isUpcomingError)
    && !(showHistoryZone && isHistoryError)
    && totalVisibleCount === 0;
  const upcomingZoneVisible = showUpcomingZone && !isOverallEmpty;
  const historyZoneVisible = showHistoryZone && !isOverallEmpty;

  const normalizedSelectedRecord = selectedRecord
    ? normalizeMessageHistoryPresentation(selectedRecord)
    : null;
  const selectedCancelReason = selectedRecord && normalizedSelectedRecord?.status === "canceled"
    ? getRecordReasonText(selectedRecord)
    : "";
  const canRetrySelectedRecord = Boolean(
    selectedRecord
    && typeof selectedRecord.id === "number"
    && selectedRecord.status === "failed",
  );
  const filterPanelDataComponent = `${HISTORY_LIST_BASE}_content_list-card_filters`;
  const historyErrorMessage = getMessageHistoryErrorMessage(historyError);

  return (
    <>
      <section
        data-component={HISTORY_SHEET_BASE}
        data-slot="messages-page"
        data-page="messages-history"
        className="messages-page flex min-h-0 w-full flex-1"
      >
        <div
          data-component={`${HISTORY_SHEET_BASE}_screen`}
          className="relative flex min-h-0 w-full flex-1 overflow-hidden"
        >
          <div
            data-component={`${HISTORY_SHEET_BASE}_screen_content`}
            data-slot="messages-content"
            className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"
          >
            <MessageSectionNav
              data-component={`${HISTORY_SHEET_BASE}_screen_content_section-nav`}
              activeId="history"
            />
            <SlidingCard
              data-component={HISTORY_SLIDING_CARD_BASE}
              open={normalizedSelectedRecord !== null}
              onBack={() => setSelectedRecord(null)}
              backLabel="발송 기록"
              detailKey={selectedRecord ? String(selectedRecord.id) : null}
              list={
                <MessagePageShell
                  title="발송 기록"
                  count={isPanelLoading ? (
                    // The status region carries real text, not just a label: an empty
                    // labelled region is never announced, and this replaces the only
                    // loading announcement the screen had. Zone counts and row
                    // placeholders stay silent so it is heard once, not five times.
                    <>
                      <ListCountSkeleton
                        data-component={`${HISTORY_LIST_BASE}_content_list-card_header_count`}
                      />
                      <span role="status" className="sr-only">발송 기록을 불러오고 있습니다.</span>
                    </>
                  ) : isTotalCountUnavailable ? (
                    <UnavailableCount
                      dataComponent={`${HISTORY_LIST_BASE}_content_list-card_header_count`}
                    />
                  ) : (
                    <span data-component={`${HISTORY_LIST_BASE}_content_list-card_header_count`}>
                      {`${totalVisibleCount}건`}
                    </span>
                  )}
                  activeSection="history"
                  dataComponent={HISTORY_LIST_BASE}
                  filters={filterItems}
                  activeFilter={MESSAGE_RECORD_STATUS_FILTER_LABELS[statusFilter]}
                  onFilterChange={handleFilterChange}
                  beforeCount={
                    <button
                      type="button"
                      className="list-filter-toggle"
                      aria-expanded={isFilterPanelOpen}
                      aria-controls={filterPanelDataComponent}
                      data-component={`${HISTORY_LIST_BASE}_content_list-card_filter-toggle`}
                      onClick={() => setIsFilterPanelOpen((open) => !open)}
                    >
                      필터
                    </button>
                  }
                  beforeFilters={isFilterPanelOpen ? (
                    <MessageHistoryFilterPanel
                      dataComponent={filterPanelDataComponent}
                      searchValue={searchValue}
                      onSearchChange={(value) => {
                        setSearchValue(value);
                        setSelectedRecord(null);
                      }}
                      relativeDateFilter={relativeDateFilter}
                      onRelativeDateChange={(value) => {
                        setRelativeDateFilter(value);
                        setSelectedRecord(null);
                      }}
                      dateYear={dateYear}
                      onDateYearChange={(value) => {
                        setDateYear(value);
                        setSelectedRecord(null);
                      }}
                      dateMonth={dateMonth}
                      onDateMonthChange={(value) => {
                        setDateMonth(value);
                        setSelectedRecord(null);
                      }}
                      historyYearOptions={historyYearOptions}
                      onReset={resetHistoryFilters}
                      onClose={() => setIsFilterPanelOpen(false)}
                    />
                  ) : null}
                >
                  <>
                    {upcomingZoneVisible ? (
                      <div
                        className="section-block"
                        data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming`}
                      >
                        <div
                          className="section-header"
                          data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming_header`}
                        >
                          {MESSAGE_RECORD_ZONE_LABELS.upcoming}
                          {isUpcomingError ? null : (
                            <>
                              {" "}
                              <ZoneCount
                                dataComponent={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming_header_count`}
                                isLoading={isPanelLoading}
                                value={visibleUpcomingJobs.length}
                              />
                            </>
                          )}
                        </div>
                        {isUpcomingError ? (
                          <EmptyState message="발송 예정 내역을 불러오지 못했습니다." />
                        ) : isPanelLoading ? (
                          Array.from({ length: 3 }, (_, index) => (
                            <RowSkeleton
                              key={index}
                              dataComponent={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming_row-skeleton`}
                              variant="upcoming"
                            />
                          ))
                        ) : (
                          visibleUpcomingJobs.map((job) => (
                            <UpcomingRow key={job.id} job={job} onCancel={setJobPendingCancel} />
                          ))
                        )}
                      </div>
                    ) : null}
                    {historyZoneVisible ? (
                      <div
                        className="section-block"
                        data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past`}
                      >
                        <div
                          className="section-header"
                          data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past_header`}
                        >
                          {MESSAGE_RECORD_ZONE_LABELS.past}
                          {isHistoryError ? null : (
                            <>
                              {" "}
                              <ZoneCount
                                dataComponent={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past_header_count`}
                                isLoading={isPanelLoading}
                                value={visibleHistoryRecords.length}
                              />
                            </>
                          )}
                        </div>
                        {isHistoryError ? (
                          <EmptyState message={historyErrorMessage} />
                        ) : isPanelLoading ? (
                          Array.from({ length: 4 }, (_, index) => (
                            <RowSkeleton
                              key={index}
                              dataComponent={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past_row-skeleton`}
                              variant="past"
                            />
                          ))
                        ) : (
                          visibleHistoryRecords.map((record) => (
                            <HistoryRow key={record.id} record={record} onSelect={setSelectedRecord} />
                          ))
                        )}
                      </div>
                    ) : null}
                    {!upcomingZoneVisible && !historyZoneVisible ? (
                      <EmptyState message="표시할 메시지가 없습니다." />
                    ) : null}
                  </>
                </MessagePageShell>
              }
              detail={
                normalizedSelectedRecord ? (
                  <>
                    <ClientMessageHistoryDetail
                      data-component={`${HISTORY_DETAIL_BASE}_content`}
                      showBackAction={false}
                      view={{
                        title: normalizedSelectedRecord.title,
                        templateLabel: normalizedSelectedRecord.templateLabel,
                        channelLabel: normalizedSelectedRecord.channelLabel,
                        statusLabel: HISTORY_STATUS[normalizedSelectedRecord.status].label,
                        statusTone: HISTORY_DETAIL_TONE[normalizedSelectedRecord.status],
                        sentAtLabel: formatMessageDateTimeCompact(normalizedSelectedRecord.sentAt),
                        recipientName: normalizedSelectedRecord.recipientName,
                        recipientPhone: normalizedSelectedRecord.recipientPhone,
                        messageBody: normalizedSelectedRecord.messagePreview.trim() || "내용이 없습니다.",
                        failureReason: normalizedSelectedRecord.failureReason ?? null,
                      }}
                      onBack={() => setSelectedRecord(null)}
                      showStatusBadge={false}
                      canRetry={canRetrySelectedRecord}
                      isRetrying={retryMutation.isPending}
                      onRetry={handleRequestRetry}
                    />
                    {selectedCancelReason ? (
                      <InfoCard
                        data-component={`${HISTORY_DETAIL_BASE}_content_cancel-reason`}
                        title="취소 정보"
                      >
                        <InfoRow label={MESSAGE_RECORD_REASON_LABEL} value={selectedCancelReason} tone="muted" />
                      </InfoCard>
                    ) : null}
                  </>
                ) : null
              }
              detailHeaderTrailing={normalizedSelectedRecord ? (
                <StatusPill
                  data-component={`${HISTORY_SLIDING_CARD_BASE}_stage_detail-pane_header_status`}
                  variant={HISTORY_STATUS_PILL_VARIANT[normalizedSelectedRecord.status]}
                  size="sm"
                >
                  {HISTORY_STATUS[normalizedSelectedRecord.status].label}
                </StatusPill>
              ) : null}
            />
          </div>
        </div>
      </section>
      <ApprovalTwoButtonModal
        data-component={`${HISTORY_LIST_BASE}_cancel-modal`}
        open={jobPendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setJobPendingCancel(null);
        }}
        title={MESSAGE_JOB_CANCEL_COPY.confirmTitle}
        description={MESSAGE_JOB_CANCEL_COPY.confirmBody}
        isDescriptionVisuallyHidden={false}
        cancelLabel={MESSAGE_JOB_CANCEL_COPY.dismiss}
        approvalLabel={MESSAGE_JOB_CANCEL_COPY.confirmAction}
        approvalVariant="destructive"
        isPending={cancelMutation.isPending}
        onApprove={handleConfirmCancel}
      />
      <ApprovalTwoButtonModal
        data-component={`${HISTORY_DETAIL_BASE}_retry-modal`}
        open={retryTarget !== null}
        onOpenChange={(open) => {
          if (!open && !retryMutation.isPending) setRetryTarget(null);
        }}
        title="메시지를 다시 보낼까요?"
        description={`${retryTarget?.recipientName?.trim() || "수신자"} 고객에게 같은 메시지로 재발송합니다.`}
        isDescriptionVisuallyHidden={false}
        approvalLabel="재발송"
        pendingLabel="재발송 중..."
        isPending={retryMutation.isPending}
        onApprove={handleConfirmRetry}
      />
    </>
  );
}
