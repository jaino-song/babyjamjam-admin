"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Clock3,
  History,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import {
  AnimatedSlotList,
  DetailEmptyState,
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlimtalkHistory } from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type {
  AlimtalkHistoryRecord,
  AlimtalkHistoryStatus,
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateKey,
} from "@/features/alimtalk-triggers/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

type HistorySelection = number | null;
type HistoryListFilter = "all" | AlimtalkHistoryStatus;

const EVENT_META: Record<TriggerEventType, { label: string; icon: typeof Send }> = {
  CLIENT_CREATED: { label: "고객 등록", icon: UserPlus },
  SERVICE_START: { label: "서비스 시작", icon: CalendarClock },
  SERVICE_END: { label: "서비스 종료", icon: CalendarRange },
  EMPLOYEE_ASSIGNED: { label: "직원 배정", icon: Users },
};

const RECIPIENT_LABELS: Record<TriggerRecipientType, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const TEMPLATE_LABELS: Record<TriggerTemplateKey, string> = {
  CLIENT_WELCOME: "고객 등록 안내",
  SERVICE_START_REMINDER: "서비스 시작 리마인드",
  SERVICE_END_REMINDER: "서비스 종료 안내",
  EMPLOYEE_ASSIGNED: "직원 배정 완료",
};

const VARIABLE_LABELS: Record<string, string> = {
  clientName: "고객명",
  employeeName: "직원명",
  registrationDate: "등록일",
  recipientName: "수신자명",
  serviceEndDate: "서비스 종료일",
  serviceStartDate: "서비스 시작일",
  serviceType: "서비스 유형",
  timingText: "발송 문구",
};

const STATUS_META: Record<AlimtalkHistoryStatus, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  sent: {
    label: "발송 성공",
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-600",
  },
  failed: {
    label: "발송 실패",
    icon: AlertCircle,
    tone: "bg-red-50 text-red-600",
  },
  pending: {
    label: "재시도 대기",
    icon: Clock3,
    tone: "bg-amber-50 text-amber-600",
  },
};

const HISTORY_FILTER_META: Record<
  HistoryListFilter,
  {
    label: string;
    icon: typeof History;
    badgeTone: string;
    activeClassName: string;
    indicatorClassName: string;
  }
> = {
  all: {
    label: "전체",
    icon: History,
    badgeTone: "bg-v3-primary-light text-v3-primary",
    activeClassName: "text-v3-primary",
    indicatorClassName: "bg-v3-primary",
  },
  sent: {
    label: "성공",
    icon: CheckCircle2,
    badgeTone: "bg-emerald-50 text-emerald-600",
    activeClassName: "text-emerald-600",
    indicatorClassName: "bg-emerald-500",
  },
  pending: {
    label: "대기",
    icon: Clock3,
    badgeTone: "bg-amber-50 text-amber-600",
    activeClassName: "text-amber-600",
    indicatorClassName: "bg-amber-500",
  },
  failed: {
    label: "실패",
    icon: AlertCircle,
    badgeTone: "bg-red-50 text-red-600",
    activeClassName: "text-red-600",
    indicatorClassName: "bg-red-500",
  },
};

const HISTORY_LIST_TABS: Array<{
  value: HistoryListFilter;
  label: string;
  activeClassName: string;
  indicatorClassName: string;
}> = (["all", "sent", "pending", "failed"] as const).map((value) => {
  const meta = HISTORY_FILTER_META[value];

  return {
    value,
    label: meta.label,
    activeClassName: meta.activeClassName,
    indicatorClassName: meta.indicatorClassName,
  };
});

