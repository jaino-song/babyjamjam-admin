"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarRange,
  Clock3,
  MessageCircle,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import {
  AnimatedSlotList,
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpcomingAlimtalkJobs } from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type {
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateKey,
  UpcomingAlimtalkJob,
} from "@/features/alimtalk-triggers/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

type UpcomingJobSelection = string | null;

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

function UpcomingDetailEmpty() {
  return (
    <DetailPanel
      title="발송 상세"
      subtitle="예정된 알림톡의 발송 시점과 수신자 정보를 확인합니다."
    >
      <div data-component="alimtalk-upcoming-detail-empty" className="space-y-4">
        {[0, 1].map((index) => (
          <div
            key={index}
            data-component="alimtalk-upcoming-detail-empty-card"
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

        <div
          data-component="alimtalk-upcoming-detail-empty-message"
          className="rounded-[18px] bg-v3-dim-white p-8 text-center text-[0.82rem] text-v3-text-muted"
        >
          <MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-30" />
          예정된 알림톡을 선택하면 상세 정보가 표시됩니다.
        </div>
      </div>
    </DetailPanel>
  );
}

export function UpcomingAlimtalkManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedJobId, setSelectedJobId] = useState<UpcomingJobSelection>(null);
  const isMobile = useIsMobile();

  const { data: upcomingJobs = [], isLoading } = useUpcomingAlimtalkJobs();

  const filteredJobs = useMemo(() => {
    return upcomingJobs.filter((job) => matchesJobSearch(job, deferredSearchQuery));
  }, [deferredSearchQuery, upcomingJobs]);

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
      className="h-[calc(100dvh-176px)] min-h-[calc(100dvh-176px)] md:h-[calc(100dvh-64px)] md:min-h-[calc(100dvh-64px)]"
    >
      <SplitLayout hasSelection={!!selectedJob} onBack={() => setSelectedJobId(null)}>
        <ListPanel
          title="발송 예정"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="고객명, 수신자, 번호, 규칙명 검색..."
          headerActions={
            isLoading ? null : (
              <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
                {upcomingJobs.length}건 예정
              </span>
            )
          }
        >
          {!isLoading && filteredJobs.length === 0 ? (
            <ListEmptyState
              name="alimtalk-upcoming-list-empty"
              message={searchQuery.trim() ? "검색 결과가 없습니다" : "예정된 알림톡이 없습니다"}
            />
          ) : (
            <AnimatedSlotList<UpcomingAlimtalkJob>
              items={filteredJobs}
              isLoading={isLoading}
              loadingCount={5}
              className="space-y-2"
              slotClassName={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && item.id === selectedJob?.id;
                return cn(
                  "flex items-start gap-3 rounded-[18px] border-2 border-transparent bg-white p-4 text-left transition-all duration-200",
                  !slotLoading && "cursor-pointer",
                  isActive
                    ? "border-v3-primary bg-v3-primary-light"
                    : !slotLoading && "hover:border-v3-primary/30 hover:bg-v3-primary-light/50",
                );
              }}
              onSlotClick={(job) => setSelectedJobId(job.id)}
              render={({ item: job, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div
                        data-component="alimtalk-upcoming-list-skeleton-icon"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white"
                      >
                        <Skeleton className="h-5 w-5 rounded-md bg-white/80" />
                      </div>
                      <div
                        data-component="alimtalk-upcoming-list-skeleton-copy"
                        className="min-w-0 flex-1 space-y-2"
                      >
                        <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-48 bg-v3-dim-white" />
                      </div>
                    </>
                  );
                }

                if (!job) return null;

                const eventMeta = getEventMeta(job.eventType);
                const EventIcon = eventMeta.icon;

                return (
                  <>
                    <div
                      data-component="alimtalk-upcoming-list-item-icon"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary"
                    >
                      <EventIcon className="h-4 w-4" />
                    </div>

                    <div
                      data-component="alimtalk-upcoming-list-item-copy"
                      className="min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[0.82rem] font-semibold text-v3-dark">
                          {job.ruleName}
                        </p>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-white/80 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary">
                          {formatCountdown(job.scheduledFor)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[0.72rem] text-v3-text-muted">
                        {job.payload.recipientName} · {formatScheduledForCompact(job.scheduledFor)} · {getTemplateLabel(job.templateKey)}
                      </p>
                    </div>
                  </>
                );
              }}
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
            <DetailPanel
              title="발송 상세"
              subtitle="예정된 알림톡의 발송 시점과 수신자 정보를 확인합니다."
            >
              <div
                data-component="alimtalk-upcoming-detail-empty"
                className="rounded-[18px] border border-dashed border-v3-border p-8 text-center text-[0.82rem] text-v3-text-muted"
              >
                검색 결과에 해당하는 예정 발송이 없습니다.
              </div>
            </DetailPanel>
          ) : (
            <UpcomingDetailEmpty />
          )
        )}
      </SplitLayout>
    </section>
  );
}
