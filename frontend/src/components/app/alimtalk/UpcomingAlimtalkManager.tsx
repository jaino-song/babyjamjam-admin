"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarRange,
  Clock3,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpcomingAlimtalkJobs } from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import { isUpcomingJobInChannel } from "@/features/alimtalk-triggers/channel";
import type {
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateKey,
  UpcomingAlimtalkJob,
} from "@/features/alimtalk-triggers/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { matchesKoreanSearch } from "@/lib/search/korean-search";

type UpcomingJobSelection = string | null;
type UpcomingListFilter = "all" | "customer" | "staff";

const UPCOMING_LIST_TABS: Array<{ value: UpcomingListFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "customer", label: "고객" },
  { value: "staff", label: "직원" },
];

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
  SERVICE_INFO: "서비스 안내",
  SERVICE_END_REMINDER: "서비스 종료 안내",
  EMPLOYEE_ASSIGNED: "직원 배정 완료",
  CLIENT_GREETING: "인사(소개)",
  PRICE_INFO: "비용 안내",
  REMINDER: "리마인드",
  THANKS: "예약 완료(입금 확인)",
  SURVEY: "모니터링 설문",
  INFO: "정보 요청",
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

function formatScheduledFor(dateString: string) {
  return new Date(dateString).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScheduledForCompact(dateString: string) {
  return new Date(dateString).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCountdown(dateString: string) {
  const diffMs = new Date(dateString).getTime() - Date.now();

  if (diffMs <= 0) return "곧 발송";

  const diffMinutes = Math.ceil(diffMs / (1000 * 60));
  if (diffMinutes < 60) return `${diffMinutes}분 후`;

  const diffHours = Math.ceil(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 후`;

  const diffDays = Math.ceil(diffHours / 24);
  return `${diffDays}일 후`;
}

function getEventMeta(eventType: TriggerEventType | null) {
  if (!eventType) {
    return { label: "기타 이벤트", icon: Send };
  }

  return EVENT_META[eventType];
}

function getTemplateLabel(templateKey: TriggerTemplateKey) {
  return TEMPLATE_LABELS[templateKey] ?? templateKey;
}

function getRecipientBadge(recipientType: TriggerRecipientType) {
  return recipientType === "CLIENT" ? "고객" : "직원";
}

function matchesJobSearch(job: UpcomingAlimtalkJob, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  const digitQuery = trimmedQuery.replace(/\D/g, "");
  const recipientPhone = (job.recipientPhone ?? job.payload.recipientPhone ?? "").replace(/\D/g, "");

  if (digitQuery && recipientPhone.includes(digitQuery)) {
    return true;
  }

  return [
    job.ruleName,
    job.payload.clientName ?? "",
    job.payload.employeeName ?? "",
    job.payload.recipientName,
    RECIPIENT_LABELS[job.recipientType],
    getTemplateLabel(job.templateKey),
    getEventMeta(job.eventType).label,
  ].some((field) => field && matchesKoreanSearch(field, trimmedQuery));
}

function UpcomingDetailSkeleton() {
  return (
    <DetailPanel
      title="발송 상세"
      subtitle="예정된 알림톡의 발송 시점과 수신자 정보를 확인합니다."
    >
      <div data-component="alimtalk-upcoming-detail-skeleton" className="space-y-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            data-component="alimtalk-upcoming-detail-skeleton-card"
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

function UpcomingDetailEmpty({
  message = "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다.",
}: {
  message?: string;
}) {
  return (
    <DetailPanel
      avatar={
        <div
          data-component="alimtalk-upcoming-detail-avatar"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
        >
          <Clock3 className="h-5 w-5" />
        </div>
      }
      title="발송 상세"
      subtitle="발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
      emptyState={
        <DetailEmptyState
          name="alimtalk-upcoming-detail-empty"
          icon={Users}
          message={message}
          className="flex-none min-h-0"
        />
      }
    >
      {null}
    </DetailPanel>
  );
}

export function UpcomingAlimtalkManager() {
  const [listFilter, setListFilter] = useState<UpcomingListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedJobId, setSelectedJobId] = useState<UpcomingJobSelection>(null);
  const isMobile = useIsMobile();

  const { data: upcomingJobs = [], isLoading } = useUpcomingAlimtalkJobs();
  const alimtalkUpcomingJobs = useMemo(
    () => upcomingJobs.filter((job) => isUpcomingJobInChannel(job, "alimtalk")),
    [upcomingJobs],
  );

  const filteredJobs = useMemo(() => {
    return alimtalkUpcomingJobs.filter((job) => {
      if (listFilter === "customer" && job.recipientType !== "CLIENT") {
        return false;
      }

      if (listFilter === "staff" && job.recipientType === "CLIENT") {
        return false;
      }

      return matchesJobSearch(job, deferredSearchQuery);
    });
  }, [alimtalkUpcomingJobs, deferredSearchQuery, listFilter]);

  const hasSearchQuery = deferredSearchQuery.trim().length > 0;
  const hasListFilters = listFilter !== "all" || hasSearchQuery;

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null;
    return filteredJobs.find((job) => job.id === selectedJobId) ?? null;
  }, [filteredJobs, selectedJobId]);
  const selectedEventMeta = selectedJob ? getEventMeta(selectedJob.eventType) : null;
  const SelectedEventIcon = selectedEventMeta?.icon;

  useEffect(() => {
    if (filteredJobs.length === 0) {
      if (selectedJobId !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedJobId(null);
      }
      return;
    }

    if (isMobile) {
      return;
    }

    if (selectedJobId && !filteredJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(null);
    }
  }, [filteredJobs, isMobile, selectedJobId]);

  return (
    <section
      data-component="alimtalk-upcoming"
      className="h-full min-h-0"
    >
      <SplitLayout hasSelection={!!selectedJob} onBack={() => setSelectedJobId(null)}>
        <ListPanel
          title="발송 예정"
          subtitle="발송이 예정된 메시지를 확인할 수 있어요."
          tabs={UPCOMING_LIST_TABS}
          activeTab={listFilter}
          onTabChange={(value) => {
            setListFilter(value as UpcomingListFilter);
            setSelectedJobId(null);
          }}
          searchValue={searchQuery}
          onSearchChange={(value) => {
            setSearchQuery(value);
            setSelectedJobId(null);
          }}
          searchPlaceholder="이름, 연락처, 템플릿 검색..."
          headerActions={
            isLoading ? null : (
              <span
                data-component="alimtalk-upcoming-list-badge"
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                {(hasListFilters ? filteredJobs.length : alimtalkUpcomingJobs.length)}개
              </span>
            )
          }
        >
          {isLoading || filteredJobs.length > 0 ? (
            <div data-component="alimtalk-upcoming-list" className="space-y-3 pb-2">
              <AnimatedSlotList<UpcomingAlimtalkJob>
                items={filteredJobs}
                isLoading={isLoading}
                loadingCount={5}
                className="space-y-2"
                itemDataComponent="alimtalk-upcoming-list-item"
                getSlotState={({ item, isLoading: slotLoading }) => ({
                  isActive: !slotLoading && item?.id === selectedJobId,
                  isInteractive: !slotLoading && Boolean(item),
                })}
                onSlotClick={(job) => setSelectedJobId(job.id)}
                render={({ item: job }) => {
                  if (!job) return null;

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="alimtalk-upcoming-list-item"
                      icon={Clock3}
                      iconContainerClassName="text-v3-primary"
                      title={job.payload.recipientName || "-"}
                      subtitle={`${getTemplateLabel(job.templateKey)} · ${formatScheduledForCompact(job.scheduledFor)}`}
                      status={
                        <span
                          data-component="alimtalk-upcoming-list-item-badge"
                          className="inline-flex shrink-0 items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                        >
                          {getRecipientBadge(job.recipientType)}
                        </span>
                      }
                    />
                  );
                }}
              />
            </div>
          ) : (
            <ListEmptyState
              message={
                hasListFilters ? "조건에 맞는 예약 발송 항목이 없습니다." : "발송 예정 항목이 없습니다."
              }
            />
          )}
        </ListPanel>

        {isLoading ? (
          <UpcomingDetailSkeleton />
        ) : selectedJob ? (
          <DetailPanel
            avatar={
              <div
                data-component="alimtalk-upcoming-detail-avatar"
                className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
              >
                {SelectedEventIcon ? <SelectedEventIcon className="h-5 w-5" /> : null}
              </div>
            }
            title={selectedJob.ruleName}
            subtitle={`${formatScheduledFor(selectedJob.scheduledFor)} 발송 예정`}
            badges={
              <span className="inline-flex items-center rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-semibold text-v3-text-muted">
                {selectedEventMeta?.label ?? "기타 이벤트"}
              </span>
            }
            trailing={
              <div
                data-component="alimtalk-upcoming-detail-badge"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <Clock3 className="h-3.5 w-3.5" />
                {formatCountdown(selectedJob.scheduledFor)}
              </div>
            }
          >
            <div data-component="alimtalk-upcoming-detail" className="space-y-4">
              <InfoCard title="발송 정보">
                <InfoRow label="발송 상태" value="발송 예정" />
                <InfoRow label="발송 시각" value={formatScheduledFor(selectedJob.scheduledFor)} />
                <InfoRow label="발송 규칙" value={selectedJob.ruleName} />
                <InfoRow label="템플릿" value={getTemplateLabel(selectedJob.templateKey)} />
              </InfoCard>

              <InfoCard title="수신 대상">
                <InfoRow label="수신자" value={selectedJob.payload.recipientName} />
                <InfoRow
                  label="연락처"
                  value={selectedJob.recipientPhone ?? selectedJob.payload.recipientPhone ?? "-"}
                />
                <InfoRow label="수신 유형" value={RECIPIENT_LABELS[selectedJob.recipientType]} />
                {selectedJob.payload.clientName ? (
                  <InfoRow label="고객" value={selectedJob.payload.clientName} />
                ) : null}
                {selectedJob.payload.employeeName ? (
                  <InfoRow label="직원" value={selectedJob.payload.employeeName} />
                ) : null}
              </InfoCard>

              <InfoCard title="템플릿 변수">
                {Object.entries(selectedJob.payload.templateVariables).length > 0 ? (
                  <div
                    data-component="alimtalk-upcoming-detail-variables"
                    className="space-y-3"
                  >
                    {Object.entries(selectedJob.payload.templateVariables).map(([key, value]) => (
                      <div
                        key={key}
                        data-component="alimtalk-upcoming-detail-variable"
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
            </div>
          </DetailPanel>
        ) : (
          searchQuery.trim() ? (
            <UpcomingDetailEmpty message="검색 결과에 해당하는 예정 발송이 없습니다." />
          ) : (
            <UpcomingDetailEmpty />
          )
        )}
      </SplitLayout>
    </section>
  );
}