function formatDateTime(dateString: string | null) {
  if (!dateString) return "-";

  return new Date(dateString).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCompactDateTime(dateString: string | null) {
  if (!dateString) return "-";

  return new Date(dateString).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getEventMeta(eventType: TriggerEventType | null) {
  if (!eventType) {
    return { label: "수동 발송", icon: History };
  }

  return EVENT_META[eventType];
}

function getTemplateLabel(templateKey: string) {
  return TEMPLATE_LABELS[templateKey as TriggerTemplateKey] ?? templateKey;
}

function getStatusMeta(status: AlimtalkHistoryStatus) {
  return STATUS_META[status] ?? STATUS_META.failed;
}

function getRecordTitle(record: AlimtalkHistoryRecord) {
  return record.ruleName ?? getTemplateLabel(record.templateKey);
}

function getRecordTimestamp(record: AlimtalkHistoryRecord) {
  return record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
}

function matchesHistorySearch(record: AlimtalkHistoryRecord, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  const digitQuery = trimmedQuery.replace(/\D/g, "");
  const receiverDigits = record.receiver.replace(/\D/g, "");
  if (digitQuery && receiverDigits.includes(digitQuery)) {
    return true;
  }

  return [
    getRecordTitle(record),
    record.recipientName ?? "",
    record.clientName ?? "",
    record.employeeName ?? "",
    record.receiver,
    getTemplateLabel(record.templateKey),
    getEventMeta(record.eventType).label,
    record.messageBody,
    record.errorMessage ?? "",
    record.status,
  ].some((field) => field && matchesKoreanSearch(field, trimmedQuery));
}

function getHistoryEmptyMessage(filter: HistoryListFilter, hasSearchQuery: boolean) {
  const copyByFilter: Record<HistoryListFilter, string> = {
    all: hasSearchQuery ? "조건에 맞는 발송 기록이 없습니다." : "발송 기록이 없습니다.",
    sent: hasSearchQuery ? "조건에 맞는 성공 발송 기록이 없습니다." : "성공 발송 기록이 없습니다.",
    pending: hasSearchQuery ? "조건에 맞는 재시도 대기 기록이 없습니다." : "재시도 대기 기록이 없습니다.",
    failed: hasSearchQuery ? "조건에 맞는 실패 발송 기록이 없습니다." : "실패 발송 기록이 없습니다.",
  };

  return copyByFilter[filter];
}

function HistoryDetailSkeleton() {
  return (
    <DetailPanel
      title="기록 상세"
      subtitle="발송된 알림톡의 결과와 수신자 정보를 확인합니다."
    >
      <div data-component="alimtalk-history-detail-skeleton" className="space-y-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            data-component="alimtalk-history-detail-skeleton-card"
            className="rounded-[18px] bg-v3-dim-white p-4"
          >
            <Skeleton className="h-3.5 w-24 bg-white/80" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-4 w-full bg-white/80" />
              <Skeleton className="h-4 w-4/5 bg-white/80" />
              <Skeleton className="h-4 w-3/5 bg-white/80" />
            </div>
          </div>
        ))}
      </div>
    </DetailPanel>
  );
}

function HistoryDetailEmpty({
  message = "발송 기록을 선택하면 상세 정보가 표시됩니다.",
}: {
  message?: string;
}) {
  return (
    <DetailPanel
      avatar={
        <div
          data-component="alimtalk-history-detail-avatar"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
        >
          <History className="h-5 w-5" />
        </div>
      }
      title="기록 상세"
      subtitle="발송 기록을 선택하면 상세 정보가 표시됩니다."
      emptyState={
        <DetailEmptyState
          name="alimtalk-history-detail-empty"
          icon={History}
          message={message}
          className="flex-none min-h-0"
        />
      }
    >
      {null}
    </DetailPanel>
  );
}

export function AlimtalkHistoryManager() {
  const [statusFilter, setStatusFilter] = useState<HistoryListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedRecordId, setSelectedRecordId] = useState<HistorySelection>(null);
  const isMobile = useIsMobile();

  const { data: historyRecords = [], isLoading } = useAlimtalkHistory();

  const filteredRecords = useMemo(() => {
    return historyRecords.filter((record) => {
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;
      return matchesStatus && matchesHistorySearch(record, deferredSearchQuery);
    });
  }, [deferredSearchQuery, historyRecords, statusFilter]);

  const activeFilterMeta = HISTORY_FILTER_META[statusFilter];
  const emptyStateMessage = getHistoryEmptyMessage(
    statusFilter,
    deferredSearchQuery.trim().length > 0
  );

  const selectedRecord = useMemo(() => {
    if (selectedRecordId === null) return null;
    return filteredRecords.find((record) => record.id === selectedRecordId) ?? null;
  }, [filteredRecords, selectedRecordId]);

  const selectedEventMeta = selectedRecord ? getEventMeta(selectedRecord.eventType) : null;
  const SelectedEventIcon = selectedEventMeta?.icon;

  useEffect(() => {
    if (filteredRecords.length === 0) {
      if (selectedRecordId !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedRecordId(null);
      }
      return;
    }

    if (isMobile) {
      return;
    }

    if (selectedRecordId === null || !filteredRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(filteredRecords[0].id);
    }
  }, [filteredRecords, isMobile, selectedRecordId]);

  return (
    <section
      data-component="alimtalk-history-manager"
      className="h-full min-h-0"
    >
      <SplitLayout hasSelection={!!selectedRecord} onBack={() => setSelectedRecordId(null)}>
        <ListPanel
          title="발송 기록"
          subtitle="발송된 알림톡 기록을 볼 수 있어요."
          overlay={
            !isLoading && filteredRecords.length === 0 ? (
              <ListEmptyState
                name="alimtalk-history-list-empty"
                message={emptyStateMessage}
                className="flex-none min-h-0"
              />
            ) : null
          }
          tabs={HISTORY_LIST_TABS}
          activeTab={statusFilter}
          onTabChange={(value) => {
            setStatusFilter(value as HistoryListFilter);
            setSelectedRecordId(null);
          }}
          searchValue={searchQuery}
          onSearchChange={(value) => {
            setSearchQuery(value);
            setSelectedRecordId(null);
          }}
          searchPlaceholder="고객명, 연락처, 템플릿, 내용 검색..."
          headerActions={
            isLoading ? null : (
              <span
                data-component="alimtalk-history-list-count"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72rem] font-semibold",
                  activeFilterMeta.badgeTone
                )}
              >
                <activeFilterMeta.icon className="h-3.5 w-3.5" />
                {filteredRecords.length}건
              </span>
            )
          }
        >
          {isLoading || filteredRecords.length > 0 ? (
            <AnimatedSlotList<AlimtalkHistoryRecord>
              items={filteredRecords}
              isLoading={isLoading}
              loadingCount={5}
              className="space-y-2"
              slotClassName={({ item, isLoading: slotLoading }) => {
                return cn(
                  "flex items-start gap-3 rounded-[18px] border-2 border-transparent bg-white p-4 text-left transition-all duration-200",
                  !slotLoading && "cursor-pointer",
                  !slotLoading && item?.id === selectedRecord?.id
                    ? "border-v3-primary bg-v3-primary-light"
                    : !slotLoading && "hover:border-v3-primary/30 hover:bg-v3-primary-light/50",
                );
              }}
              onSlotClick={(record) => setSelectedRecordId(record.id)}
              render={({ item: record, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <div data-component="alimtalk-history-list-item-body" className="flex items-start gap-3">
                      <div
                        data-component="alimtalk-history-list-item-icon"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                      >
                        <Skeleton className="h-4 w-4 rounded-md bg-white/80" />
                      </div>
                      <div
                        data-component="alimtalk-history-list-item-copy"
                        className="min-w-0 flex-1 space-y-2"
                      >
                        <Skeleton className="h-4 w-36 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-32 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-24 bg-v3-dim-white" />
                      </div>
                    </div>
                  );
                }

                if (!record) return null;

                const eventMeta = getEventMeta(record.eventType);
                const EventIcon = eventMeta.icon;
                const statusMeta = getStatusMeta(record.status);

                return (
                  <div data-component="alimtalk-history-list-item-body" className="flex items-start gap-3">
                    <div
                      data-component="alimtalk-history-list-item-icon"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white text-v3-primary"
                    >
                      <EventIcon className="h-4 w-4" />
                    </div>

                    <div
                      data-component="alimtalk-history-list-item-copy"
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-sm font-semibold text-v3-dark">
                        {getRecordTitle(record)}
                      </p>
                      <p className="mt-1 truncate text-[0.78rem] text-v3-text-muted">
                        {(record.recipientName ?? "-")} · {record.receiver}
                      </p>
                      <p className="mt-1 text-[0.72rem] text-v3-text-muted">
                        {formatCompactDateTime(getRecordTimestamp(record))}
                      </p>
                    </div>

                    <span
                      data-component="alimtalk-history-list-item-status"
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
                        statusMeta.tone
                      )}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                );
              }}
            />
          ) : null}
        </ListPanel>

        {isLoading ? (
          <HistoryDetailSkeleton />
        ) : selectedRecord ? (
          <DetailPanel
            avatar={
              <div
                data-component="alimtalk-history-detail-avatar"
                className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
              >
                {SelectedEventIcon ? <SelectedEventIcon className="h-5 w-5" /> : null}
              </div>
            }
            title={getRecordTitle(selectedRecord)}
            subtitle={`${formatDateTime(getRecordTimestamp(selectedRecord))} 처리`}
            badges={
              <span className="inline-flex items-center rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-semibold text-v3-text-muted">
                {selectedEventMeta?.label ?? "수동 발송"}
              </span>
            }
            trailing={
              <div className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.72rem] font-semibold", getStatusMeta(selectedRecord.status).tone)}>
                {(() => {
                  const StatusIcon = getStatusMeta(selectedRecord.status).icon;
                  return <StatusIcon className="h-3.5 w-3.5" />;
                })()}
                {getStatusMeta(selectedRecord.status).label}
              </div>
            }
          >
            <div data-component="alimtalk-history-detail" className="space-y-4">
              <InfoCard title="발송 결과">
                <InfoRow label="발송 상태" value={getStatusMeta(selectedRecord.status).label} />
                <InfoRow label="처리 시각" value={formatDateTime(getRecordTimestamp(selectedRecord))} />
                <InfoRow label="예약 시각" value={formatDateTime(selectedRecord.scheduledFor)} />
                <InfoRow label="발송 규칙" value={selectedRecord.ruleName ?? "수동 발송"} />
                <InfoRow label="발송 제공자" value={selectedRecord.provider} />
                <InfoRow label="템플릿" value={getTemplateLabel(selectedRecord.templateKey)} />
              </InfoCard>

              <InfoCard title="수신 대상">
                <InfoRow label="수신자" value={selectedRecord.recipientName ?? "-"} />
                <InfoRow label="연락처" value={selectedRecord.receiver} />
                <InfoRow
                  label="수신 유형"
                  value={selectedRecord.recipientType ? RECIPIENT_LABELS[selectedRecord.recipientType] : "-"}
                />
                {selectedRecord.clientName ? (
                  <InfoRow label="고객" value={selectedRecord.clientName} />
                ) : null}
                {selectedRecord.employeeName ? (
                  <InfoRow label="직원" value={selectedRecord.employeeName} />
                ) : null}
              </InfoCard>

              <InfoCard title="발송 메시지">
                <div
                  data-component="alimtalk-history-detail-message"
                  className="rounded-[14px] bg-white px-4 py-3"
                >
                  <pre className="whitespace-pre-wrap break-words font-sans text-[0.78rem] leading-relaxed text-v3-dark">
                    {selectedRecord.messageBody}
                  </pre>
                </div>
              </InfoCard>

              <InfoCard title="템플릿 변수">
                {Object.entries(selectedRecord.variables).length > 0 ? (
                  <div
                    data-component="alimtalk-history-detail-variables"
                    className="space-y-3"
                  >
                    {Object.entries(selectedRecord.variables).map(([key, value]) => (
                      <div
                        key={key}
                        data-component="alimtalk-history-detail-variable"
                        className="rounded-[14px] bg-white px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-[0.72rem] font-semibold text-v3-text-muted">
                            {VARIABLE_LABELS[key] ?? key}
                          </p>
                          <p className="text-[0.78rem] font-semibold text-v3-dark">{value || "-"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.78rem] text-v3-text-muted">
                    템플릿 변수 정보가 없습니다.
                  </p>
                )}
              </InfoCard>

              {selectedRecord.errorMessage ? (
                <InfoCard title="오류 정보">
                  <div
                    data-component="alimtalk-history-detail-error"
                    className="rounded-[14px] bg-red-50 px-4 py-3 text-[0.78rem] text-red-600"
                  >
                    {selectedRecord.errorMessage}
                  </div>
                </InfoCard>
              ) : null}
            </div>
          </DetailPanel>
        ) : (
          <HistoryDetailEmpty
            message={
              searchQuery.trim()
                ? "검색 결과에 해당하는 발송 기록이 없습니다."
                : "발송 기록을 선택하면 상세 정보가 표시됩니다."
            }
          />
        )}
      </SplitLayout>
    </section>
  );
}
